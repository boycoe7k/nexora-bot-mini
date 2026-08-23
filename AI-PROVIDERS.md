# Nexora Bot Mini AI Providers

Nexora Bot Mini keeps the existing OpenAI integration and adds explicit Gemini, DeepSeek, and Pollinations image-generation commands. Provider credentials are read only from the deployment environment; never paste keys into source files or commit them to GitHub.

## Environment variables

Set whichever providers you want in the Render service environment. `AI_PROVIDER=auto` uses the first configured text provider in this order: OpenAI, Gemini, then DeepSeek. You can set `AI_PROVIDER` to `openai`, `gemini`, or `deepseek` to choose one provider for the general `.ai`, `.gpt`, `.ask`, translation, and text-processing commands.

```text
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4o-mini
GEMINI_API_KEY=your-google-ai-key
DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_EFFORT=high
POLLINATIONS_API_KEY=your-pollinations-key
POLLINATIONS_MODEL=flux
AI_PROVIDER=auto
```

## Commands

`.gemini <question>` calls Gemini directly. `.deepseek <question>` and `.deep <question>` call DeepSeek directly. `.ai`, `.gpt`, and `.ask` use the configured provider selection. `.image <prompt>` and `.imagine <prompt>` generate an image through Pollinations and send it to WhatsApp. Existing `.summarize`, `.rewrite`, `.explain`, `.tr`, and `.detect` commands use the selected text provider when configured.

## Suno

Suno does not currently provide a public self-serve official API. The `.suno` command therefore returns a clear availability message instead of using an unofficial or reverse-engineered endpoint. Suno generation can be added later when an approved provider supplies official API documentation and credentials.

## Security

The Gemini key pasted in the chat was intentionally not used or stored. Revoke that key in Google AI Studio and create a replacement before adding `GEMINI_API_KEY` to Render. Never commit `.env` files or keys to the repository.

## Official references

- Gemini API: https://ai.google.dev/api/generate-content
- DeepSeek Chat Completions: https://api-docs.deepseek.com/api/create-chat-completion/
- Pollinations API: https://gen.pollinations.ai/docs
