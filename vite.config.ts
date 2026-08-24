import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { powerApps } from "@microsoft/power-apps-vite/plugin";

export default defineConfig({
  plugins: [react(), powerApps()],
  server: { port: 5173, open: true },
});
