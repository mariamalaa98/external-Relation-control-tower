import { formatDateTime } from "./communicationLogic";
import { FLOWS } from "./flows";
import type { ArchiveDoc, ArchiveType, AuditAction, AuditChannel, AuditRow, Category, CommStatus, Communication, DepartmentRef, DocRisk, DocType, License, LicenseRenewalStatus, Notice, NoticeResult, NoticeType, Party, Priority, Renewal, RenewalStatus, SlaRule, SlaState } from "./types";
import { applyLicenseFormulas, DEFAULT_REMINDER_THRESHOLD } from "./licenseLogic";
import type { Erc_notifications } from "../generated/models/Erc_notificationsModel";
import {
  Erc_notificationserc_notificationtype,
  Erc_notificationserc_result,
} from "../generated/models/Erc_notificationsModel";
import {
  Erc_communicationserc_categoryf,
  Erc_communicationserc_lifecyclestatus,
  Erc_communicationserc_priorityf,
  type Erc_communications,
} from "../generated/models/Erc_communicationsModel";
import type { Erc_externalparties } from "../generated/models/Erc_externalpartiesModel";
import { Erc_externalpartiescr18c_extrnalparty_status } from "../generated/models/Erc_externalpartiesModel";
import {
  Erc_licenseandcontractserc_documenttype,
  Erc_licenseandcontractserc_renewalstatus,
  Erc_licenseandcontractserc_risklevel,
  type Erc_licenseandcontracts,
} from "../generated/models/Erc_licenseandcontractsModel";
import type { Erc_sla2s } from "../generated/models/Erc_sla2sModel";
import {
  Erc_renewalserc_escalationstatus,
  Erc_renewalserc_renewalstatus,
  Erc_renewalserc_renewaltype,
  Erc_renewalserc_risklevel,
  type Erc_renewals,
} from "../generated/models/Erc_renewalsModel";

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function nowStamp() {
  return `${todayIso()} ${new Date().toTimeString().slice(0, 5)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localYmd(d: Date) {
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Normalize Dataverse / browser dates to YYYY-MM-DD without dropping valid expiry values. */
export function dateOnly(value?: unknown) {
  if (value == null || value === "") return "";
  if (value instanceof Date) return localYmd(value);
  if (typeof value === "number" && Number.isFinite(value)) return localYmd(new Date(value));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return dateOnly(obj.value ?? obj.date ?? obj.Date ?? obj.expiry ?? "");
  }
  const raw = String(value).trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotNet = raw.match(/\/Date\((-?\d+)/);
  if (dotNet) return localYmd(new Date(Number(dotNet[1])));
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dmy) {
    const a = Number(dmy[1]);
    const b = Number(dmy[2]);
    const y = dmy[3];
    const day = a > 12 ? a : b > 12 ? b : a;
    const month = a > 12 ? b : b > 12 ? a : b;
    return `${y}-${pad2(month)}-${pad2(day)}`;
  }
  return localYmd(new Date(raw));
}

export function isoDateTime(date?: string) {
  if (!date) return undefined;
  if (date.includes("T")) return date;
  return `${date}T00:00:00Z`;
}

export function daysBetween(from: string, to: string) {
  const a = new Date(dateOnly(from) + "T00:00:00");
  const b = new Date(dateOnly(to) + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function addDays(date: string, n: number) {
  const x = new Date(dateOnly(date) + "T00:00:00");
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}

export function senderDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : email.toLowerCase().trim();
}

function cleanLabel(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function asCategory(value?: string): Category {
  const v = cleanLabel(value).replace(/^partner$/i, "Partner");
  if (v === "Government" || v === "Insurance" || v === "Regulatory" || v === "Legal" || v === "Corporate" || v === "Partner") return v;
  return "Corporate";
}

export function asCategoryOptional(value?: string): Category | undefined {
  const v = cleanLabel(value);
  if (v === "Government" || v === "Insurance" || v === "Regulatory" || v === "Legal" || v === "Corporate" || v === "Partner") return v;
  return undefined;
}

export function asPriority(value?: string): Priority {
  const v = cleanLabel(value);
  if (!v || v === "None" || v === "None.") return "None";
  if (v === "Critical" || v === "High" || v === "Medium" || v === "Low") return v;
  if (v === "Urgent" || v === "Normal") return v === "Urgent" ? "High" : "Medium";
  return "None";
}

export function asStatus(value?: string): CommStatus {
  const v = cleanLabel(value);
  if (v === "Closed") return "Closed";
  return "In Progress";
}

export function categoryChoice(cat: Category): 1 | 2 | 3 | 4 | 5 | 6 {
  const map: Record<Category, 1 | 2 | 3 | 4 | 5 | 6> = {
    Government: 1,
    Insurance: 2,
    Regulatory: 3,
    Legal: 4,
    Corporate: 5,
    Partner: 6,
  };
  return map[cat];
}

export function priorityChoice(pri: Priority): 1 | 2 | 3 | 4 {
  if (pri === "None") return 4;
  const map: Record<Exclude<Priority, "None">, 1 | 2 | 3 | 4> = { Critical: 1, High: 2, Medium: 3, Low: 4 };
  return map[pri];
}

export function lifecycleChoice(status: CommStatus): 2 | 4 {
  return status === "Closed" ? 4 : 2;
}

export function slaStatusChoice(state: SlaState): 1 | 2 | 3 {
  if (state === "At Risk") return 2;
  if (state === "Breached") return 3;
  return 1;
}

export function commTypeInbound() {
  return 789180000 as const;
}

export function displayCommId(recordId: string, createdOn?: string) {
  const short = recordId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const year = (createdOn || todayIso()).slice(0, 4);
  return `COM-${year}-${short}`;
}

export function displayDocId(recordId: string, createdOn?: string) {
  const short = recordId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const year = (createdOn || todayIso()).slice(0, 4);
  return `DOC-${year}-${short}`;
}

export function slaState(row: Communication, today = todayIso()): SlaState {
  if (row.status === "Closed") return row.isOverdue ? "Breached" : "Within";
  if (row.isOverdue) return "Breached";
  if (row.due) {
    const due = new Date(row.due);
    if (!Number.isNaN(due.getTime())) {
      const minutesLeft = (due.getTime() - Date.now()) / 60000;
      if (minutesLeft <= 30) return "At Risk";
    }
  }
  void today;
  return "Within";
}

export function docState(row: License, today = todayIso()) {
  if (row.status === "Renewed" || row.done) return "Renewed";
  const left = row.daysRemaining ?? daysBetween(today, row.expiry);
  if (left < 0 || row.status === "Expired" || row.isOverdue) return "Expired";
  if (left <= 90) return "Expiring";
  return "Active";
}

export function needsEvidence(cat: Category) {
  return cat === "Government" || cat === "Legal" || cat === "Regulatory";
}

function asGuid(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value
    .trim()
    .replace(/[{}]/g, "")
    .replace(/^\/\w+\(/i, "")
    .replace(/\)$/, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : undefined;
}

function lookupRef(row: object, logical: string, formattedName?: string): { id?: string; name: string } {
  const rec = row as Record<string, unknown>;
  const nested = rec[logical];
  let id = asGuid(rec[`_${logical}_value`]);
  let name = "";

  if (nested && typeof nested === "object" && nested !== null) {
    const obj = nested as Record<string, unknown>;
    const nestedName = obj.fullname ?? obj.FullName ?? obj.name ?? obj.Name
      ?? obj.cr603_department ?? obj.cr603_departmentname
      ?? obj.owneridname ?? obj.businessunitidname ?? obj.erc_partyname ?? obj.erc_externalpartyname;
    if (typeof nestedName === "string" && nestedName.trim()) name = nestedName.trim();
    id = id
      || asGuid(obj.businessunitid)
      || asGuid(obj.systemuserid)
      || asGuid(obj.teamid)
      || asGuid(obj.ownerid)
      || asGuid(obj.cr603_chklst_departmentsid)
      || asGuid(obj.id)
      || asGuid(obj[`${logical}id`]);
  } else {
    id = id || asGuid(nested);
    if (!id && typeof nested === "string" && nested.trim() && !asGuid(nested)) name = nested.trim();
  }

  if (!name) {
    const formattedKeys = [
      `_${logical}_value@OData.Community.Display.V1.FormattedValue`,
      `${logical}@OData.Community.Display.V1.FormattedValue`,
      `_${logical}_value@odata.community.display.v1.formattedvalue`,
    ];
    for (const key of formattedKeys) {
      const val = rec[key];
      if (typeof val === "string" && val.trim()) {
        name = val.trim();
        break;
      }
    }
  }
  if (!name) {
    const needle = `_${logical}_value`.toLowerCase();
    for (const [key, val] of Object.entries(rec)) {
      if (
        key.toLowerCase().includes(needle)
        && key.toLowerCase().includes("formattedvalue")
        && typeof val === "string"
        && val.trim()
      ) {
        name = val.trim();
        break;
      }
    }
  }
  if (!name && formattedName?.trim() && !asGuid(formattedName)) name = formattedName.trim();
  return { id, name };
}

function lookupDisplay(row: object, logical: string, formattedName?: string) {
  return lookupRef(row, logical, formattedName).name;
}

function asDisplayName(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    return text && !asGuid(text) ? text : "";
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return asDisplayName(obj.fullname ?? obj.FullName ?? obj.name ?? obj.Name ?? obj.owneridname);
  }
  return "";
}

function formattedOwnerName(row: object) {
  const rec = row as Record<string, unknown>;
  for (const [key, val] of Object.entries(rec)) {
    const k = key.toLowerCase();
    if (
      (k.includes("ownerid") || k.includes("owninguser") || k.includes("owningteam"))
      && k.includes("formattedvalue")
    ) {
      const name = asDisplayName(val);
      if (name) return name;
    }
  }
  return "";
}

/** Dataverse Owner is OwnerType: name often arrives as formatted OData, nested user, or GUID-only. */
export function recordOwner(row: object, formattedName?: string): { id?: string; name: string } {
  const rec = row as Record<string, unknown>;
  const owner = lookupRef(row, "ownerid", formattedName);
  const user = lookupRef(row, "owninguser");
  const team = lookupRef(row, "owningteam");
  const name = owner.name
    || user.name
    || team.name
    || asDisplayName(rec.owneridname)
    || asDisplayName(rec.owningusername)
    || asDisplayName(rec.owningteamname)
    || formattedOwnerName(row)
    || asDisplayName(rec.ownerid);
  const id = owner.id
    || user.id
    || team.id
    || asGuid(rec.ownerid)
    || asGuid(rec._owninguser_value)
    || asGuid(rec._owningteam_value);
  return { id, name };
}

export { lookupDisplay };

export function asPartyStatus(row: Erc_externalparties): Party["status"] {
  const fromChoice = Erc_externalpartiescr18c_extrnalparty_status[row.cr18c_extrnalparty_status as 1 | 2 | 3];
  const label = cleanLabel(row.cr18c_extrnalparty_statusname || fromChoice).replace(/^inactive$/i, "Inactive");
  if (label === "Draft") return "Draft";
  if (label === "InActive" || label === "Inactive") return "Inactive";
  if (label === "Active") return "Active";
  return row.statecode === 1 ? "Inactive" : "Active";
}

export function partyStatusChoice(status: Party["status"]): 1 | 2 | 3 {
  if (status === "Draft") return 1;
  if (status === "Inactive") return 3;
  return 2;
}

export function mapParty(row: Erc_externalparties): Party {
  const crit = cleanLabel(row.erc_defaultpriorityname || row.erc_priorityname);
  const unit = lookupRef(row, "erc_businessunit", row.erc_businessunitname);
  const dept = lookupRef(row, "erc_department", row.erc_departmentname);
  return {
    id: row.erc_externalpartyid,
    name: row.erc_partyname || "Unnamed party",
    category: asCategory(row.erc_categoryname),
    email: row.erc_officialemail || "",
    domain: (row.erc_domain || senderDomain(row.erc_officialemail || "")).toLowerCase(),
    bu: unit.name,
    buId: unit.id,
    department: dept.name,
    departmentId: dept.id,
    owner: lookupDisplay(row, "erc_defaultowner", row.erc_defaultownername) || recordOwner(row, row.owneridname).name,
    criticality: crit === "Low" || crit === "Medium" ? crit : "High",
    status: asPartyStatus(row),
  };
}

export function mapDepartment(row: {
  cr603_chklst_departmentsid?: string;
  cr603_department?: string;
  cr603_id?: string;
  cr18c_departmentid?: string;
  statecode?: number | string;
  cr603_companyname?: string;
}): DepartmentRef | undefined {
  const id = asGuid(row.cr603_chklst_departmentsid);
  const name = cleanLabel(row.cr603_department || row.cr603_id || row.cr18c_departmentid);
  if (!id || !name) return undefined;
  const state = row.statecode;
  if (state === 1 || state === "1") return undefined;
  const company = lookupRef(row, "cr603_company", row.cr603_companyname);
  return { id, name, companyId: company.id, companyName: company.name };
}

export function mapSla(row: Erc_sla2s): SlaRule {
  const unit = cleanLabel(row.erc_durationunitname || row.erc_daybasisname);
  const hours = Number(row.erc_acknowledgementhours);
  return {
    id: row.erc_sla2id,
    name: row.erc_name || `${cleanLabel(row.erc_categoryname)} ${cleanLabel(row.erc_priorityname)}`,
    category: asCategory(row.erc_categoryname),
    priority: asPriority(row.erc_priorityname),
    ackHours: Number.isFinite(hours) ? hours : 24,
    resolveDays: unit === "Hours" ? Math.max(1, Math.round((row.erc_sladuration || 24) / 24)) : row.erc_sladuration || 10,
    basis: unit === "Calendar Days" ? "Calendar days" : unit === "Hours" ? "Hours" : "Working days",
    active: row.erc_active !== false && row.statecode !== 1,
  };
}

function asFlag(value: unknown) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null || value === "") return false;
  const label = cleanLabel(String(value)).toLowerCase();
  return label === "true" || label === "yes" || label === "escalated" || label === "overdue" || label === "1";
}

/** Dataverse Status Reason: Active = 1, Inactive = 2 */
export const COMM_ACTIVE_STATUSCODE_FILTER = "statuscode eq 1";

export function isActiveCommunicationRow(row: {
  statuscode?: unknown;
  statuscodename?: string;
  statecode?: unknown;
  statecodename?: string;
}) {
  const status = row.statuscode;
  const statusName = cleanLabel(String(row.statuscodename || "")).toLowerCase();
  if (status === 2 || status === "2" || statusName === "inactive") return false;
  if (status === 1 || status === "1" || statusName === "active") return true;
  const state = row.statecode;
  const stateName = cleanLabel(String(row.statecodename || "")).toLowerCase();
  if (state === 1 || state === "1" || stateName === "inactive") return false;
  return true;
}

export function mapComm(row: Erc_communications): Communication {
  const status = asStatus(row.erc_lifecyclestatusname || Erc_communicationserc_lifecyclestatus[row.erc_lifecyclestatus as 1]);
  const createdOn = row.createdon || row.erc_receiveddate || todayIso();
  const recDate = dateOnly(row.erc_receiveddate || row.createdon);
  const due = row.erc_duedate || "";
  const manual = asFlag(row.erc_ismanuallyescalated) || asFlag(row.erc_ismanuallyescalatedname);
  const locked = asFlag(row.erc_isescalated) || asFlag(row.erc_isescalatedname) || asFlag(row.erc_isescalatedf) || manual;
  const partyRef = lookupRef(row, "erc_externalparty", row.erc_externalpartyname);
  const dept = lookupRef(row, "erc_department", row.erc_departmentname);
  const log: Communication["log"] = [
    { title: FLOWS.createCommunication.name, meta: `${formatDateTime(createdOn)} — native Emails table` },
  ];
  if (partyRef.name) log.push({ title: "Sender matched to External Party Master", meta: partyRef.name });
  if (row.erc_slarulename) log.push({ title: "SLA rule applied", meta: `${row.erc_slarulename} · due ${formatDateTime(due)}` });
  if (row.erc_responsesummary) log.push({ title: "Response recorded", meta: row.erc_responsesummary });
  if (row.erc_closurecomment) log.push({ title: "Closure comment captured by flow", meta: row.erc_closurecomment });
  const formulaCat = asCategoryOptional(row.erc_categoryfname || (row.erc_categoryf != null ? Erc_communicationserc_categoryf[row.erc_categoryf] : undefined));
  const formulaPri = asPriority(row.erc_priorityfname || (row.erc_priorityf != null ? Erc_communicationserc_priorityf[row.erc_priorityf] : undefined));
  const owner = recordOwner(row, row.owneridname);
  const mapped: Communication = {
    id: row.erc_id || displayCommId(row.erc_communicationid, row.createdon),
    recordId: row.erc_communicationid,
    party: partyRef.name,
    partyId: partyRef.id,
    slaId: row._erc_slarule_value,
    slaName: row.erc_slarulename,
    cat: formulaCat || "Corporate",
    categoryAssigned: !!formulaCat,
    subj: row.erc_emailsubject || row.erc_subject || "(no subject)",
    owner: owner.name,
    ownerId: owner.id,
    sup: row.erc_supervisorname || "",
    pri: formulaPri,
    rec: recDate,
    due,
    status,
    bu: (row.erc_buf || "").trim(),
    department: dept.name,
    departmentId: dept.id,
    resp: row.erc_responsesummary,
    respAction: row.erc_responsesummary,
    closed: row.erc_closuredatetime || (status === "Closed" ? row.modifiedon : undefined),
    closedBy: row.erc_closedbyname,
    closureComment: row.erc_closurecomment,
    caseRef: row.erc_caserefrence || undefined,
    ev: 0,
    type: (cleanLabel(row.erc_communicationtypename) as Communication["type"]) || "Inbound",
    log,
    createdOn,
    description: row.erc_description,
    emailSubject: row.erc_emailsubject || row.erc_subject,
    isAutomaticallyEscalated: locked && !manual,
    isManuallyEscalated: manual,
    isEscalated: locked,
    isOverdue: asFlag(row.erc_isoverdue),
    overdueFromColumn: true,
    escalatedBy: row.erc_escalatedbyname,
    escalationReason: row.erc_escalationreason,
  };
  return mapped;
}

function asLicenseRenewal(value?: string): LicenseRenewalStatus {
  return value === "In Progress" || value === "Submitted" || value === "Renewed" || value === "Expired"
    ? value
    : "Not Started";
}

export function mapDoc(row: Erc_licenseandcontracts): License {
  const typeLabel = cleanLabel(row.erc_documenttypename || Erc_licenseandcontractserc_documenttype[row.erc_documenttype]);
  const riskLabel = cleanLabel(row.erc_risklevelname || Erc_licenseandcontractserc_risklevel[row.erc_risklevel]);
  const renewal = asLicenseRenewal(cleanLabel(row.erc_renewalstatusname || Erc_licenseandcontractserc_renewalstatus[row.erc_renewalstatus]));
  const unit = lookupRef(row, "erc_businessunit", row.erc_businessunitname);
  const partyRef = lookupRef(row, "erc_externalparty", row.erc_externalpartyname);
  const authRef = lookupRef(row, "erc_issuingauthority", row.erc_issuingauthorityname);
  const dept = lookupRef(row, "erc_department", row.erc_departmentname);
  const owner = recordOwner(row, row.owneridname);
  const days = row.erc_daystoexpiry ?? row.erc_daysremaining;
  const documentNumber = row.erc_documentnumber || displayDocId(row.erc_licenseandcontractid, row.createdon);
  const rec = row as unknown as Record<string, unknown>;
  const expiryRaw = row.erc_expirydate || rec["erc_expirydate@OData.Community.Display.V1.FormattedValue"];
  const issueRaw = row.erc_issuedate || rec["erc_issuedate@OData.Community.Display.V1.FormattedValue"];
  return applyLicenseFormulas({
    id: documentNumber,
    recordId: row.erc_licenseandcontractid,
    type: typeLabel === "Contract" || typeLabel === "Permit" ? typeLabel : "License",
    name: row.erc_licenseandcontract1 || "Untitled document",
    documentNumber,
    party: partyRef.name,
    partyId: partyRef.id,
    auth: authRef.name,
    issuingAuthorityId: authRef.id,
    issue: dateOnly(issueRaw),
    expiry: dateOnly(expiryRaw),
    risk: (riskLabel === "Critical" || riskLabel === "High" || riskLabel === "Medium" || riskLabel === "Low" ? riskLabel : "Medium") as DocRisk,
    owner: owner.name,
    ownerId: owner.id,
    bu: unit.name,
    buId: unit.id,
    department: dept.name,
    departmentId: dept.id,
    active: row.erc_active !== false,
    status: renewal === "Renewed" ? "Renewed" : renewal === "Expired" ? "Expired" : undefined,
    renewalStatus: renewal,
    renewalNotes: row.erc_renewalnotes,
    renewalSlaDate: row.erc_renewalsladate,
    documentUrl: row.erc_documenturl,
    currentDocumentName: row.erc_currentdocument_name,
    notified: row.erc_lastnotified,
    done: dateOnly(row.erc_renewalcompleted),
    daysRemaining: typeof days === "number" ? Math.round(days) : undefined,
    reminderThreshold: row.erc_reminderthreshold || DEFAULT_REMINDER_THRESHOLD,
    reminderSent: asFlag(row.erc_remindersent) || asFlag(row.erc_remindersentname),
    isEscalated: asFlag(row.erc_isescalated) || asFlag(row.erc_isescalatedname),
    escalatedBy: row.erc_escalatedbyname,
    escalationReason: row.erc_escalationreason,
    currentRenewalId: row._erc_currentrenewal_value,
    currentRenewalName: row.erc_currentrenewalname,
  });
}

export function docTypeChoice(type: DocType) {
  return type === "License" ? 789180000 : type === "Contract" ? 789180001 : 789180002;
}

export function riskChoice(risk: DocRisk) {
  return risk === "Low" ? 789180000 : risk === "Medium" ? 789180001 : risk === "High" ? 789180002 : 789180003;
}

export function defaultPriorityChoice(crit: "High" | "Medium" | "Low"): 789180000 | 789180001 | 789180002 {
  return crit === "Low" ? 789180000 : crit === "Medium" ? 789180001 : 789180002;
}

export function renewalChoice(status: LicenseRenewalStatus) {
  const map = {
    "Not Started": 789180000,
    "In Progress": 789180001,
    Submitted: 789180002,
    Renewed: 789180003,
    Expired: 789180004,
  } as const;
  return map[status];
}

export function mapRenewal(row: Erc_renewals): Renewal {
  const typeLabel = cleanLabel(row.erc_renewaltypename || Erc_renewalserc_renewaltype[row.erc_renewaltype as 1]);
  const statusLabel = cleanLabel(row.erc_renewalstatusname || Erc_renewalserc_renewalstatus[row.erc_renewalstatus as 1]);
  const riskLabel = cleanLabel(row.erc_risklevelname || Erc_renewalserc_risklevel[row.erc_risklevel as 1]);
  const esc = cleanLabel(row.erc_escalationstatusname || Erc_renewalserc_escalationstatus[row.erc_escalationstatus as 1]);
  const status: RenewalStatus =
    statusLabel === "In progress" || statusLabel === "Completed" || statusLabel === "Overdue" || statusLabel === "Cancelled"
      ? statusLabel
      : "Open";
  return {
    id: displayDocId(row.erc_renewalid, row.createdon).replace("DOC", "REN"),
    recordId: row.erc_renewalid,
    documentId: row._erc_licenseandcontract_value,
    documentName: row.erc_licenseandcontractname,
    type: typeLabel === "Contract" || typeLabel === "Permit" ? typeLabel : "License",
    status,
    due: row.erc_duedate,
    completed: row.erc_completiondate,
    risk: (riskLabel === "Critical" || riskLabel === "High" || riskLabel === "Medium" || riskLabel === "Low" ? riskLabel : "Medium") as DocRisk,
    owner: row.erc_ownername || row.owneridname || "",
    notes: row.erc_renewalnotes,
    reminderDate: row.erc_reminderdate,
    reminderCount: row.erc_remindercount,
    escalation: esc === "L1" || esc === "L2" ? esc : "Not Escalated",
    ownerId: row._erc_owner_value,
  };
}

export function renewalTypeChoice(type: DocType) {
  return type === "License" ? 1 : type === "Contract" ? 2 : 3;
}

export function renewalTaskStatusChoice(status: RenewalStatus) {
  const map: Record<RenewalStatus, 1 | 2 | 3 | 4 | 5> = {
    Open: 1,
    "In progress": 2,
    Completed: 3,
    Overdue: 4,
    Cancelled: 5,
  };
  return map[status];
}

export function renewalRiskChoice(risk: DocRisk) {
  return risk === "Low" ? 1 : risk === "Medium" ? 2 : risk === "High" ? 3 : 4;
}

export function escalationChoice(status: Renewal["escalation"]) {
  return status === "L1" ? 2 : status === "L2" ? 3 : 1;
}

export function noticeTypeChoice(type: NoticeType) {
  return type === "Reminder" ? 1 : type === "Expiry" ? 2 : 3;
}

export function noticeResultChoice(result: NoticeResult) {
  return result === "Failed" ? 2 : 1;
}

export function mapNotice(row: Erc_notifications): Notice {
  const typeLabel = cleanLabel(row.erc_notificationtypename || (row.erc_notificationtype != null ? Erc_notificationserc_notificationtype[row.erc_notificationtype] : undefined));
  const resultLabel = cleanLabel(row.erc_resultname || (row.erc_result != null ? Erc_notificationserc_result[row.erc_result] : undefined));
  const type: NoticeType = typeLabel === "Expiry" || typeLabel === "Escalation" ? typeLabel : "Reminder";
  return {
    id: displayDocId(row.erc_notificationid, row.createdon).replace("DOC", "NTF"),
    recordId: row.erc_notificationid,
    title: row.erc_notificationtitle || "Notification",
    type,
    documentId: row._erc_licenseandcontract_value,
    documentName: row.erc_licenseandcontractname,
    renewalId: row._erc_renewal_value,
    renewalName: row.erc_renewalname,
    sentOn: row.erc_senton || row.createdon,
    result: resultLabel.toLowerCase().startsWith("fail") ? "Failed" : "Sent",
    message: row.erc_notificationmessage || row.erc_message,
    isRead: asFlag(row.erc_isread) || asFlag(row.erc_isreadname),
    owner: row.owneridname || "",
  };
}

export function fallbackSlaDays(pri: Priority) {
  return { Critical: 2, High: 5, Medium: 10, Low: 14, None: 10 }[pri];
}

export function archiveTypeChoice(type: ArchiveType) {
  return type === "License document" ? 2 : type === "Other" ? 3 : 1;
}

export function asArchiveType(value?: string, raw?: number | string): ArchiveType {
  const num = Number(raw);
  if (num === 2) return "License document";
  if (num === 3) return "Other";
  if (num === 1) return "Communication evidence";
  const label = cleanLabel(value).toLowerCase();
  if (label.includes("license")) return "License document";
  if (label.includes("other")) return "Other";
  return "Communication evidence";
}

export function mapArchive(row: import("../generated/models/Erc_documentarchivesModel").Erc_documentarchives): ArchiveDoc {
  return {
    id: row.erc_documentarchiveid,
    recordId: row.erc_documentarchiveid,
    name: row.erc_name || row.erc_file_name || "Untitled file",
    type: asArchiveType(row.erc_documenttypesname, row.erc_documenttypes),
    notes: row.erc_notes,
    fileName: row.erc_file_name,
    communicationId: row._erc_relatedcommunication_value,
    communicationName: row.erc_relatedcommunicationname,
    licenseId: row._erc_relatedlicense_value,
    licenseName: row.erc_relatedlicensename,
    uploadedBy: row.erc_uploadedbyname || row.owneridname,
    uploadedOn: row.erc_uploadedon || row.createdon,
  };
}

export function auditActionChoice(action: AuditAction | string) {
  const blob = action.toLowerCase();
  if (blob.includes("creat")) return 1;
  if (blob.includes("rout") || blob.includes("attach")) return 2;
  if (blob.includes("categor")) return 3;
  if (blob.includes("respond") || blob.includes("response") || blob.includes("reply")) return 4;
  if (blob.includes("escal")) return 5;
  if (blob.includes("clos")) return 6;
  if (blob.includes("reopen")) return 7;
  if (blob.includes("evidence")) return 8;
  return 4;
}

export function auditChannelChoice(channel: AuditChannel | string) {
  const blob = channel.toLowerCase();
  if (blob.includes("email")) return 1;
  if (blob.includes("letter") || blob.includes("official")) return 2;
  if (blob.includes("portal")) return 3;
  return 4;
}

export function asAuditAction(value?: string, raw?: number | string): AuditAction {
  const byNum: Record<number, AuditAction> = {
    1: "Created",
    2: "Routed",
    3: "Category set",
    4: "Responded",
    5: "Escalated",
    6: "Closed",
    7: "Reopened",
    8: "Evidence added",
  };
  const mapped = byNum[Number(raw)];
  if (mapped) return mapped;
  const label = cleanLabel(value).toLowerCase();
  if (label.includes("rout")) return "Routed";
  if (label.includes("categor")) return "Category set";
  if (label.includes("respond")) return "Responded";
  if (label.includes("escal")) return "Escalated";
  if (label.includes("clos")) return "Closed";
  if (label.includes("reopen")) return "Reopened";
  if (label.includes("evidence")) return "Evidence added";
  return "Created";
}

export function asAuditChannel(value?: string, raw?: number | string): AuditChannel {
  const byNum: Record<number, AuditChannel> = {
    1: "Email",
    2: "Official letter",
    3: "Portal",
    4: "System",
  };
  const mapped = byNum[Number(raw)];
  if (mapped) return mapped;
  const label = cleanLabel(value).toLowerCase();
  if (label.includes("email")) return "Email";
  if (label.includes("letter") || label.includes("official")) return "Official letter";
  if (label.includes("portal")) return "Portal";
  return "System";
}

export function mapAudit(row: import("../generated/models/Erc_communicationauditsModel").Erc_communicationaudits): AuditRow {
  return {
    id: row.erc_communicationauditid,
    recordId: row.erc_communicationauditid,
    name: row.erc_name || row.erc_actionname || "Audit",
    action: asAuditAction(row.erc_actionname, row.erc_action),
    channel: asAuditChannel(row.erc_channelname, row.erc_channel),
    communicationId: row._erc_communication_value,
    communicationName: row.erc_communicationname,
    details: row.erc_details,
    oldValue: row.erc_oldvalue,
    newValue: row.erc_newvalue,
    performedBy: row.erc_performedbyname || row.owneridname,
    performedOn: row.erc_performedon || row.createdon,
  };
}
