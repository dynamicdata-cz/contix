import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONTIX_VERSION } from "@contix/shared";

/* ============================================================
 * SBOM CONTIXu (v1.48, ADR-145): CycloneDX 1.6 z bun.lock – jen produkční závislosti
 * workspace (api, web, shared) a jejich tranzitivní závislosti; licence z node_modules, je-li k dispozici.
 * CONTIX je produkt s digitálními prvky (CRA čl. 13 odst. 24, příloha I část II bod 1).
 * ============================================================ */

type LockPkg = [string, string?, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; os?: string | string[] }?, string?];
interface BunLock {
  workspaces: Record<string, { name?: string; dependencies?: Record<string, string> }>;
  packages: Record<string, LockPkg>;
}

/** bun.lock je JSON s čárkami za posledním prvkem. */
export function parseBunLock(text: string): BunLock {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")) as BunLock;
}

const PRODUCT_WORKSPACES = ["apps/api", "apps/web", "packages/shared"];

const purlOf = (name: string, version: string) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;
const hexOf = (integrity: string | undefined) => {
  const m = integrity?.match(/^sha512-(.+)$/);
  return m ? Buffer.from(m[1]!, "base64").toString("hex") : null;
};

export interface SbomOptions {
  version?: string;
  now?: Date;
  serial?: string;
  /** Licence balíčku (např. z node_modules/<name>/package.json). */
  license?: (name: string, version: string) => string | null;
}

export function buildSbom(lock: BunLock, opts: SbomOptions = {}) {
  /** Klíč v `packages` pro závislost `dep` balíčku s klíčem `from` (vnořené klíče „a/b“ mají přednost). */
  const resolveKey = (from: string | null, dep: string): string | null => {
    let p = from;
    while (p) {
      if (lock.packages[`${p}/${dep}`]) return `${p}/${dep}`;
      const i = p.lastIndexOf("/");
      // „@scope/name“ je jeden segment
      p = i > 0 && !(p.startsWith("@") && p.indexOf("/") === i) ? p.slice(0, i) : null;
    }
    return lock.packages[dep] ? dep : null;
  };
  const seen = new Map<string, { name: string; version: string; integrity?: string; deps: string[] }>();
  const queue: [string | null, string][] = [];
  for (const ws of PRODUCT_WORKSPACES) for (const d of Object.keys(lock.workspaces[ws]?.dependencies ?? {})) queue.push([null, d]);
  while (queue.length) {
    const [from, dep] = queue.shift()!;
    const key = resolveKey(from, dep);
    if (!key || seen.has(key)) continue;
    const [spec, , meta, integrity] = lock.packages[key]!;
    const at = spec.lastIndexOf("@");
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    if (version.startsWith("workspace:")) {
      // vlastní balíček (@contix/shared) – jeho závislosti patří do produktu, sám ne
      seen.set(key, { name, version, deps: [] });
      for (const d of Object.keys(lock.workspaces[version.slice(10)]?.dependencies ?? {})) queue.push([null, d]);
      continue;
    }
    const deps = Object.keys(meta?.dependencies ?? {});
    seen.set(key, { name, version, integrity, deps: [] });
    for (const d of deps) {
      queue.push([key, d]);
      const k = resolveKey(key, d);
      if (k) seen.get(key)!.deps.push(k);
    }
  }
  const comps = [...seen.entries()].filter(([, p]) => !p.version.startsWith("workspace:"));
  const refOf = new Map(comps.map(([k, p]) => [k, purlOf(p.name, p.version)]));
  const version = opts.version ?? CONTIX_VERSION;
  const root = `pkg:generic/contix@${version}`;
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${opts.serial ?? crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: (opts.now ?? new Date()).toISOString(),
      tools: { components: [{ type: "application", name: "contix-sbom", version }] },
      component: { type: "application", "bom-ref": root, name: "CONTIX", version, supplier: { name: "DynamicData" }, licenses: [{ license: { id: "AGPL-3.0-only" } }] },
    },
    components: comps
      .map(([k, p]) => {
        const hex = hexOf(p.integrity);
        const lic = opts.license?.(p.name, p.version) ?? null;
        return {
          type: "library",
          "bom-ref": refOf.get(k)!,
          name: p.name,
          version: p.version,
          purl: refOf.get(k)!,
          ...(hex ? { hashes: [{ alg: "SHA-512", content: hex }] } : {}),
          ...(lic ? { licenses: [/^[A-Za-z0-9.+-]+$/.test(lic) ? { license: { id: lic } } : /^[()A-Za-z0-9.+\s-]+$/.test(lic) && /\s(AND|OR|WITH)\s/.test(lic) ? { expression: lic } : { license: { name: lic } }] } : {}),
        };
      })
      .sort((a, b) => a.purl.localeCompare(b.purl)),
    dependencies: [
      { ref: root, dependsOn: [...new Set(PRODUCT_WORKSPACES.flatMap((ws) => Object.keys(lock.workspaces[ws]?.dependencies ?? {})).map((d) => refOf.get(resolveKey(null, d) ?? "")).filter((x): x is string => !!x))].sort() },
      ...comps.map(([k, p]) => ({ ref: refOf.get(k)!, dependsOn: [...new Set(p.deps.map((d) => refOf.get(d)).filter((x): x is string => !!x))].sort() })),
    ],
  };
}

/** bun.lock v adresáři procesu nebo nad ním (vývoj: kořen repozitáře, obraz: /app). */
export function findBunLock(start = process.cwd()): string | null {
  let d = resolve(start);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, "bun.lock"))) return join(d, "bun.lock");
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

/** SBOM z bun.lock na disku, licence z node_modules vedle něj. */
export function sbomFromDisk(lockPath: string, opts: Omit<SbomOptions, "license"> = {}) {
  const base = dirname(lockPath);
  // hoisted (obraz Dockeru) i izolované node_modules (vývoj: node_modules/.bun/<name>@<ver>/node_modules/<name>)
  let isolated: string[] = [];
  try {
    isolated = readdirSync(join(base, "node_modules", ".bun"));
  } catch {
    /* hoisted */
  }
  const license = (name: string, version: string) => {
    const id = `${name.replace("/", "+")}@${version}`;
    const dirs = [...isolated.filter((d) => d === id || d.startsWith(`${id}+`)).map((d) => join(base, "node_modules", ".bun", d, "node_modules", name)), join(base, "node_modules", name)];
    for (const dir of dirs) {
      try {
        const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { license?: unknown; version?: unknown };
        if (pj.version !== version) continue;
        return typeof pj.license === "string" && pj.license.length < 100 ? pj.license : null;
      } catch {
        /* další umístění */
      }
    }
    return null;
  };
  return buildSbom(parseBunLock(readFileSync(lockPath, "utf8")), { ...opts, license });
}
