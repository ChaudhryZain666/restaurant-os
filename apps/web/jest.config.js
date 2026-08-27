/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts", ".tsx"],
  moduleNameMapper: {
    // Same rationale as apps/api's jest.config.js — resolve workspace packages to TS source, not
    // compiled dist/ output, so ts-jest transpiles everything under test consistently.
    "^@restaurant/types$": "<rootDir>/../../packages/types/src/index.ts",
    "^@restaurant/ui$": "<rootDir>/../../packages/ui/src/index.ts",
    "^@restaurant/utils$": "<rootDir>/../../packages/utils/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // registry.tsx (imported by the tests below) pulls in every theme's .tsx component files, even
  // though the test files themselves are plain .ts — both need a transform, and Jest needs to be
  // able to resolve an extensionless `./classic/Header` import to `Header.tsx` (this app's Vite/
  // bundler-mode convention, no explicit extensions in source).
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  transform: {
    // apps/web/tsconfig.json is references-only (no compilerOptions of its own — see its "files":
    // []), so ts-jest is pointed at tsconfig.jest.json instead: the same compilerOptions as the
    // real app build (tsconfig.app.json), plus "jest" added to the restricted `types` array so
    // describe/it/expect resolve (the app build deliberately restricts ambient types to
    // vite/client only).
    "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "<rootDir>/tsconfig.jest.json" }],
  },
  // Deliberately src/**/*.test.ts only (not .tsx) — this app has no React-rendering test
  // infrastructure (no jsdom/@testing-library setup exists anywhere in the repo; see
  // docs/theme-architecture.md's "Testing" section). Jest here covers the theme engine's pure,
  // framework-independent logic (token resolution, registry integrity); actual rendered-component
  // behavior is covered by the root Playwright e2e suite instead, which exercises a real browser.
  testMatch: ["**/src/**/*.test.ts"],
};
