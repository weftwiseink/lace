import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "node22",
    outDir: "dist",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        /^node:/,
        "citty",
        "dockerfile-ast",
        "jsonc-parser",
      ],
    },
    minify: false,
    sourcemap: true,
  },
  test: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
