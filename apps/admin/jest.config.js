/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    // Same setup as apps/web/jest.config.js: workspace packages resolve to TS source.
    "^@restaurant/types$": "<rootDir>/../../packages/types/src/index.ts",
    "^@restaurant/utils$": "<rootDir>/../../packages/utils/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
  // Pure, framework-independent logic only (as in apps/web) — rendered behaviour is covered by the
  // root Playwright suite.
  testMatch: ["**/src/**/*.test.ts"],
};
