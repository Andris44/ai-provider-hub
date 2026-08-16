# AI Provider Hub

Update Prompt for Lovable.dev

Copy-paste the text below into Lovable.dev as your update request.

Goal: Add support for multiple free, coding-capable AI API providers to the extension, so the user can choose which provider/model to use from within the extension's settings — instead of being locked into a single hardcoded API (currently Anthropic).

Requirements:

Provider abstraction layer Create a unified internal interface (e.g. AIProvider) that all providers implement, with a single method like sendChatCompletion(messages, options) that returns a normalized response regardless of which backend is used. Route all existing AI calls in the extension through this abstraction instead of calling the Anthropic API directly.

Supported providers (add all of these) Each provider below is OpenAI-compatible or near-compatible, so they should share most of the request/response logic — just different base URL, API key, and default model.

Provider Base URL Example model Notes Google Gemini (AI Studio) https://generativelanguage.googleapis.com/v1beta/openai/ gemini-2.0-flash Best general coding quality, large context Groq https://api.groq.com/openai/v1 llama-3.3-70b-versatile Fastest responses, good for agentic/step-by-step use DeepSeek https://api.deepseek.com/v1 deepseek-coder Optimized specifically for code Mistral https://api.mistral.ai/v1 mistral-large-latest Free tier, no card required Cerebras https://api.cerebras.ai/v1 llama3.3-70b Fast open-weight inference OpenRouter https://openrouter.ai/api/v1 any :free-suffixed model Access to many free-tier models via one key Anthropic (existing) keep as-is claude-sonnet-5 Keep as a paid/premium option

Settings UI

Add a "Provider" dropdown in extension settings listing the providers above.

When a provider is selected, show an API key input field (masked/password-style) and a model name field (pre-filled with a sensible default, but editable).

Add a "Test Connection" button that sends a minimal test request and shows success/failure feedback.

Store each provider's API key separately (so switching providers doesn't require re-entering keys), using secure local storage (not plaintext in a committed config file).

Fallback & error handling

If the selected provider returns a rate-limit (429) or quota error, show a clear in-UI message naming the provider and suggesting the user either wait or switch providers in settings.

Do not silently fall back to a different provider without user consent — always make the active provider visible in the UI.

Defaults

Default to Groq or Gemini for new installs (free, no card required) rather than Anthropic, so the extension works out of the box without billing setup.

Keep Anthropic as a selectable premium option for users who have API credit.

Docs

Update the README/settings help text to briefly explain that each provider requires the user's own free API key (link to each provider's signup page), and that free-tier rate limits vary by provider.

Please implement this as a clean, extensible structure so additional providers can be added later with minimal code changes.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/aafa15c3-2d91-47b0-82e8-4cb402215d0b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
