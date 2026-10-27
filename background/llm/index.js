/**
 * BYOK provider router — the service worker calls Gemini / Claude directly,
 * bypassing medaily-ai. Keys come from shared/secrets.js (plain or encrypted)
 * and are sent only to the provider itself.
 */
import { DEFAULT_SETTINGS } from "../../shared/defaults.js";
import { getSecretsState } from "../../shared/secrets.js";
import { completeAnthropic } from "./anthropic.js";
import { completeGemini } from "./gemini.js";
import { AGENT_SYSTEM_PROMPT, toolsForCaps } from "./tools.js";

const REQUEST_TIMEOUT_MS = 90_000;

export const BYOK_PROVIDERS = new Set(["gemini", "anthropic"]);

/** @returns {Promise<{provider: string, apiKey: string, model: string, locked: boolean}>} */
export async function readProviderConfig() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const { locked, secrets } = await getSecretsState();
  const provider = settings.provider || "medaily";
  if (provider === "gemini") {
    return {
      provider,
      apiKey: secrets.geminiApiKey,
      model: settings.geminiModel || DEFAULT_SETTINGS.geminiModel,
      locked,
    };
  }
  if (provider === "anthropic") {
    return {
      provider,
      apiKey: secrets.anthropicApiKey,
      model: settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel,
      locked,
    };
  }
  return { provider: "medaily", apiKey: secrets.apiKey, model: "", locked };
}

/** Throw a user-facing error when the selected provider has no usable key. */
export function assertKeyReady(cfg) {
  if (cfg.locked) {
    throw new Error(
      "API keys are locked — open the Medaily Copilot popup and unlock with your passphrase."
    );
  }
  if (!cfg.apiKey) {
    throw new Error(
      `API key missing for ${cfg.provider} — open Medaily Copilot settings and paste it.`
    );
  }
}

async function complete(cfg, req) {
  assertKeyReady(cfg);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const call = cfg.provider === "anthropic" ? completeAnthropic : completeGemini;
    return await call({
      ...req,
      apiKey: cfg.apiKey,
      model: cfg.model,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Chat turn: prior history + latest user message (already packed with page context).
 * @param {{provider: string, apiKey: string, model: string}} cfg
 * @param {{system: string, history: Array<{role: string, text: string}>, message: string, images?: Array<{mimeType: string, data: string}>}} req
 */
export async function chatWithProvider(cfg, req) {
  const messages = [
    ...req.history.map((h) => ({
      role: h.role === "user" ? "user" : "assistant",
      text: h.text,
    })),
    { role: "user", text: req.message, images: req.images },
  ];
  const out = await complete(cfg, { system: req.system, messages });
  if (!out.text) throw new Error(`${cfg.provider} response missing answer text`);
  return { reply: out.text, source: cfg.provider, model: out.model };
}

/**
 * One planning step. Stateless: goal + tool history + fresh snapshot each turn,
 * so the loop survives a dropped thread or a service worker restart.
 * @param {{provider: string, apiKey: string, model: string}} cfg
 * @param {{goal: string, pageSnapshot: string, toolHistory?: string, caps?: object, screenshot?: {mimeType: string, data: string}}} payload
 */
export async function planWithProvider(cfg, payload) {
  const text = [
    `[Goal]\n${String(payload.goal || "").slice(0, 2000)}`,
    `[Steps taken]\n${String(payload.toolHistory || "(none yet)").slice(0, 12000)}`,
    `[Page snapshot]\n${String(payload.pageSnapshot || "").slice(0, 16000)}`,
  ].join("\n\n");

  const out = await complete(cfg, {
    system: AGENT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        text,
        images: payload.screenshot?.data ? [payload.screenshot] : undefined,
      },
    ],
    tools: toolsForCaps(payload.caps),
  });

  const finish = out.toolCalls.find((c) => c.name === "finish");
  const actions = out.toolCalls
    .filter((c) => c.name !== "finish")
    .map((c) => {
      const { reason, ...args } = c.args || {};
      return { tool: c.name, args, reason: typeof reason === "string" ? reason : "" };
    });

  return {
    done: Boolean(finish) && !actions.length,
    assistantMessage: String(finish?.args?.message || out.text || ""),
    actions,
    model: out.model,
    source: cfg.provider,
  };
}
