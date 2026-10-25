/** Dataverse client for the HTML web resource. Uses OData entity-set names (same as the Code App). */

import { DATA_ENVIRONMENT } from "../src/data/environments";

type Loose = Record<string, unknown>;

export type DataverseCall = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text: string;
  buffer: ArrayBuffer;
};

/** Code App installs this so calls go through the Power Apps host to Live. */
export type DataverseTransport = (path: string, init?: RequestInit) => Promise<DataverseCall>;

let transportOverride: DataverseTransport | null = null;

export function setDataverseTransport(transport: DataverseTransport | null) {
  transportOverride = transport;
}

/** Entity-set name used by /api/data/v9.2/{set} */
const ENTITY_SET: Record<string, string> = {
  emails: "emails",
  email: "emails",
  activityparties: "activityparties",
  activityparty: "activityparties",
  activitymimeattachments: "activitymimeattachments",
  activitymimeattachment: "activitymimeattachments",
  businessunits: "businessunits",
  businessunit: "businessunits",
  systemusers: "systemusers",
  systemuser: "systemusers",
  teams: "teams",
  team: "teams",
  cr603_chklst_departmentses: "cr603_chklst_departmentses",
  cr603_chklst_departments: "cr603_chklst_departmentses",
  cr603_chklst_department: "cr603_chklst_departmentses",
  erc_communications: "erc_communications",
  erc_communication: "erc_communications",
  erc_esclationchains: "erc_esclationchains",
  erc_esclationchain: "erc_esclationchains",
  erc_externalparties: "erc_externalparties",
  erc_externalparty: "erc_externalparties",
  erc_sla2s: "erc_sla2s",
  erc_sla2: "erc_sla2s",
  erc_licenseandcontracts: "erc_licenseandcontracts",
  erc_licenseandcontract: "erc_licenseandcontracts",
  erc_notifications: "erc_notifications",
  erc_notification: "erc_notifications",
  erc_renewals: "erc_renewals",
  erc_renewal: "erc_renewals",
  erc_documentarchives: "erc_documentarchives",
  erc_documentarchive: "erc_documentarchives",
  erc_communicationaudits: "erc_communicationaudits",
  erc_communicationaudit: "erc_communicationaudits",
};

/** Logical name used by Xrm.WebApi.retrieveMultipleRecords */
const LOGICAL: Record<string, string> = {
  emails: "email",
  activityparties: "activityparty",
  activitymimeattachments: "activitymimeattachment",
  businessunits: "businessunit",
  systemusers: "systemuser",
  teams: "team",
  cr603_chklst_departmentses: "cr603_chklst_departments",
  cr603_chklst_departments: "cr603_chklst_departments",
  cr603_chklst_department: "cr603_chklst_departments",
  erc_communications: "erc_communication",
  erc_esclationchains: "erc_esclationchain",
  erc_externalparties: "erc_externalparty",
  erc_sla2s: "erc_sla2",
  erc_licenseandcontracts: "erc_licenseandcontract",
  erc_notifications: "erc_notification",
  erc_renewals: "erc_renewal",
  erc_documentarchives: "erc_documentarchive",
  erc_communicationaudits: "erc_communicationaudit",
};

const PRIMARY_KEY: Record<string, string> = {
  emails: "activityid",
  email: "activityid",
  activityparties: "activitypartyid",
  activityparty: "activitypartyid",
  activitymimeattachments: "activitymimeattachmentid",
  activitymimeattachment: "activitymimeattachmentid",
  businessunits: "businessunitid",
  businessunit: "businessunitid",
  systemusers: "systemuserid",
  systemuser: "systemuserid",
  teams: "teamid",
  team: "teamid",
  erc_communications: "erc_communicationid",
  erc_communication: "erc_communicationid",
  erc_esclationchains: "erc_esclationchainid",
  erc_esclationchain: "erc_esclationchainid",
  erc_externalparties: "erc_externalpartyid",
  erc_externalparty: "erc_externalpartyid",
  erc_licenseandcontracts: "erc_licenseandcontractid",
  erc_licenseandcontract: "erc_licenseandcontractid",
  erc_notifications: "erc_notificationid",
  erc_notification: "erc_notificationid",
  erc_renewals: "erc_renewalid",
  erc_renewal: "erc_renewalid",
  erc_sla2s: "erc_sla2id",
  erc_sla2: "erc_sla2id",
  cr603_chklst_departmentses: "cr603_chklst_departmentsid",
  cr603_chklst_departments: "cr603_chklst_departmentsid",
  cr603_chklst_department: "cr603_chklst_departmentsid",
  erc_documentarchives: "erc_documentarchiveid",
  erc_documentarchive: "erc_documentarchiveid",
  erc_communicationaudits: "erc_communicationauditid",
  erc_communicationaudit: "erc_communicationauditid",
};

type XrmBag = {
  WebApi?: {
    retrieveMultipleRecords: (entity: string, query?: string, maxPageSize?: number) => Promise<{ entities: Loose[]; nextLink?: string }>;
    retrieveRecord: (entity: string, id: string, query?: string) => Promise<Loose>;
    createRecord: (entity: string, data: Loose) => Promise<{ id: string; entityType: string }>;
    updateRecord: (entity: string, id: string, data: Loose) => Promise<{ id: string; entityType: string }>;
    deleteRecord: (entity: string, id: string) => Promise<unknown>;
    online?: XrmBag["WebApi"];
  };
  Utility?: { getGlobalContext?: () => { getClientUrl?: () => string } };
};

function windowsWithXrm(): XrmBag[] {
  const bags: XrmBag[] = [];
  for (const pick of [() => window, () => window.parent, () => window.top]) {
    try {
      const xrm = (pick() as unknown as { Xrm?: XrmBag }).Xrm;
      if (xrm) bags.push(xrm);
    } catch { /* cross-origin */ }
  }
  return bags;
}

export function getXrm(): { WebApi: NonNullable<XrmBag["WebApi"]> } | undefined {
  for (const xrm of windowsWithXrm()) {
    const web = xrm.WebApi?.online && typeof xrm.WebApi.online.retrieveMultipleRecords === "function"
      ? xrm.WebApi.online
      : xrm.WebApi;
    if (web && typeof web.retrieveMultipleRecords === "function") return { WebApi: web };
  }
  return undefined;
}

export function isDataverseHost() {
  if (getXrm()) return true;
  const href = window.location.href.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  return href.includes("dynamics.com")
    || href.includes("crm.microsoftdynamics")
    || path.includes("/webresources/")
    || href.includes("pagetype=webresource");
}

function hostClientUrl() {
  for (const xrm of windowsWithXrm()) {
    try {
      const url = xrm.Utility?.getGlobalContext?.()?.getClientUrl?.();
      if (url) return url.replace(/\/$/, "");
    } catch { /* ignore */ }
  }
  return window.location.origin.replace(/\/$/, "");
}

/** Always the live IT org. The Code App may be opened from another environment. */
function clientUrl() {
  return DATA_ENVIRONMENT.url.replace(/\/$/, "");
}

function hostIsDataOrg() {
  try {
    return new URL(hostClientUrl()).host.toLowerCase() === new URL(DATA_ENVIRONMENT.url).host.toLowerCase();
  } catch {
    return false;
  }
}

/** Xrm.WebApi talks to the page's org. Use it only when that page is already Live. */
function canUseHostXrm() {
  return !transportOverride && hostIsDataOrg();
}

function entitySet(table: string) {
  return ENTITY_SET[table] || table;
}

function logicalName(table: string) {
  return LOGICAL[table] || table;
}

function primaryKey(table: string) {
  return PRIMARY_KEY[table] || `${logicalName(table)}id`;
}

function cleanId(id: string) {
  return String(id || "").replace(/[{}]/g, "").trim();
}

function xrmError(err: unknown) {
  if (err instanceof Error && err.message) return err;
  if (typeof err === "string" && err.trim()) return new Error(err);
  if (err && typeof err === "object") {
    const row = err as { message?: string; error?: { message?: string; error?: { message?: string } } };
    const message = row.message || row.error?.message || row.error?.error?.message;
    if (message) return new Error(message);
  }
  return new Error("Dataverse request failed");
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

type QueryOptions = {
  select?: string[];
  filter?: string;
  orderBy?: string[];
  top?: number;
  skip?: number;
  expand?: string | string[];
  count?: boolean;
  maxPageSize?: number;
};

function odataEncode(value: string) {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+").replace(/'/g, "%27");
}

/** Same query string the Code App data client sends. */
function queryString(options?: QueryOptions) {
  if (!options) return "";
  const parts: string[] = [];
  if (options.select?.length) parts.push(`$select=${odataEncode(options.select.map((s) => s.trim()).join(","))}`);
  if (options.filter) parts.push(`$filter=${odataEncode(options.filter)}`);
  if (options.orderBy?.length) parts.push(`$orderby=${odataEncode(options.orderBy.map((s) => s.trim()).join(","))}`);
  if (options.top !== undefined && options.top !== null) parts.push(`$top=${options.top}`);
  if (options.skip !== undefined && options.skip !== null) parts.push(`$skip=${options.skip}`);
  if (options.expand) {
    const expand = Array.isArray(options.expand) ? options.expand.join(",") : options.expand;
    parts.push(`$expand=${expand}`);
  }
  if (options.count !== undefined && options.count !== null) parts.push(`$count=${options.count}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

function payload(record: Loose) {
  const next: Loose = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value === undefined) continue;
    next[key] = value;
  }
  return next;
}

function ok<T>(data: T) {
  return { data, success: true, wasSuccessful: true };
}

function apiHeaders(extra?: Loose) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    Prefer: 'odata.include-annotations="*"',
    ...extra,
  } as Record<string, string>;
}

function parseErrorText(status: number, statusText: string, text: string) {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    if (body?.error?.message) return new Error(body.error.message);
  } catch { /* ignore */ }
  const detail = text.trim();
  return new Error(detail ? `${status} ${statusText}: ${detail.slice(0, 300)}` : `${status} ${statusText}`);
}

function dataverseError(err: unknown) {
  const base = xrmError(err);
  if (base.message.includes(DATA_ENVIRONMENT.url)) return base;
  return new Error(`${base.message} (reading ${DATA_ENVIRONMENT.name} at ${DATA_ENVIRONMENT.url})`);
}

function idFromEntityUrl(value?: string | null) {
  if (!value) return "";
  const match = value.match(/\(([0-9a-f-]{36})\)/i);
  return match?.[1] || "";
}

function copyUpload(bytes: Uint8Array) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function callFromFetch(res: Response, buffer: ArrayBuffer): DataverseCall {
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: { get: (name) => res.headers.get(name) },
    text: new TextDecoder().decode(buffer),
    buffer,
  };
}

async function send(path: string, init?: RequestInit): Promise<DataverseCall> {
  if (transportOverride) return transportOverride(path, init);
  const url = `${clientUrl()}/api/data/v9.2/${path.replace(/^\//, "")}`;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, {
      credentials: "include",
      ...init,
      signal: ctrl.signal,
      headers: apiHeaders(init?.headers as Loose),
    });
    return callFromFetch(res, await res.arrayBuffer());
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Timed out loading ${path.split("?")[0]}`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

async function webApi<T>(path: string, init?: RequestInit): Promise<{ res: DataverseCall; json?: T }> {
  const res = await send(path, init);
  if (!res.ok) throw parseErrorText(res.status, res.statusText, res.text);
  const text = res.text.trim();
  return { res, json: text ? JSON.parse(text) as T : undefined };
}

export function getClient(_info?: unknown) {
  return {
    async retrieveMultipleRecordsAsync<T>(table: string, options?: QueryOptions) {
      const query = queryString(options);
      try {
        const { json } = await webApi<Loose[] | { value?: Loose[] }>(`${entitySet(table)}${query}`);
        const rows = Array.isArray(json) ? json : (json?.value || []);
        return ok(rows.map((row) => withFormattedNames(row) as T));
      } catch (fetchErr) {
        if (!canUseHostXrm()) throw dataverseError(fetchErr);
        const api = getXrm()?.WebApi;
        if (!api) throw dataverseError(fetchErr);
        try {
          const result = await api.retrieveMultipleRecords(logicalName(table), query, options?.maxPageSize);
          return ok((result.entities || []).map((row) => withFormattedNames(row) as T));
        } catch {
          throw dataverseError(fetchErr);
        }
      }
    },

    async retrieveRecordAsync<T>(table: string, id: string, options?: QueryOptions) {
      const query = queryString(options);
      const guid = cleanId(id);
      try {
        const { json } = await webApi<Loose>(`${entitySet(table)}(${guid})${query}`);
        return ok(withFormattedNames(json || {}) as T);
      } catch (fetchErr) {
        if (!canUseHostXrm()) throw dataverseError(fetchErr);
        const api = getXrm()?.WebApi;
        if (!api) throw dataverseError(fetchErr);
        try {
          const row = await api.retrieveRecord(logicalName(table), guid, query);
          return ok(withFormattedNames(row) as T);
        } catch {
          throw dataverseError(fetchErr);
        }
      }
    },

    async createRecordAsync<TIn extends Loose, TOut>(table: string, record: TIn) {
      try {
        const { res, json } = await webApi<Loose>(entitySet(table), {
          method: "POST",
          body: JSON.stringify(payload(record)),
        });
        const id = idFromEntityUrl(res.headers.get("OData-EntityId") || res.headers.get("odata-entityid"))
          || cleanId(String(json?.[primaryKey(table)] || ""));
        let data: Loose = { ...record, [primaryKey(table)]: id };
        if (id) {
          try {
            const loaded = await this.retrieveRecordAsync<TOut>(table, id);
            if (loaded.data) data = loaded.data as Loose;
          } catch { /* keep posted fields */ }
        }
        data[primaryKey(table)] = id;
        return { ...ok(data as TOut), id };
      } catch (fetchErr) {
        if (!canUseHostXrm()) throw dataverseError(fetchErr);
        const api = getXrm()?.WebApi;
        if (!api) throw dataverseError(fetchErr);
        const created = await api.createRecord(logicalName(table), payload(record));
        const id = cleanId(created.id);
        return { ...ok({ ...record, [primaryKey(table)]: id } as TOut), id };
      }
    },

    async updateRecordAsync<T>(table: string, id: string, changedFields: Loose) {
      const guid = cleanId(id);
      try {
        await webApi(`${entitySet(table)}(${guid})`, {
          method: "PATCH",
          headers: { "If-Match": "*" },
          body: JSON.stringify(payload(changedFields)),
        });
        try {
          return await this.retrieveRecordAsync<T>(table, guid);
        } catch {
          return ok({ ...changedFields, [primaryKey(table)]: guid } as T);
        }
      } catch (fetchErr) {
        if (!canUseHostXrm()) throw dataverseError(fetchErr);
        const api = getXrm()?.WebApi;
        if (!api) throw dataverseError(fetchErr);
        await api.updateRecord(logicalName(table), guid, payload(changedFields));
        return ok({ ...changedFields, [primaryKey(table)]: guid } as T);
      }
    },

    async deleteRecordAsync(table: string, id: string) {
      const guid = cleanId(id);
      try {
        await webApi(`${entitySet(table)}(${guid})`, { method: "DELETE" });
      } catch (fetchErr) {
        if (!canUseHostXrm()) throw dataverseError(fetchErr);
        const api = getXrm()?.WebApi;
        if (!api) throw dataverseError(fetchErr);
        await api.deleteRecord(logicalName(table), guid);
      }
    },

    async executeAsync() {
      return ok(undefined);
    },

    async uploadFileToRecord(table: string, id: string, columnName: string, fileName: string, data: Uint8Array) {
      const guid = cleanId(id);
      try {
        const res = await send(`${entitySet(table)}(${guid})/${columnName}`, {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/octet-stream",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0",
            "x-ms-file-name": fileName,
          },
          body: copyUpload(data),
        });
        if (!res.ok) throw parseErrorText(res.status, res.statusText, res.text);
        return ok(undefined);
      } catch (err) {
        throw dataverseError(err);
      }
    },

    async deleteFileOrImageFromRecord(table: string, id: string, columnName: string) {
      const guid = cleanId(id);
      await webApi(`${entitySet(table)}(${guid})/${columnName}`, { method: "DELETE" });
      return ok(undefined);
    },

    async downloadImageFromRecord(table: string, id: string, columnName: string) {
      return this.downloadFileFromRecord(table, id, columnName);
    },

    async downloadFileFromRecord(table: string, id: string, columnName: string) {
      const guid = cleanId(id);
      try {
        const res = await send(`${entitySet(table)}(${guid})/${columnName}/$value`, {
          headers: {
            Accept: "application/octet-stream",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0",
          },
        });
        if (res.ok && res.buffer.byteLength) return ok(new Uint8Array(res.buffer));
      } catch {
        /* File columns use /$value; attachment body falls back to the field. */
      }
      const loaded = await this.retrieveRecordAsync<Loose>(table, id, { select: [columnName] });
      return ok(loaded.data?.[columnName]);
    },
  };
}

export function deserializeMultiSelectPicklistFields<T>(value: T): T {
  return value;
}

export function serializeMultiSelectPicklistFields<T>(value: T): T {
  return value;
}

export type IOperationResult<T> = { data?: T; error?: unknown; success?: boolean; wasSuccessful?: boolean };
export type GetEntityMetadataOptions<T = Loose> = T;
export type EntityMetadata = Loose;
