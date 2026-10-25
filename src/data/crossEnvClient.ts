import { MicrosoftDataverseService } from "../generated/services/MicrosoftDataverseService";
import { DATA_ENVIRONMENT } from "./environments";

const ORGANIZATION = DATA_ENVIRONMENT.url.replace(/\/$/, "");
const PREFER = 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000';
const ACCEPT = "application/json";

type Loose = Record<string, unknown>;

type QueryOptions = {
  select?: string[];
  filter?: string;
  orderBy?: string[];
  top?: number;
  expand?: string | string[];
};

function rowsOf(data: unknown): Loose[] {
  if (Array.isArray(data)) return data as Loose[];
  if (data && typeof data === "object" && Array.isArray((data as { value?: unknown }).value)) {
    return (data as { value: Loose[] }).value;
  }
  return [];
}

function withFormattedNames(record: Loose): Loose {
  const next: Loose = { ...record };
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const match = key.match(/^(.*)@OData\.Community\.Display\.V1\.FormattedValue$/i);
    if (!match) continue;
    const logical = match[1];
    if (logical.startsWith("_") && logical.endsWith("_value")) {
      const lookup = logical.slice(1, -"_value".length);
      if (next[`${lookup}name`] == null) next[`${lookup}name`] = value;
    } else if (next[`${logical}name`] == null) {
      next[`${logical}name`] = value;
    }
  }
  return next;
}

function failed(result: { success?: boolean; error?: unknown }) {
  if (result?.success !== false) return;
  const error = result.error;
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : JSON.stringify(error);
  throw new Error(message || `Dataverse request failed (${ORGANIZATION})`);
}

function skipTokenFrom(data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const nextLink = (data as Loose)["@odata.nextLink"];
  if (typeof nextLink !== "string" || !nextLink) return undefined;
  try {
    const outer = new URL(nextLink);
    const inner = outer.searchParams.get("next");
    const queryAt = inner?.indexOf("?") ?? -1;
    if (inner && queryAt !== -1) {
      return new URLSearchParams(inner.slice(queryAt + 1)).get("$skiptoken") || undefined;
    }
    return outer.searchParams.get("$skiptoken") || undefined;
  } catch {
    return undefined;
  }
}

async function listRows(table: string, options?: QueryOptions) {
  const select = options?.select?.filter(Boolean).join(",") || undefined;
  const orderBy = options?.orderBy?.filter(Boolean).join(",") || undefined;
  const expand = Array.isArray(options?.expand) ? options.expand.join(",") : options?.expand;
  const rows: Loose[] = [];
  let skiptoken: string | undefined;
  const cap = options?.top;
  for (let page = 0; page < 40; page++) {
    const result = await MicrosoftDataverseService.ListRecordsWithOrganization(
      ORGANIZATION,
      table,
      PREFER,
      ACCEPT,
      undefined,
      undefined,
      select,
      options?.filter,
      orderBy,
      expand,
      undefined,
      skiptoken ? undefined : cap,
      skiptoken,
    );
    failed(result);
    rows.push(...rowsOf(result.data).map(withFormattedNames));
    if (cap != null && rows.length >= cap) return rows.slice(0, cap);
    skiptoken = skipTokenFrom(result.data);
    if (!skiptoken) break;
  }
  return rows;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function asBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string" && data.trim()) {
    const payload = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
    try {
      return fromBase64(payload.replace(/\s/g, ""));
    } catch {
      return undefined;
    }
  }
  if (data && typeof data === "object" && "$content" in data) {
    return asBytes((data as { $content?: unknown }).$content);
  }
  return undefined;
}

export function getClient(_info?: unknown) {
  return {
    async retrieveMultipleRecordsAsync<T>(table: string, options?: QueryOptions) {
      const data = await listRows(table, options);
      return { success: true, data: data as T[] };
    },

    async retrieveRecordAsync<T>(table: string, id: string, options?: QueryOptions) {
      const select = options?.select?.filter(Boolean).join(",") || undefined;
      const expand = Array.isArray(options?.expand) ? options.expand.join(",") : options?.expand;
      const result = await MicrosoftDataverseService.GetItemWithOrganization(
        "return=representation",
        ACCEPT,
        ORGANIZATION,
        table,
        id.replace(/[{}]/g, ""),
        undefined,
        undefined,
        select,
        expand,
      );
      failed(result);
      return { success: true, data: withFormattedNames((result.data || {}) as Loose) as T };
    },

    async createRecordAsync<TIn extends Loose, TOut>(table: string, record: TIn) {
      const result = await MicrosoftDataverseService.CreateRecordWithOrganization(
        "return=representation",
        ACCEPT,
        ORGANIZATION,
        table,
        record as Record<string, unknown>,
      );
      failed(result);
      const body = (result as { data?: unknown }).data;
      const data = (body && typeof body === "object" ? body : record) as TOut;
      return { success: true, data };
    },

    async updateRecordAsync<T>(table: string, id: string, changedFields: Loose) {
      const result = await MicrosoftDataverseService.UpdateRecordWithOrganization(
        "return=representation",
        ACCEPT,
        ORGANIZATION,
        table,
        id.replace(/[{}]/g, ""),
        changedFields as Record<string, unknown>,
      );
      failed(result);
      const data = (result.data && typeof result.data === "object" ? result.data : { ...changedFields }) as T;
      return { success: true, data };
    },

    async deleteRecordAsync(table: string, id: string) {
      const result = await MicrosoftDataverseService.DeleteRecordWithOrganization(
        ORGANIZATION,
        table,
        id.replace(/[{}]/g, ""),
      );
      failed(result);
    },

    async executeAsync() {
      return { success: true, data: undefined };
    },

    async uploadFileToRecord(table: string, id: string, columnName: string, fileName: string, data: Uint8Array) {
      const result = await MicrosoftDataverseService.UpdateEntityFileImageFieldContentWithOrganization(
        "application/octet-stream",
        ORGANIZATION,
        table,
        id.replace(/[{}]/g, ""),
        columnName,
        toBase64(data),
        fileName,
      );
      failed(result);
      return { success: true, data: undefined };
    },

    async deleteFileOrImageFromRecord(table: string, id: string, columnName: string) {
      const result = await MicrosoftDataverseService.UpdateRecordWithOrganization(
        "return=representation",
        ACCEPT,
        ORGANIZATION,
        table,
        id.replace(/[{}]/g, ""),
        { [columnName]: null },
      );
      failed(result);
      return { success: true, data: undefined };
    },

    async downloadImageFromRecord(table: string, id: string, columnName: string) {
      return this.downloadFileFromRecord(table, id, columnName);
    },

    async downloadFileFromRecord(table: string, id: string, columnName: string) {
      const result = await MicrosoftDataverseService.GetEntityFileImageFieldContentWithOrganization(
        "bytes=0-",
        ORGANIZATION,
        table,
        id.replace(/[{}]/g, ""),
        columnName,
      );
      const bytes = result.success ? asBytes(result.data) : undefined;
      if (bytes?.length) return { success: true, data: bytes };
      const loaded = await this.retrieveRecordAsync<Loose>(table, id, { select: [columnName] });
      const fallback = asBytes(loaded.data?.[columnName]);
      if (fallback?.length) return { success: true, data: fallback };
      failed(result);
      throw new Error(`No file content on ${table}.${columnName}`);
    },
  };
}

export function deserializeMultiSelectPicklistFields<T>(value: T): T {
  return value;
}

export function serializeMultiSelectPicklistFields<T>(value: T): T {
  return value;
}
