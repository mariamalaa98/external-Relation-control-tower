/** Dataverse client for the HTML web resource. Uses OData entity-set names (same as the Code App). */

type Loose = Record<string, unknown>;

export const PULSE_WR_BUILD = "WR-15-shared";

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

function clientUrl() {
  for (const xrm of windowsWithXrm()) {
    try {
      const url = xrm.Utility?.getGlobalContext?.()?.getClientUrl?.();
      if (url) return url.replace(/\/$/, "");
    } catch { /* ignore */ }
  }
  return window.location.origin.replace(/\/$/, "");
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

const EMAIL_LIST_SELECT = [
  "activityid",
  "subject",
  "sender",
  "torecipients",
  "createdon",
  "senton",
  "actualend",
  "directioncode",
  "conversationindex",
  "attachmentcount",
  "_regardingobjectid_value",
  "_parentactivityid_value",
];

const EMAIL_THREAD_SELECT = [
  ...EMAIL_LIST_SELECT,
  "description",
  "safedescription",
];

function slimOptions(table: string, options?: QueryOptions): QueryOptions {
  const set = entitySet(table);
  const next: QueryOptions = { ...(options || {}) };
  if (set === "emails" && !next.select?.length && !next.expand) {
    next.select = next.filter ? EMAIL_THREAD_SELECT : EMAIL_LIST_SELECT;
    if (!next.filter && (!next.top || next.top > 80)) next.top = 80;
  }
  if (set === "activityparties" && (!next.top || next.top > 200)) next.top = 200;
  return next;
}

function queryString(options?: QueryOptions) {
  if (!options) return "";
  const parts: string[] = [];
  if (options.select?.length) parts.push(`$select=${options.select.join(",")}`);
  if (options.filter) parts.push(`$filter=${encodeURIComponent(options.filter)}`);
  if (options.orderBy?.length) parts.push(`$orderby=${encodeURIComponent(options.orderBy.join(","))}`);
  if (options.top) parts.push(`$top=${options.top}`);
  if (options.skip) parts.push(`$skip=${options.skip}`);
  if (options.expand) {
    const expand = Array.isArray(options.expand) ? options.expand.join(",") : options.expand;
    parts.push(`$expand=${expand}`);
  }
  if (options.count) parts.push("$count=true");
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

async function parseError(res: Response) {
  try {
    const body = await res.json() as { error?: { message?: string } };
    if (body?.error?.message) return new Error(body.error.message);
  } catch { /* ignore */ }
  return new Error(`${res.status} ${res.statusText}`);
}

function idFromEntityUrl(value?: string | null) {
  if (!value) return "";
  const match = value.match(/\(([0-9a-f-]{36})\)/i);
  return match?.[1] || "";
}

async function webApi<T>(path: string, init?: RequestInit): Promise<{ res: Response; json?: T }> {
  const url = `${clientUrl()}/api/data/v9.2/${path.replace(/^\//, "")}`;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      credentials: "include",
      ...init,
      signal: ctrl.signal,
      headers: apiHeaders(init?.headers as Loose),
    });
    if (!res.ok) throw await parseError(res);
    const text = await res.text();
    return { res, json: text ? JSON.parse(text) as T : undefined };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Timed out loading ${path.split("?")[0]}`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getClient(_info?: unknown) {
  return {
    async retrieveMultipleRecordsAsync<T>(table: string, options?: QueryOptions) {
      const slim = slimOptions(table, options);
      const tryQuery = async (query: string) => {
        const { json } = await webApi<{ value?: Loose[] }>(`${entitySet(table)}${query}`);
        return ok((json?.value || []).map((row) => withFormattedNames(row) as T));
      };
      try {
        return await tryQuery(queryString(slim));
      } catch (fetchErr) {
        if (slim.select?.length) {
          try {
            const { select: _ignored, ...rest } = slim;
            return await tryQuery(queryString(rest));
          } catch { /* fall through */ }
        }
        const api = getXrm()?.WebApi;
        if (!api) throw xrmError(fetchErr);
        try {
          const result = await api.retrieveMultipleRecords(logicalName(table), queryString(options), options?.maxPageSize);
          return ok((result.entities || []).map((row) => withFormattedNames(row) as T));
        } catch {
          throw xrmError(fetchErr);
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
        const api = getXrm()?.WebApi;
        if (!api) throw xrmError(fetchErr);
        try {
          const row = await api.retrieveRecord(logicalName(table), guid, query);
          return ok(withFormattedNames(row) as T);
        } catch {
          throw xrmError(fetchErr);
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
        const api = getXrm()?.WebApi;
        if (!api) throw xrmError(fetchErr);
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
        const api = getXrm()?.WebApi;
        if (!api) throw xrmError(fetchErr);
        await api.updateRecord(logicalName(table), guid, payload(changedFields));
        return ok({ ...changedFields, [primaryKey(table)]: guid } as T);
      }
    },

    async deleteRecordAsync(table: string, id: string) {
      const guid = cleanId(id);
      try {
        await webApi(`${entitySet(table)}(${guid})`, { method: "DELETE" });
      } catch (fetchErr) {
        const api = getXrm()?.WebApi;
        if (!api) throw xrmError(fetchErr);
        await api.deleteRecord(logicalName(table), guid);
      }
    },

    async executeAsync() {
      return ok(undefined);
    },

    async uploadFileToRecord(table: string, id: string, columnName: string, fileName: string, data: Uint8Array) {
      const guid = cleanId(id);
      const url = `${clientUrl()}/api/data/v9.2/${entitySet(table)}(${guid})/${columnName}`;
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 60000);
      try {
        const res = await fetch(url, {
          method: "PATCH",
          credentials: "include",
          signal: ctrl.signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/octet-stream",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0",
            "x-ms-file-name": fileName,
          },
          body: data,
        });
        if (!res.ok) throw await parseError(res);
        return ok(undefined);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error("Timed out uploading the file");
        }
        throw xrmError(err);
      } finally {
        window.clearTimeout(timer);
      }
    },

    async downloadFileFromRecord(table: string, id: string, columnName: string) {
      const guid = cleanId(id);
      const url = `${clientUrl()}/api/data/v9.2/${entitySet(table)}(${guid})/${columnName}/$value`;
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 60000);
      try {
        const res = await fetch(url, {
          credentials: "include",
          signal: ctrl.signal,
          headers: {
            Accept: "application/octet-stream",
            "OData-MaxVersion": "4.0",
            "OData-Version": "4.0",
          },
        });
        if (res.ok) {
          return ok(new Uint8Array(await res.arrayBuffer()));
        }
      } catch {
        /* File columns use /$value; attachment body falls back to the field. */
      } finally {
        window.clearTimeout(timer);
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
