import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**"],
    },
    forceRerunTriggers: [
      "**/package.json/**",
      "**/vitest.config.*/**",
      "**/vite.config.*/**",
      "**/fixture/**",
    ],
  },
});
