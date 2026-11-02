import { parse, type HTMLElement, type Node } from "node-html-parser";
import type { SourceFragment } from "./esbirka";

/* ---------- rozdělení XHTML na fragmenty ---------- */

const BLOCK = new Set(["p", "div", "tr", "table", "tbody", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "dl", "dt", "dd"]);
/** Odkazy na poznámky pod čarou, značky změn (▼M2), šipky a výhrady se do textu nepočítají. */
function skip(el: HTMLElement): boolean {
  const id = el.id ?? "";
  const cls = el.getAttribute("class") ?? "";
  if (el.rawTagName?.toLowerCase() === "a" && /^(ntc|src|E\d)/.test(id)) return true;
  return /\b(modref|arrow|disclaimer|oj-note-tag|reference|footnote|hd-modifiers)\b/.test(cls);
}
function textOf(node: Node): string {
  let out = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      out += n.rawText;
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as HTMLElement;
    if (skip(el)) return;
    const tag = el.rawTagName?.toLowerCase() ?? "";
    if (tag === "script" || tag === "style" || tag === "col") return;
    const block = BLOCK.has(tag);
    if (block) out += "\n";
    if (tag === "td") out += " ";
    for (const ch of el.childNodes) walk(ch);
    if (block) out += "\n";
  };
  walk(node);
  return decodeEntities(out)
    .replace(/[ \t  ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/ +([.,;:])(?=\s|$)/g, "$1")
    .replace(/^(\(?[a-z0-9]{1,4}\)|[—–-]|\d+[a-z]?(?:\.\d+)*\.?)\n/gim, "$1 ")
    .trim();
}
function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

const PARA_RE = /^(\d+[a-z]?)\.(?:\s|$)/;
const POINT_RE = /^(\d+(?:\.\d+)+)\.?(?:\s|$)/;
const ART_HEAD_RE = /^(?:Článek|Article)\s+(\d+[a-z]*)\s*$/i;
const ANNEX_HEAD_RE = /^(?:PŘÍLOHA|ANNEX)(?:\s+([IVXLC]+|\d+[a-z]?))?\s*$/i;

interface Acc {
  out: SourceFragment[];
  used: Map<string, number>;
}
function push(acc: Acc, key: string, label: string, text: string, depth: number, kind: string) {
  const t = text.trim();
  if (!t) return;
  const n = (acc.used.get(key) ?? 0) + 1;
  acc.used.set(key, n);
  acc.out.push({
    key: n > 1 ? `${key}~${n}` : key,
    label: label.slice(0, 500),
    text: t,
    depth,
    kind,
    sourceId: null,
  });
}

/** Článek → jeden fragment (bez číslovaných odstavců) nebo nadpis + odstavce („1.“, „1a.“). */
function article(acc: Acc, num: string, title: string, blocks: string[]) {
  const art = `cl_${num.toLowerCase()}`;
  const label = `Článek ${num}`;
  let intro = "";
  const paras: { n: string; text: string }[] = [];
  for (const b of blocks) {
    const m = b.match(PARA_RE);
    if (m) paras.push({ n: m[1]!, text: b });
    else if (paras.length) paras.at(-1)!.text += `\n${b}`;
    else intro += `${b}\n`;
  }
  if (!paras.length) return push(acc, art, title ? `${label} – ${title}` : label, intro || title, 0, "clanek");
  push(acc, art, title ? `${label} – ${title}` : label, intro || title, 0, "clanek");
  for (const p of paras) push(acc, `${art}-odst_${p.n.toLowerCase()}`, `Čl. ${num} odst. ${p.n}`, p.text, 1, "odstavec");
}

/** Příloha → body „1.1.1.“ (prováděcí nařízení k NIS2), jinak jeden fragment (seznamy „1.“ bez podbodů zůstávají celé). */
function annex(acc: Acc, id: string, heading: string, blocks: string[]) {
  const key = `priloha_${id}`;
  const label = heading || `Příloha ${id}`;
  const short = label.split(" – ")[0]!;
  if (blocks.filter((b) => POINT_RE.test(b)).length < 3) return push(acc, key, label, blocks.join("\n"), 0, "priloha");
  let cur: { k: string; l: string; text: string; d: number } = {
    k: key,
    l: label,
    text: "",
    d: 0,
  };
  const flush = () => push(acc, cur.k, cur.l, cur.text || cur.l, cur.d, cur.k === key ? "priloha" : "bod");
  for (const b of blocks) {
    const m = b.match(POINT_RE) ?? b.match(/^(\d+)\.\s/);
    if (m) {
      flush();
      cur = {
        k: `${key}-bod_${m[1]}`,
        l: `${short}, bod ${m[1]}`,
        text: b,
        d: m[1]!.split(".").length,
      };
    } else cur.text += `${cur.text ? "\n" : ""}${b}`;
  }
  flush();
}

/** Bloky textu přímých potomků (u tabulek celý řádek / tabulka jako jeden blok). */
function childBlocks(el: HTMLElement, skipFirst: (c: HTMLElement) => boolean): string[] {
  const out: string[] = [];
  for (const c of el.childNodes) {
    if (c.nodeType === 3) {
      const t = textOf(c);
      if (t) out.push(t);
      continue;
    }
    if (c.nodeType !== 1) continue;
    const ce = c as HTMLElement;
    if (skip(ce) || skipFirst(ce)) continue;
    const t = textOf(ce);
    if (t) out.push(t);
  }
  return out;
}

/** Projde XHTML z CELLAR (Úřední věstník nebo konsolidované znění) a vrátí fragmenty v pořadí dokumentu. */
export function parseEurLexXhtml(xhtml: string): SourceFragment[] {
  const root = parse(xhtml.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/i, ""), { comment: false, blockTextElements: { script: false, style: false } });
  const acc: Acc = { out: [], used: new Map() };
  const arts = root.querySelectorAll("div").filter((d) => /^art_\d+[a-z]*$/i.test(d.id ?? ""));
  if (arts.length) {
    // struktura ELI: div#art_N (+ div#art_N.tit_1), přílohy div#anx_*
    const nodes = root.querySelectorAll("div").filter((d) => /^(art_\d+[a-z]*|anx_[0-9A-Za-z]+)$/.test(d.id ?? ""));
    for (const d of nodes) {
      const id = d.id!;
      if (id.startsWith("art_")) {
        const num = id.slice(4);
        const title = d.querySelector(`[id="${id}.tit_1"]`);
        const titleText = title ? textOf(title) : "";
        const blocks = childBlocks(d, (c) => c === title || ART_HEAD_RE.test(textOf(c)));
        article(acc, num, titleText, blocks);
      } else {
        const aid = id.slice(4);
        const blocks = childBlocks(d, () => false);
        const headIdx = blocks.findIndex((b) => ANNEX_HEAD_RE.test(b.split("\n")[0]!));
        const heading = headIdx >= 0 ? blocks[headIdx]!.split("\n")[0]! : "";
        const rest = blocks.filter((_, i) => i !== headIdx);
        // podnadpis přílohy (první blok bez čísla) patří k nadpisu
        const sub = rest[0] && !POINT_RE.test(rest[0]) && !/^\d+\.\s/.test(rest[0]) && rest[0].length < 300 ? rest.shift()! : "";
        annex(
          acc,
          /^\d+$/.test(aid) || /^[IVXLC]+$/.test(aid) ? aid : aid.toUpperCase(),
          [heading ? heading.replace(/^PŘÍLOHA/i, "Příloha").replace(/^ANNEX/i, "Annex") : "", sub].filter(Boolean).join(" – "),
          sub && !heading ? [sub, ...rest] : rest,
        );
      }
    }
    return acc.out;
  }
  // starší XHTML bez ELI: ploché odstavce, článek začíná nadpisem „Článek N“, příloha „PŘÍLOHA X“
  const body = root.querySelector("body") ?? root;
  const blocks: string[] = [];
  const walk = (el: HTMLElement) => {
    for (const c of el.childNodes) {
      if (c.nodeType !== 1) continue;
      const ce = c as HTMLElement;
      if (skip(ce)) continue;
      const tag = ce.rawTagName?.toLowerCase();
      if (tag === "p" || tag === "table") {
        const t = textOf(ce);
        if (t) blocks.push(t);
      } else walk(ce);
    }
  };
  walk(body);
  let mode: "pre" | "art" | "anx" = "pre";
  let num = "";
  let title = "";
  let buf: string[] = [];
  let annexNo = 0;
  const flush = () => {
    if (mode === "art") article(acc, num, title, buf);
    if (mode === "anx") annex(acc, num, title, buf);
    buf = [];
    title = "";
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const art = b.match(ART_HEAD_RE);
    const anx = b.match(ANNEX_HEAD_RE);
    if (art) {
      flush();
      mode = "art";
      num = art[1]!;
      // podnadpis článku (krátký řádek bez čísla odstavce)
      const next = blocks[i + 1];
      if (next && next.length < 200 && !PARA_RE.test(next) && !ART_HEAD_RE.test(next)) {
        title = next;
        i++;
      }
    } else if (anx) {
      flush();
      mode = "anx";
      annexNo++;
      num = anx[1] ?? String(annexNo);
      title = b.replace(/^PŘÍLOHA/i, "Příloha").replace(/^ANNEX/i, "Annex");
    } else if (mode !== "pre") buf.push(b);
  }
  flush();
  return acc.out;
}
