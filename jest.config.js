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
  collectCoverage: true,
  collectCoverageFrom: ["rule2rego.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["html-spa"],
  coverageThreshold: {
    global: {
      lines: 95,
      branches: 95,
      functions: 95,
      statements: 95,
    },
  },
  detectLeaks: true,
  errorOnDeprecated: true,
};
