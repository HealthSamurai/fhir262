module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/test.ts"],
  reporters: ["default", "<rootDir>/framework/reporter.cjs"],
  rootDir: ".",
  testTimeout: 180000,
  slowTestThreshold: 120,
  testLocationInResults: true,
};
