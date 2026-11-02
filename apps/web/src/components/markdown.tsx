import type { ReactNode } from "react";

/** Inline: **tučně**, *kurzíva*, `kód` – bez HTML (React elementy, žádné innerHTML). */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-slate-100 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Jednoduchý bezpečný Markdown pro text dokumentů (nadpisy, odstavce, odrážky, číslované seznamy). */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`} className="my-2 leading-relaxed">{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>);
      blocks.push(list.ordered ? <ol key={`o${blocks.length}`} className="my-2 list-decimal space-y-1 pl-6">{items}</ol> : <ul key={`u${blocks.length}`} className="my-2 list-disc space-y-1 pl-6">{items}</ul>);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      const lvl = h[1]!.length;
      const cls = ["", "mt-5 mb-2 text-xl font-semibold", "mt-4 mb-2 text-lg font-semibold", "mt-3 mb-1 font-semibold", "mt-3 mb-1 font-medium"][lvl];
      blocks.push(<div key={`h${blocks.length}`} role="heading" aria-level={lvl} className={cls}>{inline(h[2]!, `h${blocks.length}`)}</div>);
    } else if (ul || ol) {
      if (para.length) flush();
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]!);
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return <div className="text-sm text-slate-800">{blocks}</div>;
}
