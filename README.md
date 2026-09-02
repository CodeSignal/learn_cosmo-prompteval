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
```

Fill in `.env` for the provider you want:

- Anthropic (default): `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`
- OpenAI: set `LLM_PROVIDER=openai` and `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` / `OPENAI_MODEL`

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
- `@anthropic-ai/sdk` (Claude Messages API) or `openai` (Chat Completions)
- CodeSignal Bespoke Design System (git submodule)
- Vanilla JS + esbuild
