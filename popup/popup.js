import { DEFAULT_SETTINGS } from "../shared/defaults.js";
import {
  deleteAllSecrets,
  disableEncryption,
  enableEncryption,
  getSecretsState,
  lockSecrets,
  saveSecrets,
  unlockSecrets,
} from "../shared/secrets.js";

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const showLauncherBtn = document.getElementById("show-launcher");
const clearKeysBtn = document.getElementById("clear-keys");
const launcherStatusEl = document.getElementById("launcher-status");
const providerField = document.getElementById("provider");
const apiKeyField = document.getElementById("apiKey");
const geminiApiKeyField = document.getElementById("geminiApiKey");
const geminiModelSelect = document.getElementById("geminiModelSelect");
const geminiModelField = document.getElementById("geminiModel");
const anthropicApiKeyField = document.getElementById("anthropicApiKey");
const anthropicModelSelect = document.getElementById("anthropicModelSelect");
const anthropicModelField = document.getElementById("anthropicModel");
const agentScreenshotsField = document.getElementById("agentScreenshots");
const cryptoStatusEl = document.getElementById("crypto-status");
const passphraseRow = document.getElementById("passphrase-field");
const passphraseField = document.getElementById("passphrase");
const enableCryptoBtn = document.getElementById("enable-crypto");
const unlockBtn = document.getElementById("unlock");
const lockBtn = document.getElementById("lock");
const disableCryptoBtn = document.getElementById("disable-crypto");
const passphraseOkBtn = document.getElementById("passphrase-ok");
/** Which action the passphrase row confirms: "enable" | "unlock" | null. */
let passphraseAction = null;

const KEY_FIELDS = [apiKeyField, geminiApiKeyField, anthropicApiKeyField];

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function renderLauncherState(hidden) {
  const isHidden = Boolean(hidden);
  showLauncherBtn.disabled = !isHidden;
  launcherStatusEl.textContent = isHidden ? "Hidden" : "Visible";
  launcherStatusEl.classList.toggle("warn", isHidden);
}

/** Show only the fields of the selected provider. */
function renderProviderFields() {
  const provider = providerField.value;
  for (const el of form.querySelectorAll("[data-provider]")) {
    el.hidden = el.getAttribute("data-provider") !== provider;
  }
  // Screenshots are only sent to Gemini / Claude.
  for (const el of form.querySelectorAll("[data-byok]")) {
    el.hidden = provider === "medaily";
  }
}

/** Select the listed model, or "custom" with the ID shown in the text field. */
function setModel(select, input, model) {
  const listed = [...select.options].some((o) => o.value === model);
  select.value = listed ? model : "custom";
  input.value = listed ? "" : model;
  input.hidden = listed;
}

function readModel(select, input, fallback) {
  if (select.value !== "custom") return select.value;
  return input.value.trim() || fallback;
}

for (const [select, input] of [
  [geminiModelSelect, geminiModelField],
  [anthropicModelSelect, anthropicModelField],
]) {
  select.addEventListener("change", () => {
    input.hidden = select.value !== "custom";
    if (!input.hidden) input.focus();
  });
}

/** Fill key fields and toggle encryption controls for plain / locked / unlocked. */
async function renderSecrets() {
  const { encrypted, locked, secrets } = await getSecretsState();
  apiKeyField.value = secrets.apiKey;
  geminiApiKeyField.value = secrets.geminiApiKey;
  anthropicApiKeyField.value = secrets.anthropicApiKey;
  for (const field of KEY_FIELDS) {
    field.disabled = locked;
    field.placeholder = locked ? "Locked — unlock below" : field.dataset.placeholder;
  }

  cryptoStatusEl.textContent = !encrypted ? "Off" : locked ? "Locked" : "On";
  cryptoStatusEl.classList.toggle("warn", locked);
  // Locked always needs the passphrase; otherwise only after pressing Encrypt.
  passphraseAction = locked ? "unlock" : !encrypted && passphraseAction === "enable" ? "enable" : null;
  passphraseRow.hidden = !passphraseAction;
  enableCryptoBtn.hidden = encrypted;
  unlockBtn.hidden = !locked;
  lockBtn.hidden = !encrypted || locked;
  disableCryptoBtn.hidden = !encrypted || locked;
  return { encrypted, locked };
}

async function loadSettings() {
  for (const field of KEY_FIELDS) field.dataset.placeholder = field.placeholder;
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  providerField.value = settings.provider || "medaily";
  agentScreenshotsField.checked = settings.agentScreenshots !== false;
  setModel(
    geminiModelSelect,
    geminiModelField,
    settings.geminiModel || DEFAULT_SETTINGS.geminiModel
  );
  setModel(
    anthropicModelSelect,
    anthropicModelField,
    settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel
  );
  renderProviderFields();
  renderLauncherState(settings.launcherHidden);
  await renderSecrets();
}

/** Run a popup action with uniform status reporting, then refresh the key UI. */
async function runAction(pending, action, done) {
  setStatus(pending);
  try {
    await action();
    setStatus(done, "ok");
  } catch (err) {
    setStatus(err?.message || String(err), "err");
  }
  await renderSecrets().catch(() => {});
}

providerField.addEventListener("change", renderProviderFields);

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (apiKeyField.disabled) {
    setStatus("Keys are locked — unlock with your passphrase first.", "err");
    return;
  }

  const provider = providerField.value;
  const secrets = {
    apiKey: apiKeyField.value.trim(),
    geminiApiKey: geminiApiKeyField.value.trim(),
    anthropicApiKey: anthropicApiKeyField.value.trim(),
  };
  const missing =
    (provider === "medaily" && !secrets.apiKey && "API key (SERVICE_TOKEN)") ||
    (provider === "gemini" && !secrets.geminiApiKey && "Gemini API key") ||
    (provider === "anthropic" && !secrets.anthropicApiKey && "Claude API key");
  if (missing) {
    setStatus(`${missing} is required.`, "err");
    return;
  }

  await runAction(
    "Saving…",
    async () => {
      await saveSecrets(secrets);
      await chrome.storage.sync.set({
        provider,
        agentScreenshots: agentScreenshotsField.checked,
        apiBaseUrl: DEFAULT_SETTINGS.apiBaseUrl,
        useMock: false,
        geminiModel: readModel(
          geminiModelSelect,
          geminiModelField,
          DEFAULT_SETTINGS.geminiModel
        ),
        anthropicModel: readModel(
          anthropicModelSelect,
          anthropicModelField,
          DEFAULT_SETTINGS.anthropicModel
        ),
      });
    },
    "Saved."
  );
});

function submitPassphrase() {
  const passphrase = passphraseField.value;
  if (passphraseAction === "enable") {
    return runAction(
      "Encrypting…",
      async () => {
        await enableEncryption(passphrase);
        passphraseField.value = "";
        passphraseAction = null;
      },
      "Encrypted. The passphrase cannot be recovered."
    );
  }
  if (passphraseAction === "unlock") {
    return runAction(
      "Unlocking…",
      async () => {
        await unlockSecrets(passphrase);
        passphraseField.value = "";
      },
      "Unlocked."
    );
  }
}

enableCryptoBtn.addEventListener("click", () => {
  passphraseAction = passphraseAction === "enable" ? null : "enable";
  passphraseRow.hidden = !passphraseAction;
  if (passphraseAction) passphraseField.focus();
});

unlockBtn.addEventListener("click", () => {
  if (passphraseField.value) submitPassphrase();
  else passphraseField.focus();
});

passphraseOkBtn.addEventListener("click", submitPassphrase);

passphraseField.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  submitPassphrase();
});

lockBtn.addEventListener("click", () =>
  runAction("Locking…", lockSecrets, "Locked.")
);

disableCryptoBtn.addEventListener("click", () => {
  if (!confirm("Store keys unencrypted again?")) return;
  runAction("Decrypting…", disableEncryption, "Encryption turned off.");
});

clearKeysBtn.addEventListener("click", () => {
  if (!confirm("Delete all saved API keys from this browser?")) return;
  runAction("Deleting…", deleteAllSecrets, "All keys deleted.");
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
