import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";

async function boot() {
  let dataverseReady = false;
  try {
    const mod = await import("@microsoft/power-apps/app");
    if (typeof mod.initialize === "function") {
      await mod.initialize();
      dataverseReady = true;
    }
  } catch {
    dataverseReady = false;
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App dataverseReady={dataverseReady} />
    </StrictMode>
  );
}

void boot();
