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
  /** Panel composer mode: "chat" | "agent". */
  panelMode: "chat",
};

/**
 * Extension contracts (Auth: Bearer SERVICE_TOKEN):
 *
 * POST {API_BASE_URL}/api/extension/chat
 *   → { threadId, answer, model, decision: { filing: "none" } }
 *
 * POST {API_BASE_URL}/api/extension/agent
 *   body: { goal, pageSnapshot, toolHistory?, caps?, userId?, threadId? }
 *   → { threadId, done, assistantMessage, actions: [{ tool, args, reason }], model }
 *
 * Neither path uses the in-app /api/chat graph, filing router, or GUIDE.
 */
