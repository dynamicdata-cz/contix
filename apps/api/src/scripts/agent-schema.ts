/**
 * JSON Schema obálky protokolu agentů v1 ze schématu Zod (ADR-177): `bun src/scripts/agent-schema.ts [výstup.json]`.
 * Výstup patří do repozitáře contix-agent (`schema/protocol-v1.schema.json`) – tam se ručně neupravuje.
 */
import { writeFileSync } from "node:fs";
import { AgentEnvelopeV1 } from "@contix/shared";
import { z } from "zod";

const schema = { ...z.toJSONSchema(AgentEnvelopeV1), $id: "https://github.com/dynamicdata-cz/contix-agent/schema/protocol-v1.schema.json", title: "CONTIX agent protocol v1 – envelope" };
const json = `${JSON.stringify(schema, null, 2)}\n`;
const out = process.argv[2];
if (out) {
  writeFileSync(out, json);
  console.error(`Schéma zapsáno do ${out}`);
} else process.stdout.write(json);
