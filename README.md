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

Fill in `.env` for the provider you want:

- Anthropic (default): `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`
- OpenAI: set `LLM_PROVIDER=openai` and `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` / `OPENAI_MODEL`
- Gemini: set `LLM_PROVIDER=gemini` and `GOOGLE_API_KEY`, optional `GOOGLE_BASE_URL` / `GOOGLE_MODEL`

`session.config.json` is separate from `.env`. It is local (not checked in) and holds **session defaults**, not secrets:

- `defaults` (optional) — `minRuns`, `maxRuns`, `minCases`, `maxCases` (each 1–5)
- `initialSession` (optional) — `promptA`, `promptB`, and `cases` (`input` / `expectedAnswer`)

Without `session.config.json`, prompts and cases start empty and the UI uses the built-in 1–5 limits. Copy `session.config.example.json` to prefill the capital-city demo.

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
