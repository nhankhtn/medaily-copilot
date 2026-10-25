import { DEFAULT_SETTINGS } from "../shared/defaults.js";
import { askMedaily } from "./medaily-client.js";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) patch[key] = value;
  }
  // Stable agent userId (required by POST /api/chat). Generated once.
  if (!existing.userId) {
    patch.userId = crypto.randomUUID();
  }
  // Migrate old local-stub default to the live AI host.
  if (existing.apiBaseUrl === "http://127.0.0.1:8787") {
    patch.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
  }
  if (Object.keys(patch).length) {
    await chrome.storage.sync.set(patch);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "MEDAILY_GET_SETTINGS") {
    chrome.storage.sync
      .get(DEFAULT_SETTINGS)
      .then((settings) => sendResponse({ ok: true, settings }))
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
          error: err?.name === "AbortError" ? "Request timed out" : err?.message || String(err),
        })
      );
    return true;
  }

  return false;
});

async function handleChat(payload) {
  if (!payload || !Array.isArray(payload.messages)) {
    throw new Error("Invalid chat payload");
  }
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return askMedaily(payload, settings);
}
