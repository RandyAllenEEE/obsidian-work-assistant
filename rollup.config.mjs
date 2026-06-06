import svelte from "rollup-plugin-svelte";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import autoPreprocess from "svelte-preprocess";
import { env } from "process";
import * as fs from "fs";
import * as path from "path";

const DIST_DIR = "dist";

function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) return;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  fs.readdirSync(src, { withFileTypes: true }).forEach((entry) => {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
      return;
    }

    if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

function isSvelteCircularDependency(warning) {
  if (warning.code !== "CIRCULAR_DEPENDENCY") return false;
  const ids = Array.isArray(warning.ids) ? warning.ids : [];
  if (ids.length > 0) {
    return ids.every((id) => id.includes("node_modules/svelte/"));
  }
  return typeof warning.message === "string" && warning.message.includes("node_modules/svelte/");
}

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

      copyDirectory("bin", path.join(DIST_DIR, "bin"));
      copyDirectory("periodic_note_templates", path.join(DIST_DIR, "periodic_note_templates"));

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
  onwarn(warning, warn) {
    if (isSvelteCircularDependency(warning)) return;
    warn(warning);
  },
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
