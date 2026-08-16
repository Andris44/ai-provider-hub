import { PROVIDERS, DEFAULT_PROVIDER_ID, getProvider } from "./providers.js";

const DEFAULTS = {
  githubToken: "",
  provider: DEFAULT_PROVIDER_ID,
  providerKeys: {}, // { [providerId]: apiKey } — per-provider, kept locally
  providerModels: {}, // { [providerId]: model }
  pushMode: "pr", // "pr" (default, safer) | "direct"
  projects: [], // [{ id, lovableUrl, owner, repo, branch, name }]
  activeProjectId: "",
};

export async function getSettings() {
  const stored = await chrome.storage.local.get([
    ...Object.keys(DEFAULTS),
    "anthropicKey",
    "model",
  ]);
  const settings = { ...DEFAULTS, ...stored };
  settings.providerKeys = { ...settings.providerKeys };
  settings.providerModels = { ...settings.providerModels };

  // Migrate v0.3 single-provider settings.
  if (stored.anthropicKey && !settings.providerKeys.anthropic) {
    settings.providerKeys.anthropic = stored.anthropicKey;
    settings.provider = "anthropic";
  }
  if (stored.model && !settings.providerModels.anthropic) {
    settings.providerModels.anthropic = stored.model;
  }
  return settings;
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

/** Resolves the currently active provider plus its key and model. */
export function activeProvider(settings) {
  const provider = getProvider(settings.provider);
  return {
    provider,
    apiKey: settings.providerKeys?.[provider.id] || "",
    model: settings.providerModels?.[provider.id] || provider.defaultModel,
  };
}

export { PROVIDERS, getProvider, DEFAULT_PROVIDER_ID };

export async function getConversation(projectId) {
  const key = `chat:${projectId}`;
  const stored = await chrome.storage.local.get(key);
  return stored[key] || [];
}

export async function setConversation(projectId, messages) {
  await chrome.storage.local.set({ [`chat:${projectId}`]: messages.slice(-40) });
}

export async function getPending(projectId) {
  const key = `pending:${projectId}`;
  const stored = await chrome.storage.local.get(key);
  return stored[key] || [];
}

export async function setPending(projectId, changes) {
  await chrome.storage.local.set({ [`pending:${projectId}`]: changes });
}

export function parseRepoUrl(input) {
  const value = (input || "").trim();
  if (!value) return null;
  const slug = value
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = slug.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function parseLovableUrl(input) {
  const match = /lovable\.dev\/projects\/([0-9a-zA-Z-]+)/.exec(input || "");
  return match ? match[1] : "";
}
