module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.ts"],
  reporters: ["default", "<rootDir>/framework/reporter.cjs"],
  setupFilesAfterEnv: ["<rootDir>/framework/matchers.ts"],
  globalSetup: "<rootDir>/framework/global-setup.ts",
  globalTeardown: "<rootDir>/framework/global-teardown.ts",
  rootDir: ".",
  // Generous headroom for slow requests; server startup happens in globalSetup.
  testTimeout: 600000,
  slowTestThreshold: 120,
  testLocationInResults: true,
  // Serial: all files share one server and clean up after themselves.
  maxWorkers: 1,
};
