import { getContext } from "@microsoft/power-apps/app";
import { renderApp } from "./boot";
import { hydrate, setHostQueryParams, syncHostQueryFromWindow } from "./data/store";

function withTimeout<T>(work: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Timed out")), ms);
    work.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (err) => { window.clearTimeout(timer); reject(err); },
    );
  });
}

async function connectDataverse() {
  try {
    const ctx = await withTimeout(getContext(), 8000);
    const params = (ctx as { app?: { queryParams?: Record<string, string> } })?.app?.queryParams;
    setHostQueryParams(params);
    return true;
  } catch {
    return false;
  }
}

function boot() {
  if (!renderApp()) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }
  syncHostQueryFromWindow();
  void connectDataverse()
    .then((ready) => hydrate(ready))
    .catch((err) => {
      console.error(err);
    });
}

boot();
