/**
 * Google Gemini (AI Studio key) — generateContent with function calling.
 * Free tier works with Flash / Flash-Lite models, subject to RPM/RPD limits.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

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
export async function completeGemini(req) {
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        ...(m.images || []).map((img) => ({
          inlineData: { mimeType: img.mimeType, data: img.data },
        })),
        { text: m.text },
      ],
    })),
  };
  if (req.tools?.length) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: toGeminiSchema(t.parameters),
        })),
      },
    ];
    body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
  }

  const res = await fetch(
    `${BASE}/${encodeURIComponent(req.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": req.apiKey,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new Error(
        "Gemini quota exceeded (free tier RPM/RPD) — wait a minute or switch model."
      );
    }
    throw new Error(`Gemini HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  const toolCalls = parts
    .filter((p) => p.functionCall?.name)
    .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));

  if (!text && !toolCalls.length) {
    const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || "empty";
    throw new Error(`Gemini returned no content (${reason})`);
  }

  return { text, toolCalls, model: data?.modelVersion || req.model };
}

/** JSON Schema (lowercase types) → Gemini OpenAPI subset (uppercase types). */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") {
      out.type = value.toUpperCase();
    } else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)])
      );
    } else if (key === "items") {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
