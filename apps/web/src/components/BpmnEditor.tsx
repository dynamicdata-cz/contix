/**
 * BPMN 2.0 editor (bpmn-js, bpmn.io). Načítá se líně – knihovna je velká a potřebuje ji jen záložka Diagram.
 * Pozn.: licence bpmn.io vyžaduje ponechat viditelný watermark bpmn.io v diagramu.
 */
import { tt } from "@/lib/i18n";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface BpmnTask {
  name: string;
  stepType: "task" | "decision" | "subprocess" | "event";
}

export interface BpmnEditorHandle {
  getXml: () => Promise<string>;
  getSvg: () => Promise<string>;
  load: (xml: string) => Promise<void>;
  fit: () => void;
  /** Úlohy z diagramu v pořadí sekvenčního toku (od startu), zbytek podle polohy. */
  tasks: () => BpmnTask[];
}

type Instance = {
  importXML: (xml: string) => Promise<{ warnings: unknown[] }>;
  saveXML: (o?: { format?: boolean }) => Promise<{ xml?: string }>;
  saveSVG: () => Promise<{ svg: string }>;
  get: (service: string) => any;
  on: (event: string, cb: () => void) => void;
  destroy: () => void;
};

const TYPE_MAP: Record<string, BpmnTask["stepType"]> = {
  "bpmn:Task": "task",
  "bpmn:UserTask": "task",
  "bpmn:ManualTask": "task",
  "bpmn:ServiceTask": "task",
  "bpmn:ScriptTask": "task",
  "bpmn:SendTask": "task",
  "bpmn:ReceiveTask": "task",
  "bpmn:BusinessRuleTask": "task",
  "bpmn:ExclusiveGateway": "decision",
  "bpmn:InclusiveGateway": "decision",
  "bpmn:SubProcess": "subprocess",
  "bpmn:CallActivity": "subprocess",
  "bpmn:IntermediateThrowEvent": "event",
  "bpmn:IntermediateCatchEvent": "event",
};

export const BpmnEditor = forwardRef<BpmnEditorHandle, { xml: string; readOnly?: boolean; onChange?: () => void; height?: number }>(function BpmnEditor(
  { xml, readOnly, onChange, height = 560 },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<Instance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const Ctor = readOnly ? (await import("bpmn-js/lib/NavigatedViewer")).default : (await import("bpmn-js/lib/Modeler")).default;
      if (cancelled || !host.current) return;
      const m = new (Ctor as any)({ container: host.current }) as Instance;
      inst.current = m;
      m.on("commandStack.changed", () => onChangeRef.current?.());
      try {
        await m.importXML(xml);
        m.get("canvas").zoom("fit-viewport", "auto");
        setError(null);
      } catch (e) {
        setError(tt("prc.diagramNelzeNacist", { p: (e as Error).message }));
      }
    })();
    return () => {
      cancelled = true;
      inst.current?.destroy();
      inst.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- XML se po načtení mění přes load()
  }, [readOnly]);

  useImperativeHandle(ref, () => ({
    getXml: async () => (await inst.current!.saveXML({ format: true })).xml ?? "",
    getSvg: async () => (await inst.current!.saveSVG()).svg,
    load: async (x: string) => {
      await inst.current!.importXML(x);
      inst.current!.get("canvas").zoom("fit-viewport", "auto");
    },
    fit: () => inst.current?.get("canvas").zoom("fit-viewport", "auto"),
    tasks: () => {
      const reg = inst.current?.get("elementRegistry");
      if (!reg) return [];
      const all = (reg.getAll() as any[]).filter((e) => !e.labelTarget && e.businessObject);
      const nodes = all.filter((e) => TYPE_MAP[e.type] && e.businessObject.name?.trim());
      // průchod tokem od startovních událostí (BFS), aby pořadí odpovídalo procesu
      const ordered: any[] = [];
      const seen = new Set<string>();
      const queue = all.filter((e) => e.type === "bpmn:StartEvent");
      while (queue.length) {
        const cur = queue.shift()!;
        if (seen.has(cur.id)) continue;
        seen.add(cur.id);
        if (TYPE_MAP[cur.type] && cur.businessObject.name?.trim()) ordered.push(cur);
        const outs = ((cur.outgoing ?? []) as any[]).map((f) => f.target).sort((a, b) => a.y - b.y);
        queue.push(...outs);
      }
      const rest = nodes.filter((n) => !seen.has(n.id)).sort((a, b) => a.x - b.x || a.y - b.y);
      return [...ordered, ...rest].map((e) => ({ name: String(e.businessObject.name).trim().slice(0, 255), stepType: TYPE_MAP[e.type]! }));
    },
  }));

  return (
    <div>
      {error && <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div ref={host} className="bpmn-host rounded-md border border-slate-200 bg-white" style={{ height }} />
    </div>
  );
});
