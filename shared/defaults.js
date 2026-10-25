/** Shared defaults for Medaily Copilot settings. */

export const DEFAULT_SETTINGS = {
  apiBaseUrl: "https://ai.medaily.id.vn",
  apiKey: "",
  userId: "",
  useMock: true,
  maxPageTextChars: 4000,
  /** When true, the floating launcher FAB is hidden on every page. */
  launcherHidden: false,
};

/**
 * Real medaily-ai contract (POST {apiBaseUrl}/api/chat):
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
 * There is no /v1/chat on this service.
 */
