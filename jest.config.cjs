module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.ts"],
  reporters: ["default", "<rootDir>/framework/reporter.cjs"],
  setupFilesAfterEnv: ["<rootDir>/framework/matchers.ts"],
  rootDir: ".",
  testTimeout: 180000,
  slowTestThreshold: 120,
  testLocationInResults: true,
};
