import { formatDateTime } from "./communicationLogic";
import { FLOWS } from "./flows";
import type { Category, CommStatus, Communication, DocRisk, DocType, License, Notice, NoticeResult, NoticeType, Party, Priority, Renewal, RenewalStatus, SlaRule, SlaState } from "./types";
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

export function dateOnly(value?: string) {
  if (!value) return "";
  return value.slice(0, 10);
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
      ?? obj.owneridname ?? obj.businessunitidname ?? obj.erc_partyname ?? obj.erc_externalpartyname;
    if (typeof nestedName === "string" && nestedName.trim()) name = nestedName.trim();
    id = id
      || asGuid(obj.businessunitid)
      || asGuid(obj.systemuserid)
      || asGuid(obj.teamid)
      || asGuid(obj.ownerid)
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
    status: row.erc_active === false || row.statecode === 1 ? "Inactive" : "Active",
  };
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

export function mapComm(row: Erc_communications): Communication {
  const status = asStatus(row.erc_lifecyclestatusname || Erc_communicationserc_lifecyclestatus[row.erc_lifecyclestatus as 1]);
  const createdOn = row.createdon || row.erc_receiveddate || todayIso();
  const recDate = dateOnly(row.erc_receiveddate || row.createdon);
  const due = row.erc_duedate || "";
  const manual = asFlag(row.erc_ismanuallyescalated) || asFlag(row.erc_ismanuallyescalatedname);
  const locked = asFlag(row.erc_isescalated) || asFlag(row.erc_isescalatedname) || asFlag(row.erc_isescalatedf) || manual;
  const partyRef = lookupRef(row, "erc_externalparty", row.erc_externalpartyname);
  const log: Communication["log"] = [
    { title: FLOWS.createCommunication.name, meta: `${formatDateTime(createdOn)} — native Emails table` },
  ];
  if (partyRef.name) log.push({ title: "Sender matched to External Party Master", meta: partyRef.name });
  if (row.erc_slarulename) log.push({ title: "SLA rule applied", meta: `${row.erc_slarulename} · due ${formatDateTime(due)}` });
  if (row.erc_responsesummary) log.push({ title: "Response recorded", meta: row.erc_responsesummary });
  if (row.erc_closurecomment) log.push({ title: "Closure comment captured by flow", meta: row.erc_closurecomment });
  const formulaCat = asCategoryOptional(row.erc_categoryfname || Erc_communicationserc_categoryf[row.erc_categoryf as 1]);
  const formulaPri = asPriority(row.erc_priorityfname || Erc_communicationserc_priorityf[row.erc_priorityf as 1]);
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
    department: lookupDisplay(row, "erc_department", row.erc_departmentname),
    resp: row.erc_responsesummary,
    respAction: row.erc_responsesummary,
    closed: row.erc_closuredatetime || (status === "Closed" ? row.modifiedon : undefined),
    closedBy: row.erc_closedbyname,
    closureComment: row.erc_closurecomment,
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

export function mapDoc(row: Erc_licenseandcontracts): License {
  const typeLabel = cleanLabel(row.erc_documenttypename || Erc_licenseandcontractserc_documenttype[row.erc_documenttype]);
  const riskLabel = cleanLabel(row.erc_risklevelname || Erc_licenseandcontractserc_risklevel[row.erc_risklevel]);
  const renewal = cleanLabel(row.erc_renewalstatusname || Erc_licenseandcontractserc_renewalstatus[row.erc_renewalstatus]);
  const unit = lookupRef(row, "erc_businessunit", row.erc_businessunitname);
  const partyRef = lookupRef(row, "erc_externalparty", row.erc_externalpartyname);
  const days = row.erc_daystoexpiry ?? row.erc_daysremaining;
  return applyLicenseFormulas({
    id: row.erc_documentnumber || displayDocId(row.erc_licenseandcontractid, row.createdon),
    recordId: row.erc_licenseandcontractid,
    type: typeLabel === "Contract" || typeLabel === "Permit" ? typeLabel : "License",
    name: row.erc_licenseandcontract1 || "Untitled document",
    party: partyRef.name || row.erc_issuingauthorityname || "",
    partyId: partyRef.id,
    auth: row.erc_issuingauthorityname || "",
    issue: dateOnly(row.erc_issuedate),
    expiry: dateOnly(row.erc_expirydate),
    risk: (riskLabel === "Critical" || riskLabel === "High" || riskLabel === "Medium" || riskLabel === "Low" ? riskLabel : "Medium") as DocRisk,
    owner: row.owneridname || "",
    bu: unit.name,
    buId: unit.id,
    department: lookupDisplay(row, "erc_department", row.erc_departmentname),
    status: renewal === "Renewed" ? "Renewed" : renewal === "Expired" ? "Expired" : undefined,
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

export function renewalChoice(status: "Not Started" | "In Progress" | "Submitted" | "Renewed" | "Expired") {
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
  const typeLabel = cleanLabel(row.erc_notificationtypename || Erc_notificationserc_notificationtype[row.erc_notificationtype as 1]);
  const resultLabel = cleanLabel(row.erc_resultname || Erc_notificationserc_result[row.erc_result as 1]);
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
