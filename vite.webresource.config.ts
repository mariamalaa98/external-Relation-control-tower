import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "webresource-dist");
const deliverable = path.join(root, "AndalusiaPulse-WebResource.html");

function inlineSingleHtml(): Plugin {
  return {
    name: "inline-single-html",
    closeBundle() {
      const htmlPath = path.join(outDir, "webresource-build", "index.html");
      let html = readFileSync(htmlPath, "utf8");
      const assetsDir = path.join(outDir, "assets");
      const assets = readdirSync(assetsDir);
      let css = "";
      let js = "";

      for (const file of assets) {
        const full = path.join(assetsDir, file);
        if (file.endsWith(".css")) {
          css += readFileSync(full, "utf8").replace(/<\/style>/gi, "<\\/style>");
        }
        if (file.endsWith(".js")) {
          js += readFileSync(full, "utf8").replace(/<\/script>/gi, "<\\/script>");
        }
      }

      html = html.replace(/<link[^>]+href="[^"]*assets\/[^"]+\.css"[^>]*>/g, "");
      html = html.replace(/<script[^>]+src="[^"]*assets\/[^"]+\.js"[^>]*><\/script>/g, "");
      html = html.replace(/<script type="module"[^>]*>[\s\S]*?<\/script>/g, "");

      if (css) {
        html = html.replace("</head>", () => `<style>${css}</style>\n  </head>`);
      }
      if (js) {
        // Function replacer is required: String.replace treats $& in the bundle as "the match"
        // and was injecting </body> into React's minified `$&&` checks.
        html = html.replace("</body>", () => `<script>${js}</script>\n  </body>`);
      }

      html = html.replace(
        "<head>",
        () => `<head>
    <!-- Andalusia Pulse WR-15. Upload this file. Look for WR-15-shared in the bottom-right. -->`,
      );

      writeFileSync(htmlPath, html);
      copyFileSync(htmlPath, deliverable);
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineSingleHtml()],
  resolve: {
    alias: {
      "@microsoft/power-apps/data": path.join(root, "webresource-build/power-apps-data.ts"),
    },
  },
  base: "./",
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    modulePreload: false,
    rollupOptions: {
      input: path.join(root, "webresource-build/index.html"),
      output: {
        format: "iife",
        name: "AndalusiaPulse",
        inlineDynamicImports: true,
      },
    },
  },
});
