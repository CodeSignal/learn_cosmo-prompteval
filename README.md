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
- `~deepseek/deepseek-v4-flash-latest` — needs `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` (`deepseek/…` and `deepseek-ai/…` also route here; uses the OpenAI SDK). If both DeepSeek vars are unset, it reuses `OPENAI_API_KEY` / `OPENAI_BASE_URL` (production proxy hack).

`session.config.json` is separate from `.env`. It is local (not checked in) and holds **session defaults**, not secrets:

- `model` (optional) — `provider/model-id` (default `anthropic/claude-sonnet-4-6`); must be listed in `allowedModels`
- `allowedModels` (optional) — picker list of `provider/model-id` refs (defaults to Anthropic, OpenAI, Gemini, and DeepSeek examples above)
- `allowUserModelSelection` (optional) — when `true`, show a model picker and let the saved eval session override `model` with an entry from `allowedModels` (default `false`)
- `allowCompare` (optional) — when `true`, show “Compare with another prompt” so learners can A/B two prompts (default `false`)
- `allowedMetricIds` (optional) — metrics shown in the picker and accepted by the API. When omitted, the original Course 1 metrics remain unchanged: `exact-match`, `exact-match-ci`, `contains`, `string-similarity`, and `word-overlap-f1`. Opt in to newer validation with `regex-match`, `valid-json`, and/or `llm-judge`.
- `llmJudgeModel` (optional) — fixed `provider/model-id` used only by `llm-judge`. The server controls this value and the UI displays it to learners. When omitted, the generation model is reused for backward compatibility.
- `features.promptTemplating` (optional) — enables reusable named blanks, shared examples, and a filled-in prompt preview. Missing configuration keeps the current Course 1 UI and `{{input}}` behavior unchanged.
- `maxConcurrency` (optional) — max in-flight LLM calls during an evaluation (default `4`, range 1–50). Set to `1` for serial.
- `defaults` (optional) — `runs` sets the initial run count while `minRuns`, `maxRuns`, `minCases`, and `maxCases` set the editable limits (each 1–5)
- `initialSession` (optional) — `promptA`, `promptB`, and `cases` (`input` / `expectedAnswer`)

Without `session.config.json`, prompts and cases start empty and the UI uses the built-in 1–5 limits. Copy `session.config.example.json` to prefill the capital-city demo.

For example, a later course can enable every validation type without changing Course 1:

```json
{
  "llmJudgeModel": "anthropic/claude-sonnet-4-6",
  "allowedMetricIds": [
    "exact-match",
    "regex-match",
    "valid-json",
    "llm-judge"
  ]
}
```

`regex-match` treats Expected Answer as a regular expression. `valid-json` is a deterministic function checker and does not require an expected answer. `llm-judge` makes a second call to `llmJudgeModel` for each generated output and requires an expected answer. Function checkers are registered in code and enabled by ID; configuration never executes arbitrary JavaScript.

### Config-gated prompt templating

Later-course tasks can let the prompt template define the fields shown in every case without changing Course 1:

```json
{
  "allowCompare": false,
  "features": {
    "promptTemplating": {
      "enabled": true,
      "templateEditable": true,
      "showPreview": true,
      "dynamicFields": true,
      "fields": [
        { "name": "context", "label": "Context" },
        { "name": "input", "label": "Input" },
        { "name": "constraint", "label": "Constraint" }
      ]
    }
  },
  "initialSession": {
    "promptA": "Use the context to answer the input.\n\nContext:\n{{context}}\n\nInput:\n{{input}}\n\nConstraint:\n{{constraint}}",
    "cases": [
      {
        "input": "",
        "expectedAnswer": "",
        "variables": {
          "context": "",
          "constraint": ""
        }
      }
    ]
  }
}
```

With `dynamicFields`, placeholders such as `{{context}}`, `{{input}}`, and `{{constraint}}` automatically become labeled fields in each case. Learners edit the template as normal text, while placeholder values can differ across cases. Text written directly in the template stays shared. Expected output is used only for scoring, and each case can show its exact rendered prompt.

Work-in-progress (prompts, cases, settings, and the last results) is stored in `eval-session.json`. That file is local and not checked in. A saved session wins over `initialSession` on reload.

After each evaluation run, the server appends a numbered `Evaluation` section to `.codesignal/report.md`. The report keeps all evaluations from the current workspace, including each evaluation's setup, overall scores, cases, and individual runs. That file is gitignored.

### Assessment mode

Graded assessments turn on an `assessment` block. Without it, every Course behavior above is unchanged. In assessment mode:

- **Limits are higher.** `defaults.maxRuns` can go up to 10 and `defaults.maxCases` up to 20 cases per evaluation. The server enforces the configured run and case ranges in every mode.
- **Provided cases are locked.** `providedCases` are served from the config, merged in by the server before the candidate's own cases, and never stored in `eval-session.json`. The candidate can untick a case to leave it out of a run but cannot change it.
- **Reference material is built in.** `materials` show in a Reference panel, for example a policy memo the prompt must follow.
- **The header reads as the client's product.** The course mascot and branding are hidden; `eyebrow` sets the small line above the title (for example "Harbor & Hearth · Menu label pilot"), and a new level starts with an empty Results panel.
- **Two metrics are added:**
  - `field-match` scores only the labeled `Label: value` lines written in Expected Answer.
  - `custom-check` has the fixed judge (`llmJudgeModel`) apply the candidate's own plain-English pass/fail criteria and give a one-sentence reason.
- **The custom check can be calibrated.** With `customCheck.enabled`, the candidate writes criteria and uses **Test my check** (`POST /api/check/calibrate`) to see how often the check agrees with reviewer-labeled `calibrationSamples`.
- **Consistency is measured.** With `consistency.enabled`, every evaluation reports how many runs agree with the most common answer. It compares only `consistency.fields` (for example Allergens and Diet, so free text can vary) and counts runs missing a field as disagreeing. Overall stability is the mean agreement across cases.
- **Notes.** `notes.enabled` adds a free-text panel, for example for a findings write-up.
- **A call budget.** `maxCallsPerEvaluation` caps cases × prompts × runs, with judge calls counting double.
- **Generation settings.** `temperature` and `reasoningEffort` (`none` to `max`) apply to every generation call.
- **Length limits are explicit.** `maxPromptLength` caps the graded prompt, custom check criteria are capped at 4,000 characters, and notes at `notes.maxLength`. Over-limit text shows a counter and an error, and the server rejects it instead of truncating.
- **Copy/paste is measured.** The prompt and the check criteria are compared with `materials` by four-word phrases (`lib/copy-detection.js`). The counts and a YES/NO verdict go into the submission files.

```json
{
  "model": "openai/gpt-6-luna",
  "allowedModels": ["openai/gpt-6-luna"],
  "allowedMetricIds": ["field-match", "custom-check"],
  "llmJudgeModel": "openai/gpt-6-luna",
  "defaults": { "runs": 3, "minRuns": 1, "maxRuns": 10, "maxCases": 15 },
  "assessment": {
    "enabled": true,
    "stage": "level-2",
    "stageLabel": "Level 2 of 3 · Build your check",
    "lede": "One sentence shown under the title.",
    "maxCandidateCases": 5,
    "maxCallsPerEvaluation": 120,
    "maxPromptLength": 4000,
    "reasoningEffort": "low",
    "materials": [{ "title": "Policy memo", "body": "…" }],
    "providedCases": [{ "id": "p1", "label": "…", "input": "…", "expectedAnswer": "Label: value" }],
    "customCheck": {
      "enabled": true,
      "calibrationSamples": [{ "id": "s1", "input": "…", "output": "…", "verdict": "pass", "note": "…" }]
    },
    "consistency": { "enabled": true, "fields": ["Label"] },
    "notes": { "enabled": true, "label": "Findings", "placeholder": "…" }
  }
}
```

**Server-written files for grading.** After every save, evaluation, and calibration, the server writes three files under `.codesignal/`. None of them trusts scores reported by the browser: graders re-run the candidate's prompt and criteria on hidden data.

- `submission.json` holds the candidate's current work: the graded prompt, their own cases, custom check criteria, and notes. It also keeps a compact history of evaluations and calibrations, with prompt and criteria version hashes.
- `submission.md` is the same content in a compact form for rubric graders.
- `evaluations.jsonl` is append-only, one line per evaluation or calibration, with full outputs.

`lib/grading.js` re-runs a saved prompt or custom check on hidden data the same way the simulator scores it. It builds on `lib/eval-compare.js`, `lib/metrics`, `lib/consistency.js`, and `lib/custom-check-calibration.js`, which are importable too.

**Restoring submitted work.** A task's hidden tests can call `recordSubmittedWork` (`lib/submitted-versions.js`) to save the scored fields (prompt, custom check criteria, notes) to `.codesignal/submitted-versions.json`. The simulator then shows a "Restore a submitted …" menu under each of those fields, like restoring a coding submission, with Undo.

> **Unusual but deliberate: the submit hook lives in the hidden tests, not in `main.sh`.** On CodeSignal, **Submit** runs the test runner inside the live workspace with the hidden files readable for that run only. **Run** executes `main.sh` with the hidden files moved away. So code in the hidden tests runs on Submit only, while a hook in `main.sh` would fire on every Run click and never on Submit. Keep the hook out of `it()` blocks so it never counts as a test.

**Progressive tasks.** Ship a different read-only `session.config.json` per level with a new `stage`. The candidate's `eval-session.json` carries over (prompt, own cases, criteria, notes). Provided cases and materials always come from the current level's config. The page polls `GET /api/assessment/stage` and reloads when the level changes, and the first load of a new level shows a "New level" banner.

## Run

```bash
npm run dev
```

Open http://localhost:3000

## Tests

```bash
npm test
npm run pack     # client + server bundles → dist/ and dist.tar.gz
```

`.github/workflows/release.yml` runs tests, stamps `package.json` from the
release tag, then `npm run pack`: a minified client bundle, a single-file
server bundle (Express + LLM SDKs inlined — no `node_modules`), and the static
files the server serves. Extract `dist.tar.gz` and run `node server.js`. Supply
`session.config.json` and `.env` at runtime.

The release also bundles the grading modules (`lib/grading.js`,
`lib/session-config.js`, `lib/llm/provider.js`, `lib/helpers.js`,
`lib/copy-detection.js`, `lib/eval-compare.js`, `lib/metrics/index.js`,
`lib/consistency.js`, `lib/custom-check-calibration.js`, `lib/submitted-versions.js`) at their source
paths under `lib/`. Hidden assessment tests import them by path, so they work against
a release the same way as against the source tree. `npm run pack` checks that
each one loads and that a prompt grades end to end.

Download URLs:

- Stable: `.../releases/latest/download/dist.tar.gz`
- Newest (incl. pre-release): `.../releases/download/prerelease/dist.tar.gz`
  (floating tag; refreshed on every versioned release, stable or RC)


## Stack

- Node.js + Express
- `@anthropic-ai/sdk` (Claude Messages API), `openai` (Chat Completions, including DeepSeek), or `@google/genai` (Gemini)
- CodeSignal Bespoke Design System (git submodule)
- Vanilla JS + esbuild
