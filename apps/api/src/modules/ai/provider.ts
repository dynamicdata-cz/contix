import type { AiProvider } from "@contix/shared";
import type { FetchLike } from "../discovery/connectors/wazuh";

/* ============================================================
 * Abstrakce poskytovatele modelu (ADR-016). Implementace:
 *  - "openai": OpenAI-kompatibilní Chat Completions – Open WebUI (/api), vLLM, LM Studio, Azure-like brány
 *  - "ollama": nativní Ollama /api/chat – přímo (11434) nebo přes proxy Open WebUI (/ollama)
 * Jádro CONTIXu na AI nezávisí – klient se vytváří jen v modulu ai.
 * ============================================================ */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiClientConfig {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutSec: number;
  temperature: number;
  /** Model pro embedding (vektorové vyhledávání). */
  embeddingModel?: string;
}

export interface ChatResult {
  text: string;
  model: string;
  durationMs: number;
}

export interface AiClient {
  chat(messages: ChatMessage[]): Promise<ChatResult>;
  listModels(): Promise<string[]>;
  /** Vektory textů (embedding) – pro vyhledávání podle významu. */
  embed(texts: string[]): Promise<number[][]>;
}

const trimSlash = (u: string) => u.replace(/\/+$/, "");

function checkVectors(v: number[][] | undefined, n: number): number[][] {
  if (!Array.isArray(v) || v.length !== n || v.some((x) => !Array.isArray(x) || !x.length)) throw new Error("AI server nevrátil vektory (je stažený embedding model, např. bge-m3?)");
  return v;
}

export function createAiClient(cfg: AiClientConfig, fetchImpl: FetchLike = fetch as FetchLike): AiClient {
  const base = trimSlash(cfg.baseUrl);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

  async function call(path: string, init: { method: string; body?: unknown }, timeoutMs = cfg.timeoutSec * 1000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctl.signal,
      } as RequestInit);
      const text = await res.text();
      if (!res.ok) {
        const hint = res.status === 401 || res.status === 403 ? (cfg.apiKey ? " – server odmítl API klíč (je platný a jsou v Open WebUI povolené API klíče?)" : " – API klíč není uložen, server ho vyžaduje") : res.status === 404 ? " – zkontrolujte adresu a typ rozhraní" : "";
        throw new Error(`AI server vrátil HTTP ${res.status}${hint}: ${text.slice(0, 200)}`);
      }
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`AI server nevrátil JSON (${text.slice(0, 120)}…)`);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new Error(`AI server neodpověděl do ${Math.round(timeoutMs / 1000)} s`);
      if ((e as Error).message.startsWith("AI server")) throw e;
      throw new Error(`Nelze se spojit s AI serverem ${base}: ${(e as Error).message}`);
    } finally {
      clearTimeout(t);
    }
  }

  async function callAbs(url: string, body: unknown) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), cfg.timeoutSec * 1000);
    try {
      const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctl.signal } as RequestInit);
      const text = await res.text();
      if (!res.ok) throw new Error(`AI server vrátil HTTP ${res.status}: ${text.slice(0, 200)}`);
      return JSON.parse(text) as Record<string, unknown>;
    } finally {
      clearTimeout(t);
    }
  }

  if (cfg.provider === "ollama") {
    return {
      async chat(messages) {
        const t0 = Date.now();
        const r = await call("/api/chat", { method: "POST", body: { model: cfg.model, messages, stream: false, options: { temperature: cfg.temperature } } });
        const msg = r.message as { content?: string } | undefined;
        return { text: msg?.content ?? "", model: String(r.model ?? cfg.model), durationMs: Date.now() - t0 };
      },
      async listModels() {
        const r = await call("/api/tags", { method: "GET" }, 15_000);
        return ((r.models as { name?: string; model?: string }[] | undefined) ?? []).map((m) => m.name ?? m.model ?? "").filter(Boolean);
      },
      async embed(texts) {
        const r = await call("/api/embed", { method: "POST", body: { model: cfg.embeddingModel ?? "bge-m3", input: texts } });
        return checkVectors(r.embeddings as number[][] | undefined, texts.length);
      },
    };
  }

  return {
    async chat(messages) {
      const t0 = Date.now();
      const r = await call("/chat/completions", { method: "POST", body: { model: cfg.model, messages, stream: false, temperature: cfg.temperature } });
      const choice = (r.choices as { message?: { content?: string } }[] | undefined)?.[0];
      return { text: choice?.message?.content ?? "", model: String(r.model ?? cfg.model), durationMs: Date.now() - t0 };
    },
    async listModels() {
      const r = await call("/models", { method: "GET" }, 15_000);
      return ((r.data as { id?: string }[] | undefined) ?? []).map((m) => m.id ?? "").filter(Boolean);
    },
    async embed(texts) {
      const model = cfg.embeddingModel ?? "bge-m3";
      const openAi = async (m: string) => {
        // OpenAI-kompatibilní /embeddings (Open WebUI /api/embeddings, vLLM, LM Studio)
        const r = await call("/embeddings", { method: "POST", body: { model: m, input: texts } });
        return checkVectors(((r.data as { embedding?: number[]; index?: number }[] | undefined) ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding ?? []), texts.length);
      };
      // Open WebUI vrací u neznámého názvu modelu HTTP 500 (Ollama modely vede jako „bge-m3:latest“)
      const retryable = (e: unknown) => /HTTP (404|405|500)/.test((e as Error).message);
      let first: unknown;
      try {
        return await openAi(model);
      } catch (e) {
        if (!retryable(e)) throw e;
        first = e;
      }
      if (!model.includes(":")) {
        try {
          return await openAi(`${model}:latest`);
        } catch (e) {
          if (!retryable(e)) throw e;
        }
      }
      // starší Open WebUI / zabudovaná Ollama: proxy /ollama/api/embed (stejný API klíč)
      try {
        const r = await callAbs(`${new URL(base).origin}/ollama/api/embed`, { model, input: texts });
        return checkVectors(r.embeddings as number[][] | undefined, texts.length);
      } catch {
        throw new Error(`${(first as Error).message.slice(0, 300)} – zkontrolujte, že je na AI serveru stažený embedding model „${model}“ (ollama list) a že ho Open WebUI nabízí.`);
      }
    },
  };
}
