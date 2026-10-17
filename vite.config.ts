import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  pack: {
    entry: { index: "src/main.ts" },
    platform: "node",
    target: "node24",
    format: "esm",
    dts: false,
    exports: false,
    deps: {
      alwaysBundle: [/./],
      onlyBundle: [
        "effect",
        "@actions/core",
        "@actions/http-client",
        "@actions/io",
        "@actions/exec",
        "tunnel",
        "undici",
        "@fastify/busboy",
      ],
      onlyImport: [],
    },
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
