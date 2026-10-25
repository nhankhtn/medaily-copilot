import { API_BASE_URL, DEFAULT_SETTINGS } from "../shared/defaults.js";

/** Dedicated extension path — not the in-app `/api/chat` assistant. */
const CHAT_PATH = "/api/extension/chat";
const REQUEST_TIMEOUT_MS = 90_000;
const THREAD_STORAGE_KEY = "medailyCopilotThreadId";

/**
 * Call medaily-ai extension Copilot endpoint (isolated from in-app assistant).
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

  const userId = await ensureCopilotUserId(cfg);
  const message = buildApiMessage(payload, cfg.maxPageTextChars);
  if (!message) {
    throw new Error("Nothing to send — empty question");
  }

  const base = API_BASE_URL.replace(/\/+$/, "");
  const url = `${base}${CHAT_PATH}`;
  const threadId = await readStoredThreadId();
  const body = {
    message,
    userId,
    timezone: guessTimezone(),
    history: buildHistory(payload.messages),
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

    const reply =
      typeof data?.answer === "string" && data.answer.trim()
        ? data.answer
        : null;
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

/** Reset the persisted agent thread. */
export async function clearMedailyThread() {
  await chrome.storage.session.remove(THREAD_STORAGE_KEY).catch(async () => {
    await chrome.storage.local.remove(THREAD_STORAGE_KEY);
  });
}

/** Prior turns for the extension endpoint (excludes the latest user message). */
function buildHistory(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const prior = list.slice(0, -1).slice(-8);
  return prior
    .map((m) => {
      const text = String(m?.content || "").trim();
      if (!text) return null;
      if (m.role === "user") return { role: "user", text: text.slice(0, 2000) };
      if (m.role === "assistant")
        return { role: "model", text: text.slice(0, 2000) };
      return null;
    })
    .filter(Boolean);
}

/**
 * Page ground truth FIRST, then the question (API allows 4000 on extension path).
 */
function buildApiMessage(payload, maxPageTextChars) {
  const lastUser = [...(payload.messages || [])]
    .reverse()
    .find((m) => m.role === "user");
  const question = (lastUser?.content || "").trim();
  if (!question) return "";

  const ctx = payload.context || {};
  const url = String(ctx.url || "").slice(0, 500);
  const title = String(ctx.title || "").slice(0, 240);
  const selection = (ctx.selection || "").trim().slice(0, 500);
  const pageText = (ctx.pageText || "").replace(/\s+/g, " ").trim();

  const instruction = [
    "[Browser Copilot]",
    "You are a browser page assistant for the tab described below.",
    "Treat [Current page] as ground truth for which site/page the user is on.",
    "Answer using that page context. Do NOT claim you are the Medaily in-app assistant.",
    "Do NOT suggest Ctrl+K / Ctrl+J / in-app navigation unless the page URL is the Medaily app itself.",
  ].join(" ");

  const pageLines = ["[Current page]"];
  pageLines.push(`URL: ${url || "(unknown)"}`);
  pageLines.push(`Title: ${title || "(untitled)"}`);
  if (selection) pageLines.push(`Selected text: ${selection}`);

  const prefix = [instruction, "", ...pageLines, ""].join("\n");
  const questionBlock = `[User question]\n${question}`;
  const remaining = Math.max(0, 4000 - prefix.length - questionBlock.length - 24);
  const excerptBudget = Math.min(
    remaining,
    Math.max(120, Number(maxPageTextChars) || 4000)
  );
  if (!selection && pageText && excerptBudget > 40) {
    pageLines.push(`Excerpt: ${pageText.slice(0, excerptBudget)}`);
  }

  return [instruction, "", ...pageLines, "", questionBlock].join("\n").slice(0, 4000);
}

/**
 * Always a Copilot-owned UUID in sync storage. Never Medaily session id.
 */
async function ensureCopilotUserId(cfg) {
  if (isUuid(cfg.userId)) return cfg.userId;

  const stored = await chrome.storage.sync.get({ userId: "" });
  if (isUuid(stored.userId)) return stored.userId;

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
    // fall through
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
