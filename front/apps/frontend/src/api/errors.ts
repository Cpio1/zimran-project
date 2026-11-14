import type { ApiErrorBody, ErrorCode } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK_ERROR" | "BAD_RESPONSE";
  readonly retryable: boolean;
  readonly requestId: string | null;

  constructor(opts: { status: number; code: ApiError["code"]; message: string; retryable: boolean; requestId?: string | null }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable;
    this.requestId = opts.requestId ?? null;
  }

  static fromBody(status: number, body: ApiErrorBody, requestId: string | null) {
    return new ApiError({ status, code: body.code, message: body.message, retryable: body.retryable, requestId });
  }

  get isConflict() {
    return this.status === 409 || this.code === "CONFLICT";
  }
  get isSessionError() {
    return this.status === 401 && (this.code === "DEMO_SESSION_REQUIRED" || this.code === "DEMO_SESSION_EXPIRED");
  }
  get isNotFound() {
    return this.status === 404 || this.code === "NOT_FOUND";
  }
}

/**
 * Thrown for a mutation that hit an expired demo session. A new session was created,
 * but the mutation is NOT replayed: its UUIDs belonged to the old space.
 */
export class SessionReplacedError extends ApiError {
  constructor(requestId: string | null) {
    super({
      status: 401,
      code: "DEMO_SESSION_EXPIRED",
      message: "Your previous demo session ended, so a new empty demo space was started. The last action was not repeated.",
      retryable: false,
      requestId,
    });
    this.name = "SessionReplacedError";
  }
}

const FRIENDLY: Partial<Record<ApiError["code"], string>> = {
  AI_NOT_CONFIGURED: "AI analysis isn't configured on this server yet. Your files are stored; the operator needs to set the model key on the LLM service.",
  LLM_UNAVAILABLE: "The AI service is temporarily unavailable. Try again in a moment.",
  INVALID_LLM_OUTPUT: "The AI returned an answer we couldn't verify, so it wasn't saved. Try again.",
  UNREADABLE_DOCUMENT: "We couldn't read this document. Try a clearer photo or a PDF with selectable text.",
  FILE_TOO_LARGE: "This file is too large.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  STALE_INPUT: "The information changed since this was prepared. Refresh and run it again.",
  CONFLICT: "This was changed elsewhere. Reload the latest version before saving.",
  NETWORK_ERROR: "Can't reach the Claimly server. Check your connection and try again.",
};

export function describeError(err: unknown): { title: string; detail: string; retryable: boolean; code: string | null } {
  if (err instanceof ApiError) {
    return {
      title: FRIENDLY[err.code] ?? err.message ?? "Something went wrong.",
      detail: err.requestId ? `${err.code} · request ${err.requestId}` : err.code,
      retryable: err.retryable,
      code: err.code,
    };
  }
  return { title: "Something went wrong.", detail: err instanceof Error ? err.message : String(err), retryable: true, code: null };
}
