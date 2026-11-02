import type { DiffBlock, DiffPart } from "@contix/shared";
import { diffArrays, diffWordsWithSpace } from "diff";

/* ============================================================
 * Porovnání textu dvou verzí dokumentu (ADR-025): odstavce → změněné odstavce po slovech.
 * Nezměněné úseky se zkrátí na kontext (1 odstavec kolem změny).
 * ============================================================ */

const MAX_PARAS = 6000;

export const paragraphs = (text: string) =>
  text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

export function diffText(oldText: string, newText: string, context = 1): { blocks: DiffBlock[]; stats: { added: number; removed: number; changed: number }; truncated: boolean } {
  let a = paragraphs(oldText);
  let b = paragraphs(newText);
  const truncated = a.length > MAX_PARAS || b.length > MAX_PARAS;
  a = a.slice(0, MAX_PARAS);
  b = b.slice(0, MAX_PARAS);
  const raw = diffArrays(a, b);
  const blocks: DiffBlock[] = [];
  const stats = { added: 0, removed: 0, changed: 0 };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (!ch.added && !ch.removed) {
      blocks.push({ type: "same", head: ch.value, skipped: 0, tail: [] });
      continue;
    }
    const next = raw[i + 1];
    // odebrané + přidané odstavce za sebou = změna; páruje se po odstavcích, zbytek je přidání / odebrání
    if (ch.removed && next?.added) {
      const n = Math.min(ch.value.length, next.value.length);
      for (let k = 0; k < n; k++) {
        const parts: DiffPart[] = diffWordsWithSpace(ch.value[k]!, next.value[k]!).map((p) => ({ t: p.added ? "+" : p.removed ? "-" : "=", v: p.value }));
        // téměř celý odstavec jiný → zobrazit jako odebrání + přidání (čitelnější)
        const same = parts.filter((p) => p.t === "=").reduce((s, p) => s + p.v.length, 0);
        if (same < Math.min(ch.value[k]!.length, next.value[k]!.length) * 0.3) {
          blocks.push({ type: "del", lines: [ch.value[k]!] }, { type: "add", lines: [next.value[k]!] });
          stats.removed++;
          stats.added++;
        } else {
          blocks.push({ type: "mod", parts });
          stats.changed++;
        }
      }
      if (ch.value.length > n) {
        blocks.push({ type: "del", lines: ch.value.slice(n) });
        stats.removed += ch.value.length - n;
      }
      if (next.value.length > n) {
        blocks.push({ type: "add", lines: next.value.slice(n) });
        stats.added += next.value.length - n;
      }
      i++;
      continue;
    }
    blocks.push({ type: ch.added ? "add" : "del", lines: ch.value });
    if (ch.added) stats.added += ch.value.length;
    else stats.removed += ch.value.length;
  }
  // zkrátit nezměněné úseky na kontext kolem změn
  const out: DiffBlock[] = [];
  blocks.forEach((bl, i) => {
    if (bl.type !== "same") return out.push(bl);
    const lines = bl.head;
    const keepHead = i === 0 ? 0 : context;
    const keepTail = i === blocks.length - 1 ? 0 : context;
    if (lines.length <= keepHead + keepTail + 1) return out.push(bl);
    const head = lines.slice(0, keepHead);
    const tail = keepTail ? lines.slice(-keepTail) : [];
    out.push({ type: "same", head, skipped: lines.length - head.length - tail.length, tail });
  });
  return { blocks: out, stats, truncated };
}
