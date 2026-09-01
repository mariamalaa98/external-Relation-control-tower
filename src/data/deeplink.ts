const APP_ID = "dd69ba9f-0c04-49f7-8da3-f1aa49aaaa3d";
const ENVIRONMENT_ID = "9ce6fb09-5b63-e9f4-9185-b707b4b3425e";

export const COMM_DEEP_LINK_PARAM = "comm";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let hostQuery: Record<string, string> = {};

/** Query params from the Power Apps player. Code Apps run in an iframe, so window.location does not include ?comm=. */
export function setHostQueryParams(params?: Record<string, string> | null) {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null && value !== "") next[key.toLowerCase()] = String(value);
  }
  hostQuery = next;
}

export function cleanRecordGuid(value?: string) {
  if (!value) return "";
  const raw = value.trim().replace(/[{}]/g, "");
  return GUID.test(raw) ? raw : "";
}

function playBaseUrl() {
  return `https://apps.powerapps.com/play/e/${ENVIRONMENT_ID}/app/${APP_ID}`;
}

/** Canonical Power Apps play URL for a communication GUID. Use this in Power Automate. */
export function communicationPlayUrl(recordId: string) {
  const guid = cleanRecordGuid(recordId);
  if (!guid) return playBaseUrl();
  return `${playBaseUrl()}?${COMM_DEEP_LINK_PARAM}=${guid}`;
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
  return cleanRecordGuid(read(COMM_DEEP_LINK_PARAM) || read("communicationid") || "");
}

export function parseCommunicationDeepLink(currentUrl = typeof window === "undefined" ? "" : window.location.href) {
  const fromPlayer = guidFromParams(hostQuery);
  if (fromPlayer) return fromPlayer;
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

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
