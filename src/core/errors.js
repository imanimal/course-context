// One error type for the whole project. `code` is stable and documented in docs/errors.md;
// `hint` is the next action an agent should take. CLI exit codes derive from `code`.

export class CCError extends Error {
  /**
   * @param {string} code  stable machine code, e.g. "AUTH_INVALID"
   * @param {string} message  what happened
   * @param {{hint?: string, source?: string, dest?: string, status?: number, retryable?: boolean, cause?: unknown}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "CCError";
    this.code = code;
    Object.assign(this, extra);
  }
  toJSON() {
    const o = { code: this.code, message: this.message };
    for (const k of ["hint", "source", "dest", "status", "retryable"]) if (this[k] !== undefined) o[k] = this[k];
    return o;
  }
}

/** Exit codes. 0 ok · 1 error · 2 usage · 3 needs user input (auth, missing values) · 4 not found · 5 partial · 75 transient */
export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, NEEDS_INPUT: 3, NOT_FOUND: 4, PARTIAL: 5, TEMPFAIL: 75 };

export function exitFor(code) {
  if (!code) return EXIT.ERROR;
  if (code === "USAGE") return EXIT.USAGE;
  if (/^(AUTH_|SIGNED_OUT|LMS_ONLY|SECRET_|NEEDS_INPUT|PERMISSION)/.test(code)) return EXIT.NEEDS_INPUT;
  if (/NOT_FOUND|CONFIG_MISSING|NO_SNAPSHOT/.test(code)) return EXIT.NOT_FOUND;
  if (code === "PARTIAL") return EXIT.PARTIAL;
  if (/^(NETWORK|RATE_LIMITED|HTTP_5|TIMEOUT)/.test(code)) return EXIT.TEMPFAIL;
  return EXIT.ERROR;
}

/** Wrap any thrown value as a CCError. */
export function asCC(e, fallback = "ERROR") {
  if (e instanceof CCError) return e;
  const msg = e && e.message ? e.message : String(e);
  if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return new CCError("TIMEOUT", msg, { retryable: true });
  if (e && (e.cause && /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT/.test(String(e.cause.code || e.cause)))) return new CCError("NETWORK", `${msg} (${e.cause.code || e.cause})`, { retryable: true, hint: "Check the host name and the network, then retry." });
  if (/fetch failed/i.test(msg)) return new CCError("NETWORK", msg, { retryable: true, hint: "Check the host name and the network, then retry." });
  return new CCError(fallback, msg, { cause: e });
}

/** CCError for a non-2xx HTTP response. */
export function httpError(status, url, what) {
  const where = (() => { try { return new URL(url).host; } catch { return url; } })();
  if (status === 401) return new CCError("AUTH_INVALID", `${what || where} rejected the credentials (401).`, { status, hint: "The token or password is wrong or expired. Ask the user for a new one." });
  if (status === 403) return new CCError("AUTH_FORBIDDEN", `${what || where} refused access (403).`, { status, hint: "The school may block API tokens. Use the browser extension or a calendar feed source instead." });
  if (status === 404) return new CCError("NOT_FOUND", `${what || where} answered 404 for ${url}.`, { status, hint: "Check the host name and the course or feed URL." });
  if (status === 429) return new CCError("RATE_LIMITED", `${what || where} is rate limiting (429).`, { status, retryable: true, hint: "Wait a few minutes and retry." });
  if (status >= 500) return new CCError("HTTP_5XX", `${what || where} answered ${status}.`, { status, retryable: true, hint: "The service is having trouble. Retry later." });
  return new CCError("HTTP_" + status, `${what || where} answered ${status}.`, { status });
}
