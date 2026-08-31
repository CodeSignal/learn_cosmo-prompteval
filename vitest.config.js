import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // a11y-audits/tools uses node:test; design-system has its own Playwright suite.
    // tests/dom/* characterizes the former Cosmo chat UI (composer/sidebar) and is
    // not applicable to the Prompt Evaluation Simulator frontend yet.
    exclude: [
      ...configDefaults.exclude,
      '**/a11y-audits/**',
      '**/design-system/**',
      '**/tests/dom/**',
    ],
  },
});
