import { AssetType, Criticality, Environment } from "@contix/shared";
import type { Connector, DiscoveredAsset } from "../types";

/**
 * Generický CSV import.
 * Oddělovač se detekuje automaticky (; nebo ,). Více hodnot v buňce (IP, MAC, tagy) odděl "|".
 * Hlavičky jsou case-insensitive; podporované sloupce viz COLUMN_ALIASES.
 * Specializované importy (GLPI, Snipe-IT, Lansweeper, ServiceNow CMDB, …) budou mapovat
 * vlastní formát na stejný DiscoveredAsset – viz docs/03_modules/asset/import.md.
 */

export interface CsvParams {
  content: string;
  fileName?: string;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  externalId: ["external_id", "id", "asset_id", "asset tag", "asset_tag", "inventární číslo"],
  name: ["name", "název", "nazev", "asset name"],
  assetType: ["type", "asset_type", "typ"],
  hostname: ["hostname", "host"],
  fqdn: ["fqdn"],
  ipAddresses: ["ip", "ip_address", "ip_addresses", "ip adresa"],
  macAddresses: ["mac", "mac_address", "mac_addresses"],
  osName: ["os", "os_name", "operating system"],
  osVersion: ["os_version"],
  manufacturer: ["manufacturer", "vendor", "výrobce"],
  model: ["model"],
  serialNumber: ["serial", "serial_number", "sériové číslo"],
  location: ["location", "umístění", "lokalita"],
  ownerName: ["owner", "vlastník", "vlastnik"],
  criticality: ["criticality", "kritičnost"],
  environment: ["environment", "prostředí"],
  tags: ["tags", "štítky"],
  description: ["description", "popis"],
};

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const multi = (v?: string) =>
  (v ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

export function csvToAssets(content: string, fileName = "import.csv"): { items: DiscoveredAsset[]; errors: string[] } {
  const [header, ...rows] = parseCsv(content);
  if (!header) return { items: [], errors: ["Prázdný soubor"] };
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) if (aliases.includes(key)) idx[field] = i;
  });
  if (idx.name === undefined) return { items: [], errors: ['Chybí povinný sloupec "name"'] };

  const items: DiscoveredAsset[] = [];
  const errors: string[] = [];
  rows.forEach((r, n) => {
    const get = (f: string) => (idx[f] !== undefined ? r[idx[f]!]?.trim() || undefined : undefined);
    const line = n + 2;
    const name = get("name");
    if (!name) return errors.push(`Řádek ${line}: chybí název`);
    const type = AssetType.safeParse(get("assetType") ?? "other");
    if (!type.success) return errors.push(`Řádek ${line}: neznámý typ "${get("assetType")}"`);
    const crit = get("criticality") ? Criticality.safeParse(get("criticality")) : undefined;
    if (crit && !crit.success) return errors.push(`Řádek ${line}: neznámá kritičnost "${get("criticality")}"`);
    const env = get("environment") ? Environment.safeParse(get("environment")) : undefined;

    items.push({
      sourceType: "import",
      sourceRef: `csv:${get("externalId") ?? get("serialNumber") ?? name}`,
      name,
      assetType: type.data,
      hostname: get("hostname") ?? null,
      fqdn: get("fqdn") ?? null,
      ipAddresses: multi(get("ipAddresses")),
      macAddresses: multi(get("macAddresses")),
      osName: get("osName") ?? null,
      osVersion: get("osVersion") ?? null,
      manufacturer: get("manufacturer") ?? null,
      model: get("model") ?? null,
      serialNumber: get("serialNumber") ?? null,
      governance: {
        description: get("description") ?? null,
        location: get("location") ?? null,
        ownerName: get("ownerName") ?? null,
        criticality: crit?.data,
        environment: env?.success ? env.data : null,
        tags: multi(get("tags")),
      },
      raw: { fileName, line, row: r },
    });
  });
  return { items, errors };
}

export const csvConnector: Connector<CsvParams> = {
  id: "csv_import",
  async *collect(p, ctx) {
    const { items, errors } = csvToAssets(p.content, p.fileName);
    for (const e of errors) ctx.log(e);
    yield* items;
  },
};
