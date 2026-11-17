import { deflateSync } from "node:zlib";

/* ============================================================
 * Malý rastrový graf do Wordu (v1.39, ADR-136): čára / plocha / sloupce jedné řady jako PNG bez externích knihoven
 * (Word neumí SVG bez záložního PNG). Popisky nejsou v obrázku – jsou v textu nad a pod ním.
 * ============================================================ */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export class Raster {
  readonly px: Uint8Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint8Array(w * h * 4).fill(255);
  }
  /** Bod s průhledností (alfa 0–1) – míchání do bílého podkladu. */
  dot(x: number, y: number, rgb: [number, number, number], a = 1) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 4;
    for (let c = 0; c < 3; c++) this.px[i + c] = Math.round(this.px[i + c]! * (1 - a) + rgb[c]! * a);
  }
  rect(x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number], a = 1) {
    for (let y = Math.floor(Math.min(y0, y1)); y <= Math.ceil(Math.max(y0, y1)); y++) for (let x = Math.floor(Math.min(x0, x1)); x <= Math.ceil(Math.max(x0, x1)); x++) this.dot(x, y, rgb, a);
  }
  /** Úsečka s tloušťkou (kruhové štětce podél úsečky). */
  line(x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number], width = 1) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const r = width / 2;
    for (let s = 0; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.dot(x + dx, y + dy, rgb);
    }
  }
  circle(cx: number, cy: number, r: number, rgb: [number, number, number]) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.dot(cx + dx, cy + dy, rgb);
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      Buffer.from(this.px.subarray(y * this.w * 4, (y + 1) * this.w * 4)).copy(raw, y * (this.w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bitová hloubka
    ihdr[9] = 6; // RGBA
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
  }
}

const hex = (c: string): [number, number, number] => {
  const m = c.replace("#", "");
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
};

/** Graf jedné řady (hodnoty mohou chybět = mezera). `zero` = vodorovná osa v nule (měřítko změny). */
export function seriesPng(values: (number | null)[], o: { type: "line" | "area" | "columns"; w?: number; h?: number; lo: number; hi: number; color?: string; zero?: boolean }): Buffer {
  const W = o.w ?? 600;
  const H = o.h ?? 160;
  const r = new Raster(W, H);
  const col = hex(o.color ?? "#2a78d6");
  const pad = 14;
  const x = (i: number) => (values.length < 2 ? W / 2 : pad + (i * (W - 2 * pad)) / (values.length - 1));
  const y = (v: number) => H - pad - ((v - o.lo) / (o.hi - o.lo || 1)) * (H - 2 * pad);
  const base = y(o.zero ? 0 : o.lo);
  r.line(pad, base, W - pad, base, hex("#cbd2de"), 2);
  if (o.type === "columns") {
    // sloupce v pásmech (krajní nepřesahují okraj)
    const band = (W - 2 * pad) / Math.max(1, values.length);
    const bw = Math.max(4, band * 0.6);
    values.forEach((v, i) => {
      if (v == null) return;
      const cx = pad + (i + 0.5) * band;
      r.rect(cx - bw / 2, base, cx + bw / 2, y(v), col);
    });
    return r.png();
  }
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i];
    const b = values[i + 1];
    if (a == null || b == null) continue;
    if (o.type === "area")
      for (let xx = Math.ceil(x(i)); xx < Math.ceil(x(i + 1)); xx++) {
        const t = (xx - x(i)) / (x(i + 1) - x(i) || 1);
        const yy = y(a + (b - a) * Math.min(1, Math.max(0, t)));
        r.rect(xx, yy, xx, base, col, 0.15);
      }
    r.line(x(i), y(a), x(i + 1), y(b), col, 4);
  }
  const lastI = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).at(-1);
  if (lastI !== undefined) r.circle(x(lastI), y(values[lastI]!), 6, col);
  return r.png();
}
