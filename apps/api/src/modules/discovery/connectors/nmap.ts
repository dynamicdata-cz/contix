import type { AssetType } from "@contix/shared";
import { XMLParser } from "fast-xml-parser";
import type { Connector, DiscoveredAsset } from "../types";

/**
 * Aktivní síťový sken přes nmap.
 *
 * Bezpečnostní zásady (viz docs/03_modules/asset/discovery.md):
 *  - sken je ve výchozím stavu VYPNUTÝ (SCAN_ENABLED=false),
 *  - cíle musí ležet v povolených rozsazích SCAN_ALLOWED_CIDRS,
 *  - cíle se validují (jen IPv4 adresa nebo CIDR, žádné hostname ani volby nmapu),
 *  - v produkci běží sken v samostatném "collector" procesu v dané síti, ne v API.
 */

/**
 * Porty pro zjištění, že hostitel žije. Bez oprávnění k raw socketům (API v Dockeru) nmap neumí ping ani ARP
 * a ve výchozím stavu zkouší jen 80 a 443 – stanice Windows (135/139/445/3389), Mac (5000/7000/22) nebo tiskárny
 * by se vůbec nenašly. Stanice s firewallem, který odmítá vše, najde jen sken s ARP (kolektor s NET_RAW).
 */
export const DISCOVERY_PORTS = [21, 22, 23, 53, 80, 135, 139, 443, 445, 515, 631, 3389, 5000, 5900, 7000, 8080, 8443, 9100, 62078];
const PS = `-PS${DISCOVERY_PORTS.join(",")}`;

export const SCAN_PROFILES = {
  ping: ["-sn", "-T4", PS],
  standard: ["-T4", "-F", "-sV", "--version-light", PS],
  os_detect: ["-T4", "-F", "-O", "--osscan-limit", PS], // vyžaduje root / CAP_NET_RAW
} as const;

export interface NmapParams {
  targets: string[];
  profile: keyof typeof SCAN_PROFILES;
  /** Vynechané adresy / rozsahy (--exclude), validované jako cíle. */
  exclude?: string[];
}

/* ---------- validace cílů ---------- */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

export function parseCidr(input: string): { start: number; end: number } | null {
  const [ip, bitsRaw] = input.trim().split("/");
  if (!ip || !IPV4.test(ip)) return null;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const start = (ipToInt(ip) & mask) >>> 0;
  return { start, end: (start | (~mask >>> 0)) >>> 0 };
}

export function assertTargetsAllowed(targets: string[], allowed: string[], maxHosts = 4096): void {
  const allowedRanges = allowed.map(parseCidr).filter((r) => r !== null);
  if (!allowedRanges.length) throw new Error("Síťový sken nemá nastavené povolené rozsahy (SCAN_ALLOWED_CIDRS).");
  let hosts = 0;
  for (const t of targets) {
    const r = parseCidr(t);
    if (!r) throw new Error(`Neplatný cíl skenu: "${t}" (povolena je IPv4 adresa nebo CIDR).`);
    if (!allowedRanges.some((a) => r.start >= a.start && r.end <= a.end))
      throw new Error(`Cíl ${t} leží mimo povolené rozsahy.`);
    hosts += r.end - r.start + 1;
  }
  if (hosts > maxHosts) throw new Error(`Příliš velký rozsah (${hosts} adres, max ${maxHosts}).`);
}

/* ---------- parsování výstupu nmap -oX ---------- */

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function guessType(osName: string, openPorts: number[], vendor?: string): AssetType {
  const s = `${osName} ${vendor ?? ""}`.toLowerCase();
  if (/printer|jetdirect|laserjet|xerox|ricoh|kyocera/.test(s) || openPorts.includes(9100)) return "printer";
  if (/cisco|juniper|mikrotik|routeros|switch|router|ubiquiti|aruba/.test(s)) return "network_device";
  if (/fortinet|fortigate|palo alto|checkpoint|sophos/.test(s)) return "security_device";
  if (/windows/.test(s)) return /server/.test(s) ? "server" : "workstation";
  if (/linux|unix|bsd/.test(s)) return "server";
  if (/vmware/.test(s)) return "virtual_machine";
  return "other";
}

export function parseNmapXml(xml: string, scannedAt = new Date()): DiscoveredAsset[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const doc = parser.parse(xml);
  const out: DiscoveredAsset[] = [];

  for (const h of arr<any>(doc?.nmaprun?.host)) {
    if (h.status?.state !== "up") continue;
    const addrs = arr<any>(h.address);
    const ipv4 = addrs.find((a) => a.addrtype === "ipv4")?.addr as string | undefined;
    const macEntry = addrs.find((a) => a.addrtype === "mac");
    const mac = macEntry?.addr as string | undefined;
    const hostname = arr<any>(h.hostnames?.hostname)[0]?.name as string | undefined;
    const osMatch = arr<any>(h.os?.osmatch)[0];
    const osName = (osMatch?.name as string | undefined) ?? "";
    const ports = arr<any>(h.ports?.port)
      .filter((p) => p.state?.state === "open")
      .map((p) => ({
        port: Number(p.portid),
        protocol: p.protocol as string,
        service: p.service?.name as string | undefined,
        product: [p.service?.product, p.service?.version].filter(Boolean).join(" ") || undefined,
      }));

    if (!ipv4 && !mac) continue;
    out.push({
      sourceType: "network_scan",
      sourceRef: mac ? `mac:${mac.toLowerCase()}` : `ip:${ipv4}`,
      name: hostname ?? ipv4 ?? mac!,
      assetType: guessType(osName, ports.map((p) => p.port), macEntry?.vendor),
      hostname: hostname ?? null,
      ipAddresses: ipv4 ? [ipv4] : [],
      macAddresses: mac ? [mac] : [],
      osName: osName || null,
      manufacturer: macEntry?.vendor ?? null,
      attributes: { openPorts: ports, osAccuracy: osMatch?.accuracy ? Number(osMatch.accuracy) : undefined },
      raw: { host: h },
      seenAt: scannedAt,
    });
  }
  return out;
}

/* ---------- konektor ---------- */

export function createNmapConnector(opts: { nmapPath: string; allowedCidrs: string[] }): Connector<NmapParams> {
  return {
    id: "network_scan",
    async *collect(p, ctx) {
      assertTargetsAllowed(p.targets, opts.allowedCidrs);
      const exclude = (p.exclude ?? []).filter(Boolean);
      for (const x of exclude) if (!parseCidr(x)) throw new Error(`Neplatná výjimka skenu: "${x}" (povolena je IPv4 adresa nebo CIDR).`);
      const run = async (profile: keyof typeof SCAN_PROFILES) => {
        const args = [opts.nmapPath, ...SCAN_PROFILES[profile], ...(exclude.length ? ["--exclude", exclude.join(",")] : []), "-oX", "-", ...p.targets];
        ctx.log(`spouštím: ${args.join(" ")}`);
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
        const [xml, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { xml, err, code };
      };
      let r = await run(p.profile);
      // detekce OS potřebuje raw sockety (root / NET_RAW) – bez nich se sken provede standardně, místo aby celý selhal
      if (r.code !== 0 && p.profile === "os_detect" && /requires root/i.test(r.err)) {
        ctx.log("detekce OS vyžaduje oprávnění root / NET_RAW, které API v Dockeru nemá – sken proběhne profilem standardní (bez OS).");
        r = await run("standard");
      }
      if (r.code !== 0) throw new Error(`nmap skončil kódem ${r.code}: ${r.err.slice(0, 500)}`);
      yield* parseNmapXml(r.xml);
    },
  };
}
