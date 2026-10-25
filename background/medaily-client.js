import { API_BASE_URL, DEFAULT_SETTINGS } from "../shared/defaults.js";

const CHAT_PATH = "/api/chat";
const REQUEST_TIMEOUT_MS = 90_000;
const THREAD_STORAGE_KEY = "medailyThreadId";

/**
 * Call medaily-ai chat endpoint (live only).
 *
 * @param {object} payload
 * @param {Array<{role: string, content: string}>} payload.messages
 * @param {{url: string, title: string, selection?: string, pageText?: string}} payload.context
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {Promise<{reply: string, source: "api", threadId?: string}>}
 */
export async function askMedaily(payload, settings) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const apiKey = String(cfg.apiKey || "").trim();
  if (!apiKey) {
    throw new Error(
      "API key missing — open Medaily Copilot settings and paste your SERVICE_TOKEN."
    );
  }

  const userId = await ensureUserId(cfg);
  const message = buildApiMessage(payload, cfg.maxPageTextChars);
  if (!message) {
    throw new Error("Nothing to send — empty question");
  }

  const base = API_BASE_URL.replace(/\/+$/, "");
  const url = `${base}${CHAT_PATH}`;
  const threadId = await readStoredThreadId();
  const body = {
    message: message.slice(0, 2000),
    userId,
    timezone: guessTimezone(),
  };
  if (threadId) body.threadId = threadId;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `medaily-ai HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`
      );
    }

    const data = await res.json();
    if (typeof data?.threadId === "string" && data.threadId) {
      await storeThreadId(data.threadId);
    }

    const reply = pickReplyText(data);
    if (!reply) {
      throw new Error("medaily-ai response missing answer text");
    }

    return {
      reply,
      source: "api",
      threadId: typeof data?.threadId === "string" ? data.threadId : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Reset the persisted agent thread (e.g. after clearing the chat UI). */
export async function clearMedailyThread() {
  await chrome.storage.session.remove(THREAD_STORAGE_KEY).catch(async () => {
    await chrome.storage.local.remove(THREAD_STORAGE_KEY);
  });
}

function pickReplyText(data) {
  if (typeof data?.answer === "string" && data.answer.trim()) {
    return data.answer;
  }

  // Filing turns stop without an answer — surface the router's reason instead.
  const filing = data?.decision?.filing;
  if (filing && filing !== "none") {
    const reason =
      typeof data?.decision?.reason === "string" ? data.decision.reason.trim() : "";
    return reason
      ? `Looks like a note to file under “${filing}”. ${reason}`
      : `Looks like a note to file under “${filing}” (no answer text from the agent).`;
  }

  if (typeof data?.decision?.reason === "string" && data.decision.reason.trim()) {
    return data.decision.reason;
  }

  return null;
}

/**
 * medaily-ai takes a single `message` string — fold page context into it.
 */
function buildApiMessage(payload, maxPageTextChars) {
  const lastUser = [...(payload.messages || [])]
    .reverse()
    .find((m) => m.role === "user");
  const question = (lastUser?.content || "").trim();
  if (!question) return "";

  const ctx = payload.context || {};
  const parts = [question];
  const meta = [];

  if (ctx.title) meta.push(`Title: ${String(ctx.title).slice(0, 200)}`);
  if (ctx.url) meta.push(`URL: ${String(ctx.url).slice(0, 300)}`);
  const selection = (ctx.selection || "").trim();
  if (selection) meta.push(`Selected text: ${selection.slice(0, 400)}`);
  const pageText = (ctx.pageText || "").replace(/\s+/g, " ").trim();
  const budget = Math.max(200, Number(maxPageTextChars) || 4000);
  if (pageText && !selection) {
    meta.push(`Page excerpt: ${pageText.slice(0, Math.min(800, budget))}`);
  }

  if (meta.length) {
    parts.push("", "[Page context]", ...meta);
  }

  return parts.join("\n").trim();
}

async function ensureUserId(cfg) {
  if (isUuid(cfg.userId)) return cfg.userId;

  const generated = crypto.randomUUID();
  await chrome.storage.sync.set({ userId: generated });
  return generated;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

async function readStoredThreadId() {
  try {
    const session = await chrome.storage.session.get(THREAD_STORAGE_KEY);
    if (typeof session[THREAD_STORAGE_KEY] === "string") {
      return session[THREAD_STORAGE_KEY];
    }
  } catch {
    // session storage may be unavailable in older Chromium — fall through
  }
  const local = await chrome.storage.local.get(THREAD_STORAGE_KEY);
  return typeof local[THREAD_STORAGE_KEY] === "string"
    ? local[THREAD_STORAGE_KEY]
    : "";
}

async function storeThreadId(threadId) {
  try {
    await chrome.storage.session.set({ [THREAD_STORAGE_KEY]: threadId });
  } catch {
    await chrome.storage.local.set({ [THREAD_STORAGE_KEY]: threadId });
  }
}

function guessTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh";
  } catch {
    return "Asia/Ho_Chi_Minh";
  }
}
