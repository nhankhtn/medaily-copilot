/** Shared defaults for Medaily Copilot settings. */

/** Hardcoded live medaily-ai origin — not editable in the popup. */
export const API_BASE_URL = "https://ai.medaily.id.vn";

export const DEFAULT_SETTINGS = {
  apiBaseUrl: API_BASE_URL,
  apiKey: "",
  userId: "",
  useMock: false,
  maxPageTextChars: 4000,
  /** When true, the floating launcher FAB is hidden on every page. */
  launcherHidden: false,
};

/**
 * Real medaily-ai contract (POST {API_BASE_URL}/api/chat):
 *
 * Request:
 * {
 *   message: string,          // 1–2000 chars; page context folded into this
 *   userId: string,           // UUID — whose data the agent may read
 *   threadId?: string,        // omit to start; send back to continue
 *   timezone?: string         // IANA name
 * }
 *
 * Response:
 * { threadId, answer, decision?, models?, turns? }
 *
 * Auth: Authorization: Bearer <SERVICE_TOKEN> (extension "API key")
 *
 * Product FE streams the same body via POST /api/chat/live (SSE).
 */
