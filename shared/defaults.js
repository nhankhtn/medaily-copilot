/** Shared defaults for Medaily Copilot settings. */

/** Hardcoded live medaily-ai origin — not editable in the popup. */
export const API_BASE_URL = "https://ai.medaily.id.vn";

export const DEFAULT_SETTINGS = {
  apiBaseUrl: API_BASE_URL,
  apiKey: "",
  /** Dedicated Copilot UUID — never the Medaily session user id. */
  userId: "",
  useMock: false,
  maxPageTextChars: 4000,
  /** When true, the floating launcher FAB is hidden on every page. */
  launcherHidden: false,
};

/**
 * Extension contract (POST {API_BASE_URL}/api/extension/chat):
 *
 * {
 *   message: string,     // [Browser Copilot] + [Current page] + [User question]
 *   userId?: uuid,       // Copilot-only
 *   threadId?: string,
 *   history?: [{ role: "user"|"model", text: string }]
 * }
 *
 * Response: { threadId, answer, model, decision: { filing: "none", ... } }
 *
 * Auth: Authorization: Bearer <SERVICE_TOKEN>
 *
 * This path does NOT use the in-app /api/chat graph, filing router, or GUIDE.
 */
