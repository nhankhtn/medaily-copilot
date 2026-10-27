/**
 * Anthropic Messages API (paid, no free tier) — tool use.
 * Called from the extension service worker, so the browser-access header is required.
 */

const URL_MESSAGES = "https://api.anthropic.com/v1/messages";

/**
 * @param {object} req
 * @param {string} req.apiKey
 * @param {string} req.model
 * @param {string} req.system
 * @param {Array<{role: "user"|"assistant", text: string, images?: Array<{mimeType: string, data: string}>}>} req.messages
 * @param {Array<{name: string, description: string, parameters: object}>} [req.tools]
 * @param {AbortSignal} [req.signal]
 * @returns {Promise<{text: string, toolCalls: Array<{name: string, args: object}>, model: string}>}
 */
export async function completeAnthropic(req) {
  const body = {
    model: req.model,
    max_tokens: 2048,
    system: req.system,
    messages: req.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.images?.length
        ? [
            ...m.images.map((img) => ({
              type: "image",
              source: { type: "base64", media_type: img.mimeType, data: img.data },
            })),
            { type: "text", text: m.text },
          ]
        : m.text,
    })),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
    body.tool_choice = { type: "any" };
  }

  const res = await fetch(URL_MESSAGES, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const toolCalls = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ name: b.name, args: b.input || {} }));

  if (!text && !toolCalls.length) {
    throw new Error(`Claude returned no content (${data?.stop_reason || "empty"})`);
  }

  return { text, toolCalls, model: data?.model || req.model };
}
