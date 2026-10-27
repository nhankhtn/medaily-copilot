import { API_BASE_URL, DEFAULT_SETTINGS } from "../shared/defaults.js";

/** Dedicated extension paths — not the in-app `/api/chat` assistant. */
const CHAT_PATH = "/api/extension/chat";
const AGENT_PATH = "/api/extension/agent";
const REQUEST_TIMEOUT_MS = 90_000;
const THREAD_STORAGE_KEY = "medailyCopilotThreadId";
const AGENT_THREAD_STORAGE_KEY = "medailyCopilotAgentThreadId";

/**
 * Call medaily-ai extension Copilot endpoint (isolated from in-app assistant).
 *
 * @param {object} payload
 * @param {Array<{role: string, content: string}>} payload.messages
 * @param {{url: string, title: string, selection?: string, pageText?: string, kind?: string, label?: string, subject?: string, thread?: string}} payload.context
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
export function buildHistory(messages) {
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
 * Packs kind / subject / thread when extractors find them (FB, Gmail, etc.).
 * BYOK providers pass a larger totalCap since there is no server-side limit.
 */
export function buildApiMessage(payload, maxPageTextChars, totalCap = 4000) {
  const lastUser = [...(payload.messages || [])]
    .reverse()
    .find((m) => m.role === "user");
  const question = (lastUser?.content || "").trim();
  if (!question) return "";

  const ctx = payload.context || {};
  const url = String(ctx.url || "").slice(0, 500);
  const title = String(ctx.title || "").slice(0, 240);
  const kind = String(ctx.kind || "generic").slice(0, 40);
  const label = String(ctx.label || "").slice(0, 80);
  const selection = (ctx.selection || "").trim().slice(0, 500);
  const subject = (ctx.subject || "").trim().slice(0, 300);
  const thread = (ctx.thread || "").replace(/\s+\n/g, "\n").trim();
  const pageText = (ctx.pageText || "").replace(/\s+/g, " ").trim();

  const instruction = [
    "[Browser Copilot]",
    "You are a browser page assistant for the tab described below.",
    "Treat [Current page] as ground truth for which site/page the user is on.",
    "When Kind is facebook/messenger/gmail, prefer Thread/Subject over generic Excerpt.",
    "Answer using that page context. Do NOT claim you are the Medaily in-app assistant.",
    "Do NOT suggest Ctrl+K / Ctrl+J / in-app navigation unless the page URL is the Medaily app itself.",
  ].join(" ");

  const pageLines = ["[Current page]"];
  pageLines.push(`URL: ${url || "(unknown)"}`);
  pageLines.push(`Title: ${title || "(untitled)"}`);
  pageLines.push(`Kind: ${kind}${label ? ` (${label})` : ""}`);
  if (subject) pageLines.push(`Subject: ${subject}`);
  if (selection) pageLines.push(`Selected text: ${selection}`);

  const prefix = [instruction, "", ...pageLines, ""].join("\n");
  const questionBlock = `[User question]\n${question}`;
  const remaining = Math.max(0, totalCap - prefix.length - questionBlock.length - 40);
  const budget = Math.min(
    remaining,
    Math.max(120, Number(maxPageTextChars) || totalCap)
  );

  if (thread && budget > 40) {
    pageLines.push(`Thread:\n${thread.slice(0, budget)}`);
  } else if (!selection && pageText && budget > 40) {
    pageLines.push(`Excerpt: ${pageText.slice(0, budget)}`);
  }

  return [instruction, "", ...pageLines, "", questionBlock].join("\n").slice(0, totalCap);
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

/**
 * Call medaily-ai extension agent planner (tool plan only; extension executes).
 *
 * @param {{ goal: string, pageSnapshot: string, toolHistory?: string, caps?: {insert?: boolean, send?: boolean} }} payload
 * @param {typeof DEFAULT_SETTINGS} settings
 */
export async function planAgent(payload, settings) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const apiKey = String(cfg.apiKey || "").trim();
  if (!apiKey) {
    throw new Error(
      "API key missing — open Medaily Copilot settings and paste your SERVICE_TOKEN."
    );
  }

  const userId = await ensureCopilotUserId(cfg);
  const goal = String(payload?.goal || "").trim();
  if (!goal) throw new Error("Agent goal is empty");

  const base = API_BASE_URL.replace(/\/+$/, "");
  const url = `${base}${AGENT_PATH}`;
  const threadId = await readStoredAgentThreadId();
  const body = {
    goal: goal.slice(0, 2000),
    pageSnapshot: String(payload?.pageSnapshot || "").slice(0, 16000),
    userId,
  };
  if (payload?.toolHistory) {
    body.toolHistory = String(payload.toolHistory).slice(0, 12000);
  }
  if (payload?.caps) body.caps = payload.caps;
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
        `medaily-ai agent HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`
      );
    }

    const data = await res.json();
    if (typeof data?.threadId === "string" && data.threadId) {
      await storeAgentThreadId(data.threadId);
    }

    return {
      done: Boolean(data?.done),
      assistantMessage: String(data?.assistantMessage || ""),
      actions: Array.isArray(data?.actions) ? data.actions : [],
      model: typeof data?.model === "string" ? data.model : undefined,
      threadId: typeof data?.threadId === "string" ? data.threadId : undefined,
      source: "api",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readStoredAgentThreadId() {
  try {
    const session = await chrome.storage.session.get(AGENT_THREAD_STORAGE_KEY);
    if (typeof session[AGENT_THREAD_STORAGE_KEY] === "string") {
      return session[AGENT_THREAD_STORAGE_KEY];
    }
  } catch {
    // fall through
  }
  const local = await chrome.storage.local.get(AGENT_THREAD_STORAGE_KEY);
  return typeof local[AGENT_THREAD_STORAGE_KEY] === "string"
    ? local[AGENT_THREAD_STORAGE_KEY]
    : "";
}

async function storeAgentThreadId(threadId) {
  try {
    await chrome.storage.session.set({ [AGENT_THREAD_STORAGE_KEY]: threadId });
  } catch {
    await chrome.storage.local.set({ [AGENT_THREAD_STORAGE_KEY]: threadId });
  }
}
