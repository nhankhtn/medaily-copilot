/** Shared defaults for Medaily Copilot settings. */

export const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://127.0.0.1:8787",
  apiKey: "",
  useMock: true,
  maxPageTextChars: 4000,
};

/**
 * Expected medaily-ai request shape (POST {apiBaseUrl}/v1/chat):
 *
 * {
 *   messages: [{ role: "user" | "assistant" | "system", content: string }],
 *   context: {
 *     url: string,
 *     title: string,
 *     selection?: string,
 *     pageText?: string
 *   }
 * }
 *
 * Expected response:
 * { reply: string }
 *
 * Auth header when apiKey is set: Authorization: Bearer <apiKey>
 */
