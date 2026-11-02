import { CS, formatMessage, type MsgKey, type MsgParams } from "@contix/shared";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Chyba API s přeložitelnou hláškou (ADR-036): `throw new ApiError(404, "err.leg.actNotFound")`.
 * Globální onError ji vrátí v jazyce uživatele; `message` nese českou verzi (logy, testy, klienti bez překladu).
 */
export class ApiError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public readonly key: MsgKey,
    public readonly params?: MsgParams,
  ) {
    super(status, { message: formatMessage("cs", CS[key], params) });
  }
}
