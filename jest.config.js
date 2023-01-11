/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  roots: ["<rootDir>/test"],
  preset: "ts-jest",
  testEnvironment: "node",
  ci: true,
  globalSetup: "./test/globalSetup.ts",
  automock: false,
  bail: true,
  maxConcurrency: 1,
  maxWorkers: 1,
  testMatch: ["**/*.test.ts"],
  testTimeout: 10000,
  verbose: true,
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        isolatedModules: true,
      },
    ],
  },
  detectLeaks: true,
  errorOnDeprecated: true,
};
