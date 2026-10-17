import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  lint: {
    ignorePatterns: [".opencode/**", "dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [".opencode/**", "dist/**"],
  },
});
