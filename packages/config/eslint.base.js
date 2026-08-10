import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

/** Base flat-config rules shared by every workspace (Node or browser). */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // `declare global { namespace Express { ... } }` is the standard way to augment
      // Express's Request type — an ambient declaration, not a regular namespace.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },
  prettierConfig
);
