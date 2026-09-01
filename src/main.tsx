import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { hydrate, setHostQueryParams } from "./data/store";
import "./styles.css";

class RootError extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };
  static getDerivedStateFromError(err: Error) {
    return { message: err.message || String(err) };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(err, info.componentStack);
  }
  render() {
    if (this.state.message) {
      return (
        <div style={{ padding: 28, fontFamily: "Segoe UI, sans-serif", color: "#1E1814" }}>
          <h1 style={{ fontSize: 18, marginTop: 0 }}>Andalusia Pulse failed to load</h1>
          <p>{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Timed out")), ms);
    work.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (err) => { window.clearTimeout(timer); reject(err); },
    );
  });
}

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <RootError>
      <App />
    </RootError>
  </StrictMode>,
);

async function connectDataverse() {
  try {
    const mod = await import("@microsoft/power-apps/app");
    if (typeof mod.getContext !== "function") return false;
    const ctx = await withTimeout(mod.getContext(), 8000);
    const params = (ctx as { app?: { queryParams?: Record<string, string> } })?.app?.queryParams;
    setHostQueryParams(params);
    return true;
  } catch {
    return false;
  }
}

void connectDataverse()
  .then((ready) => hydrate(ready))
  .catch((err) => {
    console.error(err);
  });
