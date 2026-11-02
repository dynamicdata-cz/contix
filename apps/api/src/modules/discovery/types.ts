import type { AssetType, Criticality, Environment, SourceType } from "@contix/shared";

/** Normalizovaný výstup libovolného konektoru (Wazuh, nmap, CSV, …). */
export interface DiscoveredAsset {
  sourceType: SourceType;
  /** Stabilní ID ve zdrojovém systému (Wazuh agent ID, MAC/IP ze skenu, ID z importu). */
  sourceRef: string;
  name: string;
  assetType: AssetType;
  hostname?: string | null;
  fqdn?: string | null;
  ipAddresses?: string[];
  macAddresses?: string[];
  osName?: string | null;
  osVersion?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  attributes?: Record<string, unknown>;
  software?: { name: string; version?: string | null; vendor?: string | null }[];
  raw?: Record<string, unknown>;
  seenAt?: Date;
  /** Řídicí atributy – použijí se JEN při založení nového aktiva (např. z importu). */
  governance?: {
    description?: string | null;
    location?: string | null;
    ownerName?: string | null;
    criticality?: Criticality;
    environment?: Environment | null;
    tags?: string[];
  };
}

export interface ConnectorContext {
  log: (msg: string) => void;
}

/** Každý konektor je async generátor – streamuje položky, nemusí vše držet v paměti. */
export interface Connector<P = unknown> {
  id: string;
  collect(params: P, ctx: ConnectorContext): AsyncIterable<DiscoveredAsset>;
}
