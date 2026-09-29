import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
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

/** Shared UI mount for the Code App and the Dynamics web resource. */
export function renderApp() {
  const el = document.getElementById("root");
  if (!el) return false;
  createRoot(el).render(
    <StrictMode>
      <RootError>
        <App />
      </RootError>
    </StrictMode>,
  );
  return true;
}
