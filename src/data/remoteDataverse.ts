import { OperationExecutor } from "../../node_modules/@microsoft/power-apps/dist/internal/data/OperationExecutor.js";
import { DataSources, HttpMethod } from "../../node_modules/@microsoft/power-apps/dist/internal/data/core/common/types.js";
import { RuntimeDataClient } from "../../node_modules/@microsoft/power-apps/dist/internal/data/core/runtimeClient/runtimeDataClient.js";
import { setDataOperationExecutor } from "@microsoft/power-apps/internal/data";
import { getClient, setDataverseTransport, type DataverseCall } from "../../webresource-build/power-apps-data";
import { DATA_ENVIRONMENT } from "./environments";

type HostResult = { success?: boolean; data?: unknown; error?: { message?: string } | Error };

let hostClient: RuntimeDataClient | null = null;

function client() {
  if (!hostClient) hostClient = new RuntimeDataClient(new OperationExecutor());
  return hostClient;
}

function messageOf(error: HostResult["error"], fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && error.message) return String(error.message);
  return fallback;
}

function failed(message: string): DataverseCall {
  const text = JSON.stringify({
    error: { message: `${message} (reading ${DATA_ENVIRONMENT.name} at ${DATA_ENVIRONMENT.url})` },
  });
  return {
    ok: false,
    status: 400,
    statusText: message,
    headers: { get: () => null },
    text,
    buffer: new TextEncoder().encode(text).buffer,
  };
}

function copyBytes(bytes: Uint8Array) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function succeeded(data: unknown): DataverseCall {
  if (data instanceof Uint8Array) {
    const buffer = copyBytes(data);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      text: "",
      buffer,
    };
  }
  const text = data == null ? "" : typeof data === "string" ? data : JSON.stringify(data);
  return {
    ok: true,
    status: data == null ? 204 : 200,
    statusText: "OK",
    headers: { get: () => null },
    text,
    buffer: new TextEncoder().encode(text).buffer,
  };
}

function headerRecord(headers: HeadersInit | undefined) {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { out[key] = value; });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) out[key] = String(value);
  }
  return out;
}

function headerValue(headers: Record<string, string>, name: string) {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1] || "";
}

function jsonBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string" || !body.trim()) return {};
  return JSON.parse(body) as Record<string, unknown>;
}

async function hostCall(path: string, init: RequestInit | undefined, resource: string): Promise<DataverseCall> {
  const url = `${DATA_ENVIRONMENT.url.replace(/\/$/, "")}/api/data/v9.2/${path.replace(/^\//, "")}`;
  const method = (init?.method || "GET").toUpperCase();
  const extra = headerRecord(init?.headers);
  const file = headerValue(extra, "content-type").includes("octet-stream");
  const table = path.split("(")[0].split("?")[0];
  const context = {
    datasetName: resource,
    isDataVerseOperation: true,
    operationName: `${method} ${table}`,
    fileName: headerValue(extra, "x-ms-file-name") || undefined,
  };
  const api = client();
  let result: HostResult;
  if (file && method === "PATCH" && init?.body instanceof ArrayBuffer) {
    result = await api.uploadDataAsync(url, DataSources.Dataverse, table, new Uint8Array(init.body), context);
  } else if (method === "POST") {
    result = await api.createDataAsync(url, DataSources.Dataverse, table, jsonBody(init?.body), context);
  } else if (method === "PATCH") {
    result = await api.updateDataAsync(url, DataSources.Dataverse, table, jsonBody(init?.body), context);
  } else if (method === "DELETE") {
    result = await api.deleteDataAsync(url, DataSources.Dataverse, table, context);
  } else {
    result = await api.retrieveDataAsync(
      url,
      DataSources.Dataverse,
      table,
      HttpMethod.GET,
      { Prefer: headerValue(extra, "prefer") || 'odata.include-annotations="*"', Accept: headerValue(extra, "accept") || "application/json" },
      undefined,
      context,
    );
  }
  if (!result?.success) return failed(messageOf(result?.error, `Could not ${method} ${table}`));
  return succeeded(result.data);
}

/**
 * The player only has a token for the Dataverse resource registered on this app.
 * That id is "default.cds" (the code-app SDK dataset). The org URL is not a
 * registered resource, which is why token lookup failed. The Web API URL below
 * is the live IT org.
 */
const DATAVERSE_RESOURCE = "default.cds";

/** Point the Code App data client at Live. */
export function installRemoteDataverse() {
  setDataverseTransport(async (path, init) => {
    try {
      return await hostCall(path, init, DATAVERSE_RESOURCE);
    } catch (err) {
      return failed(err instanceof Error ? err.message : String(err));
    }
  });
  setDataOperationExecutor(getClient() as never);
}
