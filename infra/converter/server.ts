/**
 * CONTIX – převodní služba (ADR-025).
 * LibreOffice (headless) + poppler v samostatném kontejneru bez přístupu do internetu.
 *   POST /pdf   tělo = soubor (Word, Excel, PowerPoint, ODF…), hlavička x-filename → PDF
 *   POST /text  tělo = PDF → prostý text (UTF-8)
 *   GET  /health
 * Převody běží po jednom (LibreOffice není vhodný pro souběh), každý s vlastním profilem a časovým limitem.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3100);
const MAX_BYTES = Number(process.env.CONVERTER_MAX_MB ?? 30) * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.CONVERTER_TIMEOUT_S ?? 120) * 1000;
const SOFFICE = process.env.SOFFICE_PATH ?? "soffice";
const ALLOWED_EXT = new Set(["doc", "docx", "docm", "dot", "dotx", "odt", "rtf", "txt", "xls", "xlsx", "xlsm", "ods", "csv", "ppt", "pptx", "odp"]);

let queue: Promise<unknown> = Promise.resolve();
/** Sériové zpracování – další převod začne až po dokončení předchozího. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

async function run(cmd: string[], timeoutMs = TIMEOUT_MS): Promise<{ code: number; stdout: Uint8Array; stderr: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: tmpdir() } });
  const timer = setTimeout(() => p.kill(9), timeoutMs);
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(timer);
  return { code, stdout: new Uint8Array(stdout), stderr: stderr.slice(0, 2000) };
}

async function toPdf(body: Uint8Array, filename: string): Promise<Uint8Array> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) throw new Error(`Nepodporovaný typ souboru: .${ext}`);
  const dir = await mkdtemp(join(tmpdir(), "conv-"));
  try {
    const input = join(dir, `input.${ext}`);
    await writeFile(input, body);
    const r = await run([
      SOFFICE,
      `-env:UserInstallation=file://${dir}/profile`,
      "--headless",
      "--norestore",
      "--nologo",
      "--nodefault",
      "--nolockcheck",
      "--convert-to",
      "pdf",
      "--outdir",
      join(dir, "out"),
      input,
    ]);
    const out = await readdir(join(dir, "out")).catch(() => [] as string[]);
    const pdf = out.find((f) => f.endsWith(".pdf"));
    if (r.code !== 0 || !pdf) throw new Error(`Převod selhal (kód ${r.code})${r.stderr ? `: ${r.stderr.trim().split("\n").at(-1)}` : ""}`);
    return new Uint8Array(await readFile(join(dir, "out", pdf)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pdfText(body: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "txt-"));
  try {
    const input = join(dir, "input.pdf");
    await writeFile(input, body);
    const r = await run(["pdftotext", "-enc", "UTF-8", "-nopgbrk", input, "-"], 60_000);
    if (r.code !== 0) throw new Error(`Čtení textu z PDF selhalo (kód ${r.code})`);
    return new TextDecoder().decode(r.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readBody(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw Object.assign(new Error("Soubor je příliš velký"), { status: 413 });
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_BYTES) throw Object.assign(new Error("Soubor je příliš velký"), { status: 413 });
  if (!buf.length) throw Object.assign(new Error("Prázdný soubor"), { status: 400 });
  return buf;
}

let version: string | null = null;
const fail = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: (e as { status?: number })?.status ?? 422 });

Bun.serve({
  port: PORT,
  maxRequestBodySize: MAX_BYTES + 1024 * 1024,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    try {
      if (req.method === "GET" && pathname === "/health") {
        version ??= new TextDecoder().decode((await run([SOFFICE, "--version"], 30_000)).stdout).trim() || null;
        return Response.json({ ok: !!version, version });
      }
      if (req.method === "POST" && pathname === "/pdf") {
        const body = await readBody(req);
        const name = decodeURIComponent(req.headers.get("x-filename") ?? "dokument.docx");
        const pdf = await serial(() => toPdf(body, name));
        return new Response(pdf, { headers: { "content-type": "application/pdf" } });
      }
      if (req.method === "POST" && pathname === "/text") {
        const body = await readBody(req);
        if (new TextDecoder().decode(body.subarray(0, 5)) !== "%PDF-") return fail(Object.assign(new Error("Očekáváno PDF"), { status: 400 }));
        return new Response(await serial(() => pdfText(body)), { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return fail(e);
    }
  },
});
console.log(`CONTIX converter na portu ${PORT}`);
