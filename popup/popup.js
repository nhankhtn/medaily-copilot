import { DEFAULT_SETTINGS } from "../shared/defaults.js";

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const fields = {
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  apiKey: document.getElementById("apiKey"),
  useMock: document.getElementById("useMock"),
};

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  fields.apiBaseUrl.value = settings.apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl;
  fields.apiKey.value = settings.apiKey ?? "";
  fields.useMock.checked = Boolean(settings.useMock);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("Saving…");

  const apiBaseUrl = fields.apiBaseUrl.value.trim().replace(/\/+$/, "");
  const apiKey = fields.apiKey.value.trim();
  const useMock = fields.useMock.checked;

  if (!useMock && apiBaseUrl) {
    try {
      const parsed = new URL(apiBaseUrl);
      if (!parsed.protocol.startsWith("http")) {
        throw new Error("not http");
      }
    } catch {
      setStatus("API base URL is invalid.", "err");
      return;
    }
  }

  if (!useMock && !apiKey) {
    setStatus("API key required when Mock mode is off.", "err");
    return;
  }

  try {
    await chrome.storage.sync.set({
      apiBaseUrl: apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl,
      apiKey,
      useMock,
    });
    setStatus("Saved.", "ok");
  } catch (err) {
    setStatus(err?.message || "Could not save settings.", "err");
  }
});

loadSettings().catch((err) => {
  setStatus(err?.message || "Could not load settings.", "err");
});
