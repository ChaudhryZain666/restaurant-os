import { reactConfig } from "@restaurant/config/eslint.react.js";

export default [
  { ignores: ["dist/**"] },
  ...reactConfig,
  // jest's moduleNameMapper stub for image imports (jest.config.js) — plain Node CommonJS, not a
  // browser/ESM module like the rest of this app, so it needs the `module` global the rest of this
  // config (a browser environment) doesn't declare.
  { files: ["src/test/fileMock.cjs"], languageOptions: { globals: { module: "writable" } } },
];
