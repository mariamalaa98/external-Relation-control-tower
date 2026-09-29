import { renderApp } from "../src/boot";
import { hydrate, syncHostQueryFromWindow } from "../src/data/store";
import { PULSE_WR_BUILD, isDataverseHost } from "./power-apps-data";

function markBuild() {
  const tag = document.createElement("div");
  tag.id = "pulse-wr-build";
  tag.textContent = PULSE_WR_BUILD;
  tag.style.cssText = "position:fixed;bottom:10px;right:10px;z-index:9999;background:#1C1411;color:#fff;padding:5px 9px;font:11px/1.2 Segoe UI,sans-serif;border-radius:6px;opacity:.85";
  document.body.appendChild(tag);
}

function boot() {
  if (!renderApp()) {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    return;
  }
  markBuild();
  syncHostQueryFromWindow();
  void hydrate(isDataverseHost()).catch((err) => {
    console.error(err);
    return hydrate(false);
  });
}

boot();
