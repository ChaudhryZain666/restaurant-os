/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Resolve workspace packages to their TypeScript source rather than their compiled dist/
    // output: ts-jest transpiles source consistently with the rest of the test run, whereas the
    // compiled output is ESM-only JS that a require()-based resolution step can choke on.
    "^@restaurant/types$": "<rootDir>/../../packages/types/src/index.ts",
    "^@restaurant/validation$": "<rootDir>/../../packages/validation/src/index.ts",
    "^@restaurant/utils$": "<rootDir>/../../packages/utils/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["**/src/**/*.test.ts"],
  setupFiles: ["dotenv/config"],
};
