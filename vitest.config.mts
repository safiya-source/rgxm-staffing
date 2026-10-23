import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://rgxm:rgxm@localhost:5432/rgxm_test";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      MAIL_TRANSPORT: "log",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: "./test-results/storage",
    },
    fileParallelism: false,
  },
});
