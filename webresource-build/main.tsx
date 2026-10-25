import { renderApp } from "../src/boot";
import { hydrate, syncHostQueryFromWindow } from "../src/data/store";
import { isDataverseHost } from "./power-apps-data";

/** Same mount and Dataverse load as src/main.tsx. A web resource has no Power Apps getContext, so the host check stands in for it. */
function boot() {
  if (!renderApp()) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }
  syncHostQueryFromWindow();
  void hydrate(isDataverseHost()).catch((err) => {
    console.error(err);
  });
}

boot();
