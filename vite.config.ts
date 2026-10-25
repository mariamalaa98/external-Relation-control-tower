import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

const crossEnvClient = path.join(root, "src/data/crossEnvClient.ts");

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "cross-env-dataverse",
      enforce: "pre",
      resolveId(source, importer) {
        if (source !== "@microsoft/power-apps/data") return null;
        const from = (importer || "").replace(/\\/g, "/");
        if (from.endsWith("/MicrosoftDataverseService.ts")) return null;
        return crossEnvClient;
      },
    },
  ],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  server: { port: 5173, open: true },
});
