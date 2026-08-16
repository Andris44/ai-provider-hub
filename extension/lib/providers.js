/**
 * Provider abstraction layer.
 *
 * Every provider implements the same interface:
 *
 *   {
 *     id, label, baseUrl, defaultModel, signupUrl, keyPlaceholder, notes,
 *     streamChatCompletion({ apiKey, model, system, messages, onDelta, signal }) -> Promise<string>
 *   }
 *
 * Almost every supported backend speaks the OpenAI chat-completions dialect,
 * so they all reuse `createOpenAICompatibleProvider`. Adding a new provider is
 * normally a single entry in PROVIDERS below.
 */

/* ---------- errors ---------- */

export class ProviderError extends Error {
  constructor(message, { provider, status, kind = "error" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.kind = kind; // "error" | "rate_limit" | "auth" | "quota"
  }
}

function classify(status, body) {
  const text = (body || "").toLowerCase();
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (
    status === 402 ||
    text.includes("quota") ||
    text.includes("insufficient") ||
    text.includes("credit")
  )
    return "quota";
  return "error";
}

function providerError(label, status, body) {
  const kind = classify(status, body);
  const snippet = (body || "").replace(/\s+/g, " ").slice(0, 300);
  const message =
    kind === "rate_limit"
      ? `${label} rate limit reached (429). Wait a moment, or switch provider in settings (⚙). — ${snippet}`
      : kind === "quota"
        ? `${label} quota/credit exhausted. Add credit or switch provider in settings (⚙). — ${snippet}`
        : kind === "auth"
          ? `${label} rejected your API key (${status}). Check it in settings (⚙). — ${snippet}`
          : `${label} error ${status}: ${snippet}`;
  return new ProviderError(message, { provider: label, status, kind });
}

/* ---------- shared SSE reader ---------- */

async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* keep-alive or partial frame */
      }
    }
  }
}

/* ---------- OpenAI-compatible provider factory ---------- */

function createOpenAICompatibleProvider(config) {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    ...config,
    async streamChatCompletion({
      apiKey,
      model,
      system,
      messages,
      onDelta,
      signal,
      maxTokens = 8000,
    }) {
      const res = await fetch(url, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(config.extraHeaders || {}),
        },
        body: JSON.stringify({
          model: model || config.defaultModel,
          stream: true,
          max_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            ...messages,
          ],
        }),
      });

      if (!res.ok || !res.body) {
        throw providerError(config.label, res.status, await res.text());
      }

      let full = "";
      await readSse(res, (event) => {
        if (event.error) {
          throw new ProviderError(
            `${config.label}: ${event.error.message || "stream error"}`,
            { provider: config.label, kind: classify(0, event.error.message) },
          );
        }
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onDelta?.(delta, full);
        }
      });
      return full;
    },
  };
}

/* ---------- Anthropic (native dialect) ---------- */

function createAnthropicProvider(config) {
  return {
    ...config,
    async streamChatCompletion({
      apiKey,
      model,
      system,
      messages,
      onDelta,
      signal,
      maxTokens = 8000,
    }) {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/messages`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: model || config.defaultModel,
          max_tokens: maxTokens,
          stream: true,
          system,
          messages,
        }),
      });

      if (!res.ok || !res.body) {
        throw providerError(config.label, res.status, await res.text());
      }

      let full = "";
      await readSse(res, (event) => {
        if (event.type === "error") {
          throw new ProviderError(
            `${config.label}: ${event.error?.message || "stream error"}`,
            { provider: config.label, kind: classify(0, event.error?.message) },
          );
        }
        if (event.type === "content_block_delta" && event.delta?.text) {
          full += event.delta.text;
          onDelta?.(event.delta.text, full);
        }
      });
      return full;
    },
  };
}

/* ---------- registry ---------- */

export const PROVIDERS = [
  createOpenAICompatibleProvider({
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    signupUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_...",
    notes: "Free, no card. Fastest responses — good for step-by-step work.",
  }),
  createOpenAICompatibleProvider({
    id: "gemini",
    label: "Google Gemini (AI Studio)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    signupUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza...",
    notes: "Free tier, best general coding quality and a very large context.",
  }),
  createOpenAICompatibleProvider({
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-coder",
    signupUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-...",
    notes: "Optimized specifically for code.",
  }),
  createOpenAICompatibleProvider({
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    signupUrl: "https://console.mistral.ai/api-keys",
    keyPlaceholder: "...",
    notes: "Free tier, no card required.",
  }),
  createOpenAICompatibleProvider({
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama3.3-70b",
    signupUrl: "https://cloud.cerebras.ai/",
    keyPlaceholder: "csk-...",
    notes: "Very fast open-weight inference.",
  }),
  createOpenAICompatibleProvider({
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat-v3-0324:free",
    signupUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-...",
    notes: 'Many models behind one key — use any ":free" suffixed model id.',
    extraHeaders: { "X-Title": "Lovable ⇄ GitHub extension" },
  }),
  createAnthropicProvider({
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5-20250929",
    signupUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-...",
    notes: "Premium option — requires paid API credit.",
  }),
];

export const DEFAULT_PROVIDER_ID = "groq";

export function getProvider(id) {
  return (
    PROVIDERS.find((provider) => provider.id === id) ||
    PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID)
  );
}

/** Minimal request used by the "Test connection" button. */
export async function testProvider({ providerId, apiKey, model }) {
  const provider = getProvider(providerId);
  const text = await provider.streamChatCompletion({
    apiKey,
    model,
    system: "Reply with the single word: ok",
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 16,
  });
  return { provider: provider.label, reply: text.trim().slice(0, 80) || "(empty reply)" };
}
