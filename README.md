# Prompt Evaluation Simulator (`learn_cosmo-prompteval`)

A CodeSignal learning project that teaches how to **evaluate** LLM prompts — not only how to write them.

Learners run the same prompt template against an input across multiple **independent** Octavus sessions, then score outputs against an optional expected answer using simple metrics.

## Milestone status

1. **Done** — Prompt template + input + 1–5 independent runs → collect outputs  
2. **Done** — Optional expected answer + metrics + mean/min/max  
3. **Done** — Prompt A vs Prompt B under shared conditions (winner by mean)  
4. **Next** — Evaluation across multiple test cases (not just one input)

## Setup

```bash
git clone --recurse-submodules <this-repo-url>
cd learn_cosmo-prompteval
npm install
cp .env.example .env
```

Fill in `.env` with your Octavus API key and the **Prompt Eval** agent IDs (not the Cosmo Tutor agent).

Validate / sync the in-repo agent definition:

```bash
npm run validate:agent
npx octavus --env .env sync ./agents/prompt-eval
```

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
- `@octavus/server-sdk` / `@octavus/client-sdk`
- CodeSignal Bespoke Design System (git submodule)
- Vanilla JS + esbuild
