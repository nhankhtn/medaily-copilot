import { DEFAULT_SETTINGS } from "../shared/defaults.js";

/**
 * Call medaily-ai chat endpoint, or return a local mock reply.
 *
 * @param {object} payload
 * @param {Array<{role: string, content: string}>} payload.messages
 * @param {{url: string, title: string, selection?: string, pageText?: string}} payload.context
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {Promise<{reply: string, source: "api" | "mock"}>}
 */
export async function askMedaily(payload, settings) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const shouldMock = cfg.useMock || !cfg.apiKey || !cfg.apiBaseUrl;

  if (shouldMock) {
    return { reply: buildMockReply(payload), source: "mock" };
  }

  const base = String(cfg.apiBaseUrl).replace(/\/+$/, "");
  const url = `${base}/v1/chat`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        messages: payload.messages,
        context: payload.context,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `medaily-ai HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`
      );
    }

    const data = await res.json();
    const reply =
      (typeof data?.reply === "string" && data.reply) ||
      (typeof data?.message?.content === "string" && data.message.content) ||
      (typeof data?.choices?.[0]?.message?.content === "string" &&
        data.choices[0].message.content);

    if (!reply) {
      throw new Error("medaily-ai response missing reply text");
    }

    return { reply, source: "api" };
  } finally {
    clearTimeout(timeout);
  }
}

function buildMockReply(payload) {
  const lastUser = [...(payload.messages || [])]
    .reverse()
    .find((m) => m.role === "user");
  const question = (lastUser?.content || "").trim();
  const title = payload.context?.title || "this page";
  const host = safeHost(payload.context?.url);
  const selection = (payload.context?.selection || "").trim();
  const pageSnippet = (payload.context?.pageText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  const lines = [
    `Mock Medaily reply (no live API call).`,
    ``,
    `You asked about “${title}”${host ? ` on ${host}` : ""}.`,
  ];

  if (question) {
    lines.push(`Question: ${truncate(question, 240)}`);
  }
  if (selection) {
    lines.push(`Selected text: “${truncate(selection, 160)}”`);
  } else if (pageSnippet) {
    lines.push(`Page excerpt: “${pageSnippet}${pageSnippet.length >= 180 ? "…" : ""}”`);
  }

  lines.push(
    ``,
    `Wire a real service by setting the API base URL + key in the extension popup and turning off Mock mode. See README for the /v1/chat contract.`
  );

  return lines.join("\n");
}

function safeHost(url) {
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
