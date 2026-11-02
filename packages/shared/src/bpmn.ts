/**
 * Generátor BPMN 2.0 XML z kroků procesu.
 * - dráhy (lanes) podle toho, kdo krok provádí (RACI "R", jinak "A"), jinak dráha "Neurčeno",
 * - činnosti / rozhodnutí / podprocesy v pořadí kroků, propojené sekvenčními toky,
 * - včetně BPMNDI (souřadnice), aby se diagram rovnou vykreslil v bpmn-js a dalších nástrojích.
 */

export interface BpmnStep {
  id: string;
  name: string;
  stepType: "task" | "decision" | "subprocess" | "event";
  lane: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sid = (s: string) => `_${s.replace(/[^a-zA-Z0-9]/g, "")}`;

export function generateBpmn(processName: string, steps: BpmnStep[]): string {
  const laneNames = [...new Set(steps.map((s) => s.lane ?? "Neurčeno"))];
  if (!laneNames.length) laneNames.push("Neurčeno");
  const LANE_H = 140;
  const X0 = 180;
  const GAP = 150;
  const poolW = Math.max(600, X0 + (steps.length + 2) * GAP);
  const laneY = (name: string) => 60 + laneNames.indexOf(name) * LANE_H;

  type Node = { id: string; kind: string; name: string; x: number; y: number; w: number; h: number; lane: string };
  const nodes: Node[] = [];
  const firstLane = steps[0]?.lane ?? laneNames[0]!;
  nodes.push({ id: "StartEvent_1", kind: "startEvent", name: "Start", x: 100, y: laneY(firstLane) + LANE_H / 2 - 18, w: 36, h: 36, lane: firstLane });
  steps.forEach((s, i) => {
    const lane = s.lane ?? "Neurčeno";
    const x = X0 + i * GAP;
    const kind = s.stepType === "decision" ? "exclusiveGateway" : s.stepType === "subprocess" ? "subProcess" : s.stepType === "event" ? "intermediateThrowEvent" : "task";
    const [w, h] = kind === "exclusiveGateway" ? [50, 50] : kind === "intermediateThrowEvent" ? [36, 36] : [110, 80];
    nodes.push({ id: `Step${sid(s.id)}`, kind, name: s.name, x, y: laneY(lane) + LANE_H / 2 - h / 2, w, h, lane });
  });
  const lastLane = steps.at(-1)?.lane ?? firstLane;
  nodes.push({ id: "EndEvent_1", kind: "endEvent", name: "Konec", x: X0 + steps.length * GAP + 20, y: laneY(lastLane) + LANE_H / 2 - 18, w: 36, h: 36, lane: lastLane });

  const flows = nodes.slice(1).map((n, i) => ({ id: `Flow_${i + 1}`, from: nodes[i]!, to: n }));

  const laneXml = laneNames
    .map(
      (l, i) =>
        `      <bpmn:lane id="Lane_${i + 1}" name="${esc(l)}">\n${nodes
          .filter((n) => n.lane === l)
          .map((n) => `        <bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`)
          .join("\n")}\n      </bpmn:lane>`,
    )
    .join("\n");

  const nodeXml = nodes
    .map((n) => {
      const inc = flows.filter((f) => f.to.id === n.id).map((f) => `<bpmn:incoming>${f.id}</bpmn:incoming>`).join("");
      const out = flows.filter((f) => f.from.id === n.id).map((f) => `<bpmn:outgoing>${f.id}</bpmn:outgoing>`).join("");
      return `    <bpmn:${n.kind} id="${n.id}" name="${esc(n.name)}">${inc}${out}</bpmn:${n.kind}>`;
    })
    .join("\n");
  const flowXml = flows.map((f) => `    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.from.id}" targetRef="${f.to.id}" />`).join("\n");

  const shapes = [
    `      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true"><dc:Bounds x="30" y="60" width="${poolW}" height="${laneNames.length * LANE_H}" /></bpmndi:BPMNShape>`,
    ...laneNames.map(
      (_, i) =>
        `      <bpmndi:BPMNShape id="Lane_${i + 1}_di" bpmnElement="Lane_${i + 1}" isHorizontal="true"><dc:Bounds x="60" y="${60 + i * LANE_H}" width="${poolW - 30}" height="${LANE_H}" /></bpmndi:BPMNShape>`,
    ),
    ...nodes.map(
      (n) =>
        `      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${n.kind === "exclusiveGateway" ? ' isMarkerVisible="true"' : ""}><dc:Bounds x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" /></bpmndi:BPMNShape>`,
    ),
    ...flows.map((f) => {
      const x1 = f.from.x + f.from.w;
      const y1 = f.from.y + f.from.h / 2;
      const x2 = f.to.x;
      const y2 = f.to.y + f.to.h / 2;
      const mid = Math.round((x1 + x2) / 2);
      const pts = y1 === y2 ? [[x1, y1], [x2, y2]] : [[x1, y1], [mid, y1], [mid, y2], [x2, y2]];
      return `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">${pts.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join("")}</bpmndi:BPMNEdge>`;
    }),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://contix.local/bpmn" exporter="CONTIX" exporterVersion="0.5">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="${esc(processName)}" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
${laneXml}
    </bpmn:laneSet>
${nodeXml}
${flowXml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1">
${shapes}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
