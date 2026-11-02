import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
} from "docx";
import { parse, type HTMLElement, type Node } from "node-html-parser";

/* ============================================================
 * Převod tiskové HTML podoby dokumentů (render.ts) do Wordu (.docx).
 * Podporovaná podmnožina: h1–h3, p, div, table/thead/tbody/tr/th/td, ul/ol/li, b/strong, i/em, br, span, a.
 * Třídy: muted (šedě), small (menší), wm/toolbar/bar (vynechat), meta (dvojice popisek–hodnota).
 * ============================================================ */

type Block = Paragraph | Table;
interface Style {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
}

const SKIP = new Set(["toolbar", "wm", "bar"]);
const BLOCK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "div",
  "table",
  "ul",
  "ol",
  "li",
  "section",
]);
const HEAD: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
};

const isEl = (n: Node): n is HTMLElement => n.nodeType === 1;
const classes = (e: HTMLElement) =>
  new Set((e.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
const skip = (e: HTMLElement) =>
  ["style", "script", "button", "title"].includes(e.tagName?.toLowerCase()) ||
  [...classes(e)].some((c) => SKIP.has(c));

function styleOf(e: HTMLElement, base: Style): Style {
  const tag = e.tagName.toLowerCase();
  const cl = classes(e);
  const s = { ...base };
  if (tag === "b" || tag === "strong" || tag === "th") s.bold = true;
  if (tag === "i" || tag === "em") s.italics = true;
  if (cl.has("small")) s.size = 16;
  if (cl.has("muted")) s.color = "64748B";
  const color = /(?:^|;)\s*color:\s*#([0-9a-f]{6})/i.exec(
    e.getAttribute("style") ?? "",
  );
  if (color) s.color = color[1]!.toUpperCase();
  return s;
}

/** Vložený obsah → TextRun[] (bez bloků). */
function runs(nodes: Node[], st: Style, out: TextRun[] = []): TextRun[] {
  for (const n of nodes) {
    if (!isEl(n)) {
      const t = n.text.replace(/\s+/g, " ");
      if (t) out.push(new TextRun({ text: t, ...(st as IRunOptions) }));
      continue;
    }
    if (skip(n)) continue;
    const tag = n.tagName.toLowerCase();
    if (tag === "br") {
      out.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    runs(n.childNodes, styleOf(n, st), out);
  }
  return out;
}

const hasBlock = (e: HTMLElement) =>
  e.childNodes.some(
    (c) => isEl(c) && !skip(c) && BLOCK_TAGS.has(c.tagName.toLowerCase()),
  );

/** Blokové prvky kontejneru. Vložený text mezi bloky se sloučí do odstavců. */
function blocks(
  nodes: Node[],
  st: Style,
  ctx: { listLevel: number; ordered?: { n: number } } = { listLevel: 0 },
): Block[] {
  const out: Block[] = [];
  let buf: Node[] = [];
  const flush = () => {
    const r = runs(buf, st);
    if (buf.some((n) => n.text.trim()))
      out.push(new Paragraph({ children: r, spacing: { after: 80 } }));
    buf = [];
  };
  for (const n of nodes) {
    if (!isEl(n)) {
      buf.push(n);
      continue;
    }
    if (skip(n)) continue;
    const tag = n.tagName.toLowerCase();
    if (!BLOCK_TAGS.has(tag)) {
      buf.push(n);
      continue;
    }
    flush();
    const s = styleOf(n, st);
    if (HEAD[tag]) {
      out.push(
        new Paragraph({
          heading: HEAD[tag],
          children: runs(n.childNodes, { ...s, color: undefined }),
          spacing: { before: tag === "h1" ? 0 : 240, after: 120 },
          keepNext: true,
        }),
      );
    } else if (tag === "table") {
      const t = table(n, s);
      if (t) {
        out.push(t);
        out.push(new Paragraph({ children: [], spacing: { after: 60 } }));
      }
    } else if (tag === "ul" || tag === "ol") {
      let i = 0;
      for (const li of n.childNodes.filter(
        (c): c is HTMLElement => isEl(c) && c.tagName.toLowerCase() === "li",
      )) {
        i++;
        const inner = li.childNodes.filter(
          (c) => !(isEl(c) && ["ul", "ol"].includes(c.tagName.toLowerCase())),
        );
        const prefix = tag === "ol" ? `${i}. ` : "";
        out.push(
          new Paragraph({
            children: [
              ...(prefix
                ? [new TextRun({ text: prefix, ...(s as IRunOptions) })]
                : []),
              ...runs(inner, s),
            ],
            ...(tag === "ul"
              ? { bullet: { level: Math.min(ctx.listLevel, 5) } }
              : { indent: { left: 360 * (ctx.listLevel + 1) } }),
            spacing: { after: 40 },
          }),
        );
        const nested = li.childNodes.filter(
          (c): c is HTMLElement =>
            isEl(c) && ["ul", "ol"].includes(c.tagName.toLowerCase()),
        );
        if (nested.length)
          out.push(...blocks(nested, s, { listLevel: ctx.listLevel + 1 }));
      }
    } else if (classes(n).has("meta")) {
      // dvojice „popisek – hodnota“ (span, span)
      const spans = n.childNodes.filter((c): c is HTMLElement => isEl(c));
      for (let i = 0; i + 1 < spans.length; i += 2)
        out.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${spans[i]!.text.trim()}: `,
                color: "64748B",
              }),
              ...runs(spans[i + 1]!.childNodes, s),
            ],
            spacing: { after: 40 },
          }),
        );
    } else if (classes(n).has("sig")) {
      for (const d of n.childNodes.filter((c): c is HTMLElement => isEl(c)))
        out.push(
          new Paragraph({
            children: [new TextRun({ text: d.text.trim() })],
            spacing: { before: 360 },
          }),
        );
    } else if (hasBlock(n)) {
      out.push(...blocks(n.childNodes, s, ctx));
    } else {
      const r = runs(n.childNodes, s);
      if (n.text.trim())
        out.push(
          new Paragraph({
            children: r,
            spacing: { after: 80 },
            ...(classes(n).has("assess")
              ? {
                  indent: { left: 240 },
                  border: {
                    left: {
                      style: BorderStyle.SINGLE,
                      size: 12,
                      color: "94A3B8",
                      space: 8,
                    },
                  },
                }
              : {}),
          }),
        );
    }
  }
  flush();
  return out;
}

function cellContent(td: HTMLElement, st: Style): Paragraph[] {
  const bl = blocks(td.childNodes, st).filter(
    (b): b is Paragraph => b instanceof Paragraph,
  );
  return bl.length ? bl : [new Paragraph({ children: [] })];
}

function table(t: HTMLElement, st: Style): Table | null {
  const rows: TableRow[] = [];
  const trs = t.querySelectorAll("tr");
  let maxCols = 0;
  for (const tr of trs) {
    const isHead =
      tr.parentNode &&
      (tr.parentNode as HTMLElement).tagName?.toLowerCase() === "thead";
    const cells = tr.childNodes.filter(
      (c): c is HTMLElement =>
        isEl(c) && ["td", "th"].includes(c.tagName.toLowerCase()),
    );
    if (!cells.length) continue;
    maxCols = Math.max(maxCols, cells.length);
    rows.push(
      new TableRow({
        tableHeader: !!isHead,
        cantSplit: true,
        children: cells.map((c) => {
          const th = c.tagName.toLowerCase() === "th";
          const cs = Number(c.getAttribute("colspan") ?? 1) || 1;
          return new TableCell({
            columnSpan: cs > 1 ? cs : undefined,
            shading: th
              ? { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" }
              : undefined,
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
            children: cellContent(c, {
              ...st,
              size: st.size ?? 18,
              bold: th || st.bold,
            }).map((p) =>
              classes(c).has("n")
                ? new Paragraph({
                    children: [
                      new TextRun({ text: c.text.trim(), size: 18, bold: th }),
                    ],
                    alignment: AlignmentType.RIGHT,
                  })
                : p,
            ),
          });
        }),
      }),
    );
  }
  if (!rows.length) return null;
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

export interface DocxOptions {
  title: string;
  /** Řádek v záhlaví (organizace). */
  headerLine?: string;
  landscape?: boolean;
}

/** HTML (celý dokument nebo fragment) → .docx (Buffer). */
export async function htmlToDocx(
  html: string,
  o: DocxOptions,
): Promise<Buffer> {
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: false, style: false },
  });
  const body =
    root.querySelector(".page") ?? root.querySelector("body") ?? root;
  const children = blocks(body.childNodes, {});
  const doc = new Document({
    creator: "CONTIX",
    title: o.title,
    styles: {
      default: { document: { run: { font: "Calibri", size: 20 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 32, bold: true, color: "0F172A" },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 26, bold: true, color: "1E293B" },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 22, bold: true, color: "334155" },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: o.landscape
              ? {
                  orientation: PageOrientation.LANDSCAPE,
                  width: 11906,
                  height: 16838,
                }
              : { width: 11906, height: 16838 },
            margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: o.headerLine ?? "",
                    size: 16,
                    color: "64748B",
                  }),
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [
                      `${o.title} · strana `,
                      PageNumber.CURRENT,
                      " z ",
                      PageNumber.TOTAL_PAGES,
                    ],
                    size: 16,
                    color: "64748B",
                  }),
                ],
              }),
            ],
          }),
        },
        children: children.length
          ? children
          : [new Paragraph({ children: [] })],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** Bezpečný název souboru pro Content-Disposition. */
export function docxResponse(buf: Buffer, filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store",
    },
  });
}
