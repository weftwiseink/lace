import { defineConfig } from "vite";

export default defineConfig({
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
        "arktype",
        "dockerfile-ast",
        "jsonc-parser",
      ],
    },
    minify: false,
    sourcemap: true,
  },
});
