export const COMM_DEEP_LINK_PARAM = "comm";
const WEB_RESOURCE_NAME = "erc_controltower";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let hostQuery: Record<string, string> = {};

type XrmBag = {
  Utility?: {
    getGlobalContext?: () => {
      getClientUrl?: () => string;
      getQueryStringParameters?: () => Record<string, string>;
    };
  };
};

/** Query params from the Power Apps player. Code Apps run in an iframe, so window.location does not include ?comm=. */
export function setHostQueryParams(params?: Record<string, string> | null) {
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== "") hostQuery[key.toLowerCase()] = String(value);
  }
}

/** Read ?comm= from this window, parent, or top. Used by both the Code App iframe and the web resource. */
export function syncHostQueryFromWindow() {
  for (const href of collectHrefs()) {
    try {
      const url = new URL(href);
      const fromSearch: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        if (value) fromSearch[key] = value;
      });
      setHostQueryParams(fromSearch);
      const hash = (url.hash || "").replace(/^#/, "");
      if (hash.includes("=")) {
        const hashParams = new URLSearchParams(hash.startsWith("?") ? hash.slice(1) : hash);
        const fromHash: Record<string, string> = {};
        hashParams.forEach((value, key) => {
          if (value) fromHash[key] = value;
        });
        setHostQueryParams(fromHash);
      }
    } catch { /* ignore */ }
  }
}

export function cleanRecordGuid(value?: string) {
  if (!value) return "";
  const raw = value.trim().replace(/[{}]/g, "");
  return GUID.test(raw) ? raw : "";
}

function xrmBags(): XrmBag[] {
  const bags: XrmBag[] = [];
  if (typeof window === "undefined") return bags;
  for (const pick of [() => window, () => window.parent, () => window.top]) {
    try {
      const xrm = (pick() as unknown as { Xrm?: XrmBag }).Xrm;
      if (xrm) bags.push(xrm);
    } catch { /* cross-origin */ }
  }
  return bags;
}

function xrmClientUrl() {
  for (const xrm of xrmBags()) {
    try {
      const url = xrm.Utility?.getGlobalContext?.()?.getClientUrl?.();
      if (url) return url.replace(/\/$/, "");
    } catch { /* ignore */ }
  }
  return "";
}

function collectHrefs() {
  const hrefs: string[] = [];
  if (typeof window === "undefined") return hrefs;
  hrefs.push(window.location.href);
  try { hrefs.push(window.parent.location.href); } catch { /* iframe */ }
  try { hrefs.push(window.top?.location.href || ""); } catch { /* iframe */ }
  if (typeof document !== "undefined" && document.referrer) hrefs.push(document.referrer);
  return [...new Set(hrefs.filter(Boolean))];
}

function webResourceNameFromHref(href: string) {
  try {
    const url = new URL(href);
    const fromQuery = url.searchParams.get("webresourceName") || url.searchParams.get("webresourcename");
    if (fromQuery) return fromQuery;
    const match = url.pathname.match(/\/webresources\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch { /* ignore */ }
  return "";
}

function isDynamicsHref(href: string) {
  return /dynamics\.com|crm\.microsoftdynamics|\/webresources\/|pagetype=webresource/i.test(href);
}

function powerAppsPlayBase(href: string) {
  try {
    const url = new URL(href);
    if (!/(^|\.)powerapps\.com$/i.test(url.hostname)) return "";
    const match = url.pathname.match(/\/play\/e\/[^/]+\/app\/[^/]+/i);
    if (!match) return "";
    return `${url.origin}${match[0]}`;
  } catch {
    return "";
  }
}

/** Current app base URL for this environment. Never hardcode org, app, or environment IDs. */
function playBaseUrl() {
  const hrefs = collectHrefs();
  const client = xrmClientUrl();
  const wrName = hrefs.map(webResourceNameFromHref).find(Boolean) || WEB_RESOURCE_NAME;

  if (client || hrefs.some(isDynamicsHref)) {
    const host = client || (() => {
      try { return new URL(hrefs.find(isDynamicsHref) || hrefs[0] || "").origin; } catch { return ""; }
    })();
    if (host) return `${host.replace(/\/$/, "")}/WebResources/${wrName}`;
  }

  const play = hrefs.map(powerAppsPlayBase).find(Boolean);
  if (play) return play;

  try {
    const url = new URL(hrefs[0] || (typeof window !== "undefined" ? window.location.href : ""));
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

function withCommParam(base: string, guid: string) {
  if (!guid) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${COMM_DEEP_LINK_PARAM}=${guid}`;
}

/** Deep link that opens this app on the communication details overlay in the current environment. */
export function communicationPlayUrl(recordId: string) {
  return withCommParam(playBaseUrl(), cleanRecordGuid(recordId));
}

/**
 * Deeplink that opens this app on the communication details overlay.
 * Do not add tenantId — a wrong tenant sends login to AADSTS90002.
 */
export function communicationDeepLink(recordId: string) {
  return communicationPlayUrl(recordId);
}

function guidFromParams(params: URLSearchParams | Record<string, string>) {
  const read = (key: string) => {
    if (params instanceof URLSearchParams) return params.get(key) || "";
    return params[key] || params[key.toLowerCase()] || "";
  };
  let data = read("data");
  try {
    data = decodeURIComponent(data || "");
  } catch {
    /* keep raw */
  }
  return cleanRecordGuid(read(COMM_DEEP_LINK_PARAM) || read("communicationid") || data);
}

function guidFromXrm() {
  try {
    const qs = xrmBags()
      .map((xrm) => {
        try { return xrm.Utility?.getGlobalContext?.()?.getQueryStringParameters?.() || {}; } catch { return {}; }
      })
      .find((row) => Object.keys(row).length) || {};
    return guidFromParams(qs);
  } catch {
    return "";
  }
}

function guidFromHref(currentUrl: string) {
  if (!currentUrl) return "";
  try {
    const url = new URL(currentUrl);
    const fromSearch = guidFromParams(url.searchParams);
    if (fromSearch) return fromSearch;
    const hash = (url.hash || "").replace(/^#/, "");
    if (hash.includes("=")) {
      const fromHash = guidFromParams(new URLSearchParams(hash.startsWith("?") ? hash.slice(1) : hash));
      if (fromHash) return fromHash;
    }
  } catch {
    return "";
  }
  return "";
}

export function parseCommunicationDeepLink(currentUrl = typeof window === "undefined" ? "" : window.location.href) {
  const fromPlayer = guidFromParams(hostQuery);
  if (fromPlayer) return fromPlayer;
  const fromXrm = guidFromXrm();
  if (fromXrm) return fromXrm;
  for (const href of [currentUrl, ...collectHrefs()]) {
    const guid = guidFromHref(href);
    if (guid) return guid;
  }
  return "";
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
