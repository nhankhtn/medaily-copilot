import { API_BASE_URL, DEFAULT_SETTINGS } from "../shared/defaults.js";
import { askMedaily, planAgent } from "./medaily-client.js";
import {
  getRecent,
  installWebRequestListener,
} from "./network-buffer.js";

installWebRequestListener();

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) patch[key] = value;
  }
  // Copilot-only UUID (required by POST /api/chat). Never the Medaily session id.
  if (!existing.userId) {
    patch.userId = crypto.randomUUID();
  }
  // Always pin live host; retire mock / local-stub settings.
  patch.apiBaseUrl = API_BASE_URL;
  patch.useMock = false;
  if (Object.keys(patch).length) {
    await chrome.storage.sync.set(patch);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "MEDAILY_GET_SETTINGS") {
    chrome.storage.sync
      .get(DEFAULT_SETTINGS)
      .then((settings) =>
        sendResponse({
          ok: true,
          settings: {
            ...settings,
            apiBaseUrl: API_BASE_URL,
            useMock: false,
          },
        })
      )
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || String(err) })
      );
    return true;
  }

  if (message.type === "MEDAILY_CHAT") {
    handleChat(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error:
            err?.name === "AbortError"
              ? "Request timed out"
              : err?.message || String(err),
        })
      );
    return true;
  }

  if (message.type === "MEDAILY_AGENT_PLAN") {
    handleAgentPlan(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error:
            err?.name === "AbortError"
              ? "Request timed out"
              : err?.message || String(err),
        })
      );
    return true;
  }

  if (message.type === "MEDAILY_GET_NETWORK") {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "No tab id for network buffer" });
      return false;
    }
    try {
      const requests = getRecent(tabId, message.limit);
      sendResponse({ ok: true, requests });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
    return false;
  }

  return false;
});

async function handleChat(payload) {
  if (!payload || !Array.isArray(payload.messages)) {
    throw new Error("Invalid chat payload");
  }
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return askMedaily(payload, {
    ...settings,
    apiBaseUrl: API_BASE_URL,
    useMock: false,
  });
}

async function handleAgentPlan(payload) {
  if (!payload || typeof payload.goal !== "string") {
    throw new Error("Invalid agent payload");
  }
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return planAgent(payload, {
    ...settings,
    apiBaseUrl: API_BASE_URL,
    useMock: false,
  });
}
