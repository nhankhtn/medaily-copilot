import { DEFAULT_SETTINGS } from "../shared/defaults.js";

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const showLauncherBtn = document.getElementById("show-launcher");
const launcherStatusEl = document.getElementById("launcher-status");
const apiKeyField = document.getElementById("apiKey");

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
  apiKeyField.value = settings.apiKey ?? "";
  renderLauncherState(settings.launcherHidden);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("Saving…");

  const apiKey = apiKeyField.value.trim();
  if (!apiKey) {
    setStatus("API key (SERVICE_TOKEN) is required.", "err");
    return;
  }

  try {
    await chrome.storage.sync.set({
      apiKey,
      apiBaseUrl: DEFAULT_SETTINGS.apiBaseUrl,
      useMock: false,
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
