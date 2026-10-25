import { DEFAULT_SETTINGS } from "../shared/defaults.js";

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const showLauncherBtn = document.getElementById("show-launcher");
const launcherStatusEl = document.getElementById("launcher-status");
const fields = {
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  apiKey: document.getElementById("apiKey"),
  useMock: document.getElementById("useMock"),
};

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function renderLauncherState(hidden) {
  const isHidden = Boolean(hidden);
  showLauncherBtn.disabled = !isHidden;
  launcherStatusEl.textContent = isHidden
    ? "Hidden — restore it here to show the FAB again"
    : "Visible on pages";
  launcherStatusEl.classList.toggle("hidden-state", isHidden);
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  fields.apiBaseUrl.value = settings.apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl;
  fields.apiKey.value = settings.apiKey ?? "";
  fields.useMock.checked = Boolean(settings.useMock);
  renderLauncherState(settings.launcherHidden);
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
    setStatus("API key (SERVICE_TOKEN) required when Mock mode is off.", "err");
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

showLauncherBtn.addEventListener("click", async () => {
  try {
    await chrome.storage.sync.set({ launcherHidden: false });
    renderLauncherState(false);
    setStatus("Launcher shown on pages.", "ok");
  } catch (err) {
    setStatus(err?.message || "Could not restore launcher.", "err");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.launcherHidden) return;
  renderLauncherState(changes.launcherHidden.newValue);
});

loadSettings().catch((err) => {
  setStatus(err?.message || "Could not load settings.", "err");
});
