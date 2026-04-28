/**
 * Legacy Jest compatibility config.
 * Vitest is the primary CI runner; keep this aligned with the same
 * unit-test surface and truthful coverage floor.
 */

const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFiles: ["<rootDir>/jest.polyfills.js"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jest-environment-jsdom",
  testEnvironmentOptions: {
    customExportConditions: ["node", "node-addons"],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@/components/(.*)$": "<rootDir>/src/components/$1",
    "^@/lib/(.*)$": "<rootDir>/src/lib/$1",
    "^@/contexts/(.*)$": "<rootDir>/src/contexts/$1",
    "^@/hooks/(.*)$": "<rootDir>/src/hooks/$1",
  },
  testMatch: [
    "<rootDir>/src/**/__tests__/**/*.(test|spec).(ts|tsx)",
    "<rootDir>/src/**/?(*.)+(test|spec).(ts|tsx)",
  ],
  collectCoverageFrom: [
    "src/components/**/*.(ts|tsx)",
    "src/hooks/**/*.(ts|tsx)",
    "src/lib/**/*.(ts|tsx)",
    "!src/**/*.d.ts",
    "!src/**/*.stories.(ts|tsx)",
    "!src/**/__tests__/**",
    "!src/types/**/*",
    "!src/mocks/**/*",
    "!src/**/index.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 5,
      functions: 10,
      lines: 10,
      statements: 10,
    },
  },
  coverageProvider: "v8",
  coverageReporters: ["text", "text-summary", "lcov", "html"],
  coverageDirectory: "<rootDir>/coverage",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/e2e/",
  ],
  // watchPlugins require jest-watch-typeahead; uncomment when installed
  // watchPlugins: [
  //   'jest-watch-typeahead/filename',
  //   'jest-watch-typeahead/testname',
  // ],
  reporters: ["default"],
  transformIgnorePatterns: ["node_modules/(?!(until-async|msw|@mswjs)/)"],
};

const baseConfig = createJestConfig(customJestConfig);

module.exports = async () => {
  const config = await baseConfig();
  // next/jest sets transformIgnorePatterns; we need to also exclude ESM-only
  // packages used by msw v2 from the ignore list
  config.transformIgnorePatterns = [
    "node_modules/(?!(until-async|@mswjs|msw)/)",
  ];
  return config;
};
