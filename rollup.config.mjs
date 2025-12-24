import svelte from "rollup-plugin-svelte";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import autoPreprocess from "svelte-preprocess";
import { env } from "process";
import * as fs from "fs";
import * as path from "path";

const DIST_DIR = "dist";

function copyAssets() {
  return {
    name: "copy-assets",
    writeBundle() {
      if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR);
      }

      // Copy manifest.json
      if (fs.existsSync("manifest.json")) {
        fs.copyFileSync("manifest.json", path.join(DIST_DIR, "manifest.json"));
      }

      // Copy styles.css
      if (fs.existsSync("styles.css")) {
        fs.copyFileSync("styles.css", path.join(DIST_DIR, "styles.css"));
      }

      // Copy bin directory (recursive logic not needed if flat, but safer to check)
      const binSrc = "bin";
      const binDest = path.join(DIST_DIR, "bin");
      if (fs.existsSync(binSrc)) {
        if (!fs.existsSync(binDest)) fs.mkdirSync(binDest, { recursive: true });
        fs.readdirSync(binSrc).forEach(file => {
          const srcFile = path.join(binSrc, file);
          const destFile = path.join(binDest, file);
          // Simple file copy, ignoring nested folders for now as bin/ structure is usually flat
          if (fs.statSync(srcFile).isFile()) {
            fs.copyFileSync(srcFile, destFile);
          }
        });
      }

      console.log(`[Build] Output generated in ${DIST_DIR}/`);
    }
  }
}

export default {
  input: "src/main.ts",
  output: {
    format: "cjs",
    file: `${DIST_DIR}/main.js`,
    exports: "default",
    inlineDynamicImports: true,
  },
  external: ["obsidian", "fs", "os", "path", "child_process"],
  plugins: [
    svelte({
      emitCss: false,
      compilerOptions: {
        css: "external",
      },
      preprocess: autoPreprocess(),
    }),
    typescript({ sourceMap: env.env === "DEV" }),
    resolve({
      browser: true,
      dedupe: ["svelte"],
    }),
    commonjs({
      include: "node_modules/**",
    }),
    copyAssets(),
  ],
};
