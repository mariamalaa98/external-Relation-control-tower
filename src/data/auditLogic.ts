import { daysRemaining } from "./licenseLogic";
import type { AuditRow, Communication, License, Notice, Party, Renewal, ThreadEmail } from "./types";

/** BRD communication response standard, measured from received time to the first response. */
export const RESPONSE_STANDARD_HOURS = 24;
/** BRD notification window opens this many days before expiry. */
export const NOTIFY_LEAD_DAYS = 120;
/** Supervisor escalation with no response becomes an executive escalation after this many days. */
export const L1_UNRESOLVED_DAYS = 2;
/** A renewal that is still open this many days after department escalation is raised to executive level. */
export const RENEWAL_L2_DAYS = 7;

export type Criticality = "High" | "Medium" | "Low";
export type CycleStatus = "Open" | "Closed" | "Overdue";
export type AuditDepartment = "Insurance" | "Governmental";

export type CommAuditRow = {
  key: string;
  commId: string;
  party: string;
  category: string;
  criticality: Criticality;
  keyword: string;
  receivedAt?: string;
  responseAt?: string;
  responseAction: string;
  status: string;
  within24: boolean;
  closed: boolean;
  source: Communication;
};

export type AuditEscalation = {
  key: string;
  level: "L1" | "L2";
  title: string;
  subtitle: string;
  to: string;
  receivedAt?: string;
  responseAt?: string;
  lag: string;
  action: string;
  responded: boolean;
};

export type RenewalAuditRow = {
  key: string;
  bu: string;
  department: AuditDepartment;
  orgDepartment: string;
  type: string;
  name: string;
  expiry: string;
  notificationStart: string;
  notifiedAt: string;
  completedAt: string;
  status: CycleStatus;
  inWindow: boolean;
  daysOverdue: number;
  source: License;
};

export type WeekCompletion = {
  week: string;
  count: number;
  documents: string;
  units: string;
};

function norm(id?: string) {
  return (id || "").replace(/[{}]/g, "").toLowerCase();
}

function same(a?: string, b?: string) {
  if (!a || !b) return false;
  return norm(a) === norm(b);
}

export function parseStamp(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  const dateTime = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (dateTime) {
    const d = new Date(
      Number(dateTime[1]),
      Number(dateTime[2]) - 1,
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
    );
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const day = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) {
    const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function localIso(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function stampIso(d: Date) {
  return d.toISOString();
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatAuditDate(value?: string) {
  const d = parseStamp(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatAuditStamp(value?: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return formatAuditDate(value);
  const d = parseStamp(value);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hoursBetween(from: Date, to: Date) {
  return (to.getTime() - from.getTime()) / 36e5;
}

function sameComm(row: Pick<AuditRow, "communicationId">, comm: Communication) {
  return same(row.communicationId, comm.recordId) || same(row.communicationId, comm.id);
}

function threadsFor(comm: Communication, threads: Record<string, ThreadEmail[]>) {
  return threads[comm.recordId] || threads[comm.id] || [];
}

/** Received date/time. Keeps the business received date when Created On was stamped much later. */
export function communicationReceivedAt(comm: Communication) {
  const created = parseStamp(comm.createdOn);
  const rec = parseStamp(comm.rec);
  if (created && rec) {
    const gap = created.getTime() - rec.getTime();
    if (gap > 36 * 36e5) {
      const withClock = new Date(rec);
      withClock.setHours(created.getHours(), created.getMinutes(), created.getSeconds(), 0);
      return withClock;
    }
  }
  return created || rec;
}

export function firstResponseAt(
  comm: Communication,
  audits: AuditRow[],
  threads: Record<string, ThreadEmail[]>,
) {
  const times: number[] = [];
  const push = (value?: string) => {
    const d = parseStamp(value);
    if (d) times.push(d.getTime());
  };
  for (const row of audits) {
    if (!sameComm(row, comm) || row.action !== "Responded") continue;
    push(row.performedOn);
  }
  for (const mail of threadsFor(comm, threads)) {
    if (mail.direction === "Outbound") push(mail.sentOn);
  }
  push(comm.resp);
  if (!times.length) return undefined;
  return new Date(Math.min(...times));
}

export function criticalityOf(priority: string): Criticality {
  if (priority === "Critical" || priority === "High") return "High";
  if (priority === "Medium") return "Medium";
  return "Low";
}

function subjectKeyword(subject: string) {
  return subject
    .trim()
    .split(/\s+/)
    .filter((word) => /[a-z0-9\u0600-\u06FF]/i.test(word))
    .slice(0, 3)
    .join(" ")
    .toLowerCase();
}

function responseAction(comm: Communication, responseAt?: Date) {
  const text = (comm.respAction || comm.resp || "").trim();
  const stampOnly = !!parseStamp(text) && text.length <= 16;
  if (text && !stampOnly) return text;
  if (comm.status === "Closed") return "Closed with evidence";
  if (responseAt) return "Response recorded";
  return "Awaiting response";
}

export function commAuditRow(
  comm: Communication,
  audits: AuditRow[],
  threads: Record<string, ThreadEmail[]>,
): CommAuditRow {
  const received = communicationReceivedAt(comm);
  const response = firstResponseAt(comm, audits, threads);
  const within24 = !!received && !!response && hoursBetween(received, response) <= RESPONSE_STANDARD_HOURS;
  return {
    key: comm.recordId || comm.id,
    commId: comm.id,
    party: comm.party || "—",
    category: comm.cat,
    criticality: criticalityOf(comm.pri),
    keyword: subjectKeyword(comm.emailSubject || comm.subj),
    receivedAt: received ? stampIso(received) : undefined,
    responseAt: response ? stampIso(response) : undefined,
    responseAction: responseAction(comm, response),
    status: comm.status,
    within24,
    closed: comm.status === "Closed",
    source: comm,
  };
}

function savedEscalationAt(comm: Communication, audits: AuditRow[]) {
  const times = audits
    .filter((row) => sameComm(row, comm) && row.action === "Escalated" && row.recordId && !row.id.startsWith("derived-"))
    .map((row) => parseStamp(row.performedOn)?.getTime())
    .filter((n): n is number => typeof n === "number");
  if (!times.length) return undefined;
  return new Date(Math.min(...times));
}

function escalationReceivedAt(comm: Communication, audits: AuditRow[]) {
  return savedEscalationAt(comm, audits)
    || (comm.isOverdue ? parseStamp(comm.due) : undefined)
    || communicationReceivedAt(comm);
}

function responseAfter(response: Date | undefined, received: Date | undefined) {
  if (!response || !received) return undefined;
  if (response.getTime() + 60_000 < received.getTime()) return undefined;
  return response;
}

function lagLabel(received?: Date, response?: Date) {
  if (!received || !response) return "—";
  return `${hoursBetween(received, response).toFixed(1)} h`;
}

function isEscalatedComm(comm: Communication) {
  return !!(comm.isEscalated || comm.isAutomaticallyEscalated || comm.isManuallyEscalated);
}

function escalationAction(comm: Communication, responded: boolean) {
  if (responded && comm.respAction && !parseStamp(comm.respAction)) return comm.respAction;
  if (comm.escalationReason) return comm.escalationReason;
  if (comm.closureComment && comm.status === "Closed") return comm.closureComment;
  return "";
}

export function communicationEscalations(
  comm: Communication,
  audits: AuditRow[],
  threads: Record<string, ThreadEmail[]>,
  now = new Date(),
): AuditEscalation[] {
  if (!isEscalatedComm(comm)) return [];
  const received = escalationReceivedAt(comm, audits);
  const response = responseAfter(firstResponseAt(comm, audits, threads), received);
  const l1: AuditEscalation = {
    key: `${comm.recordId || comm.id}-L1`,
    level: "L1",
    title: comm.id,
    subtitle: comm.party || "",
    to: comm.sup || "Supervisor",
    receivedAt: received ? stampIso(received) : undefined,
    responseAt: response ? stampIso(response) : undefined,
    lag: lagLabel(received, response),
    action: escalationAction(comm, !!response),
    responded: !!response,
  };
  const unresolvedFor = received ? hoursBetween(received, response || now) : 0;
  const raiseL2 = comm.cat === "Legal"
    || !!comm.isManuallyEscalated
    || unresolvedFor >= L1_UNRESOLVED_DAYS * 24;
  if (!raiseL2) return [l1];
  const immediate = comm.cat === "Legal" || !!comm.isManuallyEscalated;
  const l2Received = received
    ? (immediate ? received : addDays(received, L1_UNRESOLVED_DAYS))
    : undefined;
  const l2Response = responseAfter(firstResponseAt(comm, audits, threads), l2Received);
  const l2: AuditEscalation = {
    key: `${comm.recordId || comm.id}-L2`,
    level: "L2",
    title: comm.id,
    subtitle: comm.party || "",
    to: "Executive",
    receivedAt: l2Received ? stampIso(l2Received) : undefined,
    responseAt: l2Response ? stampIso(l2Response) : undefined,
    lag: lagLabel(l2Received, l2Response),
    action: escalationAction(comm, !!l2Response),
    responded: !!l2Response,
  };
  return [l1, l2];
}

export function commCompliance(rows: Pick<CommAuditRow, "within24">[]) {
  const total = rows.length;
  const within = rows.filter((row) => row.within24).length;
  return {
    total,
    within,
    delayed: total - within,
    pct: total ? ((within / total) * 100).toFixed(1) : "0.0",
  };
}

export function auditDepartment(doc: License, party?: Party): AuditDepartment {
  if (party?.category === "Insurance") return "Insurance";
  const blob = `${doc.department || ""} ${doc.party || ""} ${doc.name || ""}`.toLowerCase();
  return blob.includes("insur") ? "Insurance" : "Governmental";
}

function partyOf(doc: License, parties: Party[]) {
  return parties.find((party) => (doc.partyId && same(party.id, doc.partyId)) || party.name === doc.party);
}

function sameDoc(id: string | undefined, doc: License) {
  return same(id, doc.recordId) || same(id, doc.id) || same(id, doc.documentNumber);
}

function noticesFor(doc: License, notices: Notice[]) {
  return notices.filter((row) => sameDoc(row.documentId, doc) || (!!row.documentName && row.documentName === doc.name));
}

function notifiedAt(doc: License, notices: Notice[]) {
  const times = noticesFor(doc, notices)
    .filter((row) => row.type === "Reminder" || row.type === "Expiry")
    .map((row) => parseStamp(row.sentOn)?.getTime())
    .filter((n): n is number => typeof n === "number");
  const fromDoc = parseStamp(doc.notified)?.getTime();
  if (fromDoc) times.push(fromDoc);
  if (!times.length) return "";
  return stampIso(new Date(Math.min(...times)));
}

function completedAt(doc: License, renewals: Renewal[]) {
  if (doc.done) return doc.done.slice(0, 10);
  if (doc.renewalStatus === "Renewed" || doc.status === "Renewed") {
    const match = renewals.find((row) => sameDoc(row.documentId, doc) && row.completed);
    return (match?.completed || "").slice(0, 10);
  }
  const match = renewals.find((row) => sameDoc(row.documentId, doc) && row.status === "Completed" && row.completed);
  return (match?.completed || "").slice(0, 10);
}

export function renewalAuditRow(doc: License, notices: Notice[], renewals: Renewal[], parties: Party[]): RenewalAuditRow {
  const party = partyOf(doc, parties);
  const completed = completedAt(doc, renewals);
  const days = doc.expiry ? daysRemaining(doc.expiry) : 0;
  const closed = !!completed;
  const status: CycleStatus = closed ? "Closed" : days < 0 ? "Overdue" : "Open";
  const expiry = (doc.expiry || "").slice(0, 10);
  const start = expiry ? localIso(addDays(parseStamp(expiry) || new Date(expiry), -NOTIFY_LEAD_DAYS)) : "";
  return {
    key: doc.recordId || doc.id,
    bu: doc.bu || "—",
    department: auditDepartment(doc, party),
    orgDepartment: doc.department || "",
    type: doc.type,
    name: doc.name,
    expiry,
    notificationStart: start,
    notifiedAt: notifiedAt(doc, notices),
    completedAt: completed,
    status,
    inWindow: !closed && days >= 0 && days <= NOTIFY_LEAD_DAYS,
    daysOverdue: status === "Overdue" ? Math.max(1, -days) : 0,
    source: doc,
  };
}

export function renewalSummary(rows: RenewalAuditRow[]) {
  const done = rows.filter((row) => row.status === "Closed").length;
  return {
    total: rows.length,
    due: rows.filter((row) => row.inWindow).length,
    done,
    overdue: rows.filter((row) => row.status === "Overdue").length,
    open: rows.filter((row) => row.status === "Open").length,
    pct: rows.length ? ((done / rows.length) * 100).toFixed(1) : "0.0",
    weeks: weeklyCompletions(rows).length,
  };
}

export function weeklyCompletions(rows: RenewalAuditRow[]): WeekCompletion[] {
  const groups = new Map<string, RenewalAuditRow[]>();
  for (const row of rows) {
    if (row.status !== "Closed" || !row.completedAt) continue;
    const done = parseStamp(row.completedAt);
    if (!done) continue;
    const wd = (done.getDay() + 6) % 7;
    const week = localIso(addDays(done, -wd));
    const list = groups.get(week) || [];
    list.push(row);
    groups.set(week, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, items]) => ({
      week,
      count: items.length,
      documents: items.map((item) => item.name).join("; "),
      units: [...new Set(items.map((item) => item.bu))].join(" · "),
    }));
}

function renewalLevel(doc: License, renewals: Renewal[]) {
  const match = renewals.find((row) => sameDoc(row.documentId, doc) && row.escalation !== "Not Escalated");
  return match?.escalation || (doc.isEscalated ? "L1" : "Not Escalated");
}

function renewalL1Received(doc: License, notices: Notice[]) {
  const escalations = noticesFor(doc, notices).filter((row) => row.type === "Escalation");
  const times = escalations
    .map((row) => parseStamp(row.sentOn)?.getTime())
    .filter((n): n is number => typeof n === "number");
  if (times.length) return new Date(Math.min(...times));
  const expiry = parseStamp(doc.expiry);
  if (!expiry) return undefined;
  if (doc.isEscalated) return expiry;
  return addDays(expiry, RENEWAL_L2_DAYS);
}

export function renewalEscalations(
  doc: License,
  row: RenewalAuditRow,
  notices: Notice[],
  renewals: Renewal[],
  now = new Date(),
): AuditEscalation[] {
  const level = renewalLevel(doc, renewals);
  const overdueLong = row.status === "Overdue" && row.daysOverdue >= RENEWAL_L2_DAYS;
  if (level === "Not Escalated" && !overdueLong) return [];
  const received = renewalL1Received(doc, notices);
  const completed = parseStamp(row.completedAt);
  const response = responseAfter(completed, received);
  const l1: AuditEscalation = {
    key: `${row.key}-L1`,
    level: "L1",
    title: doc.name,
    subtitle: [row.orgDepartment || row.department, doc.id].filter(Boolean).join(" · "),
    to: doc.owner || "Department",
    receivedAt: received ? stampIso(received) : undefined,
    responseAt: response ? stampIso(response) : undefined,
    lag: lagLabel(received, response),
    action: response ? "Renewal completed" : (doc.escalationReason || ""),
    responded: !!response,
  };
  const l2Due = received ? addDays(received, RENEWAL_L2_DAYS) : undefined;
  const stillOpenAtL2 = !!l2Due && now.getTime() >= l2Due.getTime() && !response;
  const completedAfterL2 = !!l2Due && !!completed && completed.getTime() >= l2Due.getTime();
  if (level !== "L2" && !stillOpenAtL2 && !completedAfterL2) return [l1];
  const l2Response = responseAfter(completed, l2Due);
  const l2: AuditEscalation = {
    key: `${row.key}-L2`,
    level: "L2",
    title: doc.name,
    subtitle: [row.orgDepartment || row.department, doc.id].filter(Boolean).join(" · "),
    to: "Executive",
    receivedAt: l2Due ? stampIso(l2Due) : undefined,
    responseAt: l2Response ? stampIso(l2Response) : undefined,
    lag: lagLabel(l2Due, l2Response),
    action: l2Response ? "Renewal completed" : (doc.escalationReason || ""),
    responded: !!l2Response,
  };
  return [l1, l2];
}

export function inDateRange(value: string | undefined, from: string, to: string) {
  if (!from && !to) return true;
  const parsed = parseStamp(value);
  const day = parsed ? localIso(parsed) : (value || "").slice(0, 10);
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
