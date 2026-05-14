module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.ts"],
  reporters: ["default", "<rootDir>/framework/reporter.cjs"],
  setupFilesAfterEnv: ["<rootDir>/framework/matchers.ts"],
  rootDir: ".",
  // beforeAll boots a per-file server environment; slow impls (e.g. medplum
  // with 3 containers + oauth) can exceed jest's default and the previous
  // 180s cap. 10 min gives plenty of headroom.
  testTimeout: 600000,
  slowTestThreshold: 120,
  testLocationInResults: true,
  // Each test file boots its own server environment, so running files in
  // parallel against a single impl would spin up duplicate stacks (wasteful
  // and racy on shared host ports). Run files serially within one impl.
  maxWorkers: 1,
};
