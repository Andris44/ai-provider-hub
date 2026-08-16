# AI ⇄ Lovable ⇄ GitHub (Chrome extension)

Chat with an AI model about your Lovable project's GitHub repo, review the proposed
diffs, and push them as a direct commit or a pull request.

## Install

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open the extension **Settings** (⚙) and configure a provider, a GitHub token, and a project.

## AI providers

You bring your own API key. Keys are stored per provider in `chrome.storage.local`
on your machine only — never in a committed config file — so switching providers
does not mean re-entering keys. **Free-tier rate limits vary by provider.**

| Provider | Base URL | Default model | Get a key | Notes |
| --- | --- | --- | --- | --- |
| Groq *(default)* | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | https://console.groq.com/keys | Free, no card. Fastest responses. |
| Google Gemini (AI Studio) | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.0-flash` | https://aistudio.google.com/apikey | Best general coding quality, large context. |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-coder` | https://platform.deepseek.com/api_keys | Optimized for code. |
| Mistral | `https://api.mistral.ai/v1` | `mistral-large-latest` | https://console.mistral.ai/api-keys | Free tier, no card required. |
| Cerebras | `https://api.cerebras.ai/v1` | `llama3.3-70b` | https://cloud.cerebras.ai/ | Fast open-weight inference. |
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat-v3-0324:free` | https://openrouter.ai/keys | Many models, one key — use any `:free` model id. |
| Anthropic (Claude) | `https://api.anthropic.com/v1` | `claude-sonnet-4-5-20250929` | https://console.anthropic.com/settings/keys | Premium — requires paid API credit. |

The model field is pre-filled with the default above and is editable.
**Test connection** in settings sends a minimal request and reports success or the
exact provider error.

### Rate limits and errors

If a provider returns 429 or a quota/credit error, the side panel shows a message
naming that provider and suggesting you wait or switch providers in settings.
The extension **never** silently falls back to another provider — the active
provider and model are always shown in the side panel header.

## GitHub token permissions

Pushing needs a token that can write code. With a **fine-grained PAT**:

- Repository access → include the exact repository
- Permissions → Repository → **Contents: Read and write**
- Permissions → Repository → **Pull requests: Read and write** (PR push mode)
- Permissions → Repository → **Metadata: Read-only** (auto-required)
- Org-owned repos: an org owner must approve the token
  (Org → Settings → Personal access tokens → Pending requests)

Classic tokens need the full `repo` scope.

`GitHub 403: Resource not accessible by personal access token` on
`git/blobs` means exactly this — the token can read the repo but not write.
Use **Test GitHub access** in settings to verify write access before pushing.

## Adding another provider


Almost every backend is OpenAI-compatible, so a new one is a single entry in
`lib/providers.js`:

```js
createOpenAICompatibleProvider({
  id: "myprovider",
  label: "My Provider",
  baseUrl: "https://api.example.com/v1",
  defaultModel: "some-model",
  signupUrl: "https://example.com/keys",
  keyPlaceholder: "sk-...",
  notes: "Short description shown in settings.",
})
```

Then add its origin to `host_permissions` in `manifest.json`. Providers with a
non-OpenAI dialect (like Anthropic) get their own small factory implementing the
same `streamChatCompletion({ apiKey, model, system, messages, onDelta, signal })`
interface.

## GitHub

Use a fine-grained personal access token with **Contents** and **Pull requests:
read & write** on the repo you pair. Default push mode is a new branch + PR;
direct commits to the synced branch are also available.
