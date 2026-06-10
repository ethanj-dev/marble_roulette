import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const outDir = "dist/github-pages";
const outputPath = resolve(outDir);

function githubPagesFiles(): Plugin {
  return {
    name: "github-pages-files",
    closeBundle() {
      mkdirSync(outputPath, { recursive: true });
      copyFileSync(
        resolve(outputPath, "index.html"),
        resolve(outputPath, "404.html")
      );
      writeFileSync(resolve(outputPath, ".nojekyll"), "");
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE ?? "./",
  publicDir: resolve("public"),
  root: "spa",
  build: {
    emptyOutDir: true,
    outDir: outputPath,
    rollupOptions: {
      input: resolve("spa/index.html"),
    },
  },
  plugins: [react(), githubPagesFiles()],
});
