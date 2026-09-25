/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  // jsdom, not node — unlike apps/api/apps/web's own Jest configs (both deliberately "node": this
  // package's own seoMeta.ts is the one place in the repo that needs a real `document` to test
  // against, since apps/web itself has no jsdom/RTL setup by established convention (see its own
  // jest.config.js comment) and its DOM-touching behavior is covered by Playwright instead. This
  // config is scoped to this package only — neither apps/api's nor apps/web's config is touched.
  testEnvironment: "jsdom",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["**/src/**/*.test.ts"],
};
