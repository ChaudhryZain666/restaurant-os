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
  // Phase 46 — was ["dotenv/config"], which just loaded the real .env (the SAME MongoDB/Redis the
  // dev server uses). See jest.setup.env.ts for what replaces that and why.
  setupFiles: ["<rootDir>/jest.setup.env.ts"],
  // Phase 46 — this dev machine has only 4 logical CPUs, already running 4 persistent dev-server
  // processes plus MongoDB throughout a normal working session. Jest's own default (numCPUs - 1 =
  // 3 here) still means 3 fresh worker processes each opening their own MongoDB connection at
  // once, competing with everything already running — the repeatedly-observed root cause of
  // beforeAll hooks occasionally exceeding their 5000ms default (connectDB()/fixture-creation
  // timing out under connection-establishment contention, not any real slowness in the code being
  // tested). Halving it trades some wall-clock time for meaningfully less contention. Safe to
  // raise back on a beefier machine/CI runner.
  maxWorkers: "50%",
};
