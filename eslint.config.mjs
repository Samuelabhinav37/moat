// Lint: ESLint's and typescript-eslint's recommended rules, nothing stylistic
// (formatting is left as it is). `npm run lint`.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**", "rules/**", "site/**", ".cache/**", "**/.wrangler/**", "store-assets/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore marks a parameter or binding as deliberately unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    // TypeScript already reports undefined names, with the right lib types.
    files: ["**/*.ts"],
    rules: { "no-undef": "off" },
  },
  {
    // Build and test scripts run in Node, and the functions they hand to
    // puppeteer run in a page or in the extension.
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } },
    // Best-effort cleanup (removing a temp profile) is meant to ignore errors.
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  }
);
