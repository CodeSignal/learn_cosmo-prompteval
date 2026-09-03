# Prompt Evaluation Simulator (`learn_cosmo-prompteval`)

A CodeSignal learning project that teaches how to **evaluate** LLM prompts — not only how to write them.

Learners run the same prompt template against an input across multiple **independent** LLM calls, then score outputs against an optional expected answer using simple metrics.

## Milestone status

1. **Done** — Prompt template + input + 1–5 independent runs → collect outputs  
2. **Done** — Optional expected answer + metrics + mean/min/max  
3. **Done** — Prompt A vs Prompt B under shared conditions (winner by mean)  
4. **Done** — Evaluation across multiple test cases (overall + per-case scores)  
5. **Next** — Charts / distributions, or model/provider comparison

## Setup

```bash
git clone --recurse-submodules <this-repo-url>
cd learn_cosmo-prompteval
npm install
cp .env.example .env
cp session.config.example.json session.config.json
```

Fill in `.env` with the API key (and optional `*_BASE_URL`) for the provider you want. Choose the model in `session.config.json` as `provider/model-id`:

- `anthropic/claude-sonnet-4-6` — needs `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL`
- `openai/gpt-5.6-luna` — needs `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`
- `google/gemini-3.6-flash` — needs `GOOGLE_API_KEY`, optional `GOOGLE_BASE_URL` (`gemini/…` also routes to Gemini)

`session.config.json` is separate from `.env`. It is local (not checked in) and holds **session defaults**, not secrets:

- `model` (optional) — `provider/model-id` (default `anthropic/claude-sonnet-4-6`); must be listed in `allowedModels`
- `allowedModels` (optional) — picker list of `provider/model-id` refs (defaults to Anthropic, OpenAI, and Gemini examples above)
- `allowUserModelSelection` (optional) — when `true`, show a model picker and let the saved eval session override `model` with an entry from `allowedModels` (default `false`)
- `defaults` (optional) — `minRuns`, `maxRuns`, `minCases`, `maxCases` (each 1–5)
- `initialSession` (optional) — `promptA`, `promptB`, and `cases` (`input` / `expectedAnswer`)

Without `session.config.json`, prompts and cases start empty and the UI uses the built-in 1–5 limits. Copy `session.config.example.json` to prefill the capital-city demo.

Work-in-progress (prompts, cases, settings, and the last results) is stored in `eval-session.json`. That file is local and not checked in. A saved session wins over `initialSession` on reload.

## Run

```bash
npm run dev
```

Open http://localhost:3000

## Tests

```bash
npm test
```

## Stack

- Node.js + Express
- `@anthropic-ai/sdk` (Claude Messages API), `openai` (Chat Completions), or `@google/genai` (Gemini)
- CodeSignal Bespoke Design System (git submodule)
- Vanilla JS + esbuild
