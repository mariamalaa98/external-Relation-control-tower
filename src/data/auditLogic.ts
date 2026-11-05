import { chainLevelLabel, chainLevelNumbers, peopleAtLevel, waitHoursForLevel } from "./communicationLogic";
import { daysRemaining } from "./licenseLogic";
import type { AuditRow, Communication, EscalationChain, License, Notice, Party, Renewal, ThreadEmail } from "./types";

/** BRD communication response standard, measured from received time to the first response. */
export const RESPONSE_STANDARD_HOURS = 24;
/** BRD notification window opens this many days before expiry. */
export const NOTIFY_LEAD_DAYS = 120;
/** A renewal that is still open this many days after department escalation is raised to the next level. */
export const RENEWAL_L2_DAYS = 7;

export type Criticality = "High" | "Medium" | "Low";
export const PRIORITY_BANDS = ["Critical", "High", "Medium", "Low"] as const;
export type PriorityBand = (typeof PRIORITY_BANDS)[number];
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
  /** Record owner on the communication. */
  owner: string;
  /** Person or team who must reply (current escalation recipient, then reply-responsible, then owner). */
  mustReply: string;
  respondedBy: string;
  /** Who to blame when there is no reply. Empty after a response. */
  accountable: string;
  responseAction: string;
  status: string;
  within24: boolean;
  closed: boolean;
  source: Communication;
};

export type ResponseDuty = {
  owner: string;
  mustReply: string;
  responsible: string;
  respondedBy: string;
  respondedAt?: string;
  responded: boolean;
};


export type AuditEscalation = {
  key: string;
  level: number;
  title: string;
  subtitle: string;
  to: string;
  by: string;
  respondedBy: string;
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
  risk: PriorityBand;
  notifiedPeople: string;
  accountable: string;
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

/** Keeps Critical separate from High so the audit dashboard can show each type. */
export function priorityBand(priority: string): PriorityBand {
  if (priority === "Critical" || priority === "High" || priority === "Medium" || priority === "Low") return priority;
  return "Low";
}

export type AuditFact = {
  group: string;
  level: string;
  replied: boolean;
  closed: boolean;
  owner: string;
  mustReply: string;
  respondedBy: string;
};

export type PersonLoad = {
  name: string;
  sent: number;
  replied: number;
  open: number;
};

export type ReplyGroup = {
  key: string;
  sent: number;
  replied: number;
  notReplied: number;
  personsReplied: PersonLoad[];
  personsOpen: PersonLoad[];
};

export type LevelResponsibility = {
  level: string;
  sent: number;
  replied: number;
  notReplied: number;
  people: PersonLoad[];
};

function personName(value: string) {
  const name = value.trim();
  return name || "Unassigned";
}

function loadsFor(items: AuditFact[], who: (item: AuditFact) => string): PersonLoad[] {
  const map = new Map<string, PersonLoad>();
  for (const item of items) {
    const name = personName(who(item));
    const row = map.get(name) || { name, sent: 0, replied: 0, open: 0 };
    row.sent += 1;
    if (item.replied) row.replied += 1;
    else row.open += 1;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.open - a.open || b.sent - a.sent || a.name.localeCompare(b.name));
}

function orderedKeys(items: AuditFact[], order: readonly string[], pick: (item: AuditFact) => string) {
  const keys = [...order];
  for (const item of items) {
    const key = pick(item);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Per category: communications or notices sent, who replied, and who has not. */
export function groupReplies(items: AuditFact[], order: readonly string[]): ReplyGroup[] {
  return orderedKeys(items, order, (item) => item.group).map((key) => {
    const list = items.filter((item) => item.group === key);
    const repliedItems = list.filter((item) => item.replied);
    const openItems = list.filter((item) => !item.replied);
    return {
      key,
      sent: list.length,
      replied: repliedItems.length,
      notReplied: openItems.length,
      personsReplied: loadsFor(repliedItems, (item) => item.respondedBy || item.mustReply || item.owner),
      personsOpen: loadsFor(openItems, (item) => item.mustReply || item.owner),
    };
  });
}

/** Per criticality: volume plus the responsible person and whether they replied. */
export function responsibilityByLevel(items: AuditFact[], order: readonly string[]): LevelResponsibility[] {
  return orderedKeys(items, order, (item) => item.level).map((level) => {
    const list = items.filter((item) => item.level === level);
    return {
      level,
      sent: list.length,
      replied: list.filter((item) => item.replied).length,
      notReplied: list.filter((item) => !item.replied).length,
      people: loadsFor(list, (item) => item.mustReply || item.owner),
    };
  });
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

export function partyForComm(comm: Communication, parties: Party[] = []) {
  return parties.find((party) => same(party.id, comm.partyId) || party.name === comm.party);
}

/** A real person on the record. Skips the SharePoint / integration team that owns rows in Dataverse. */
export function recordPerson(comm: Communication, party?: Party, chains: EscalationChain[] = []) {
  const level = Math.max(comm.escalationStep || 1, 1);
  const chainPerson = presentablePerson(peopleAtLevel(chains, level, party?.escalationTeamId)[0])
    || presentablePerson(peopleAtLevel(chains, 1, party?.escalationTeamId)[0]);
  return presentablePerson(comm.owner)
    || presentablePerson(party?.owner)
    || presentablePerson(party?.supervisor)
    || presentablePerson(comm.sup)
    || presentablePerson(comm.createdBy)
    || presentablePerson(comm.currentRecipient)
    || chainPerson
    || "";
}

/** Who must reply now: current escalation recipient when that is a person, otherwise the record's person. */
export function mustReplyOf(comm: Communication, party?: Party, chains: EscalationChain[] = []) {
  const current = presentablePerson(comm.currentRecipient);
  if (comm.status !== "Closed" && current) return current;
  return recordPerson(comm, party, chains) || "Unassigned";
}

export function openClosedCounts(rows: { closed: boolean; responseAt?: string; replied?: boolean }[]) {
  const open = rows.filter((row) => !row.closed).length;
  const closed = rows.filter((row) => row.closed).length;
  const unreplied = rows.filter((row) => !(row.responseAt || row.replied)).length;
  const openUnreplied = rows.filter((row) => !row.closed && !(row.responseAt || row.replied)).length;
  return { total: rows.length, open, closed, unreplied, openUnreplied };
}

export function commAuditRow(
  comm: Communication,
  audits: AuditRow[],
  threads: Record<string, ThreadEmail[]>,
  parties: Party[] = [],
): CommAuditRow {
  const received = communicationReceivedAt(comm);
  const duty = communicationDuty(comm, audits, threads, parties);
  const response = duty.respondedAt ? parseStamp(duty.respondedAt) : undefined;
  const within24 = !!received && !!response && hoursBetween(received, response) <= RESPONSE_STANDARD_HOURS;
  return {
    key: comm.recordId || comm.id,
    commId: comm.id,
    party: comm.party || "—",
    category: comm.cat,
    criticality: criticalityOf(comm.pri),
    keyword: subjectKeyword(comm.emailSubject || comm.subj),
    receivedAt: received ? stampIso(received) : undefined,
    responseAt: duty.respondedAt,
    owner: duty.owner,
    mustReply: duty.mustReply,
    respondedBy: duty.respondedBy,
    accountable: duty.responded ? "" : duty.mustReply,
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

function addHoursDate(d: Date, hours: number) {
  const next = new Date(d);
  next.setHours(next.getHours() + hours);
  return next;
}

function lagLabel(received?: Date, response?: Date, now = new Date()) {
  if (!received) return "—";
  const end = response || now;
  const hours = hoursBetween(received, end).toFixed(1);
  return response ? `${hours} h` : `${hours} h waiting`;
}

function reachedLevels(comm: Communication) {
  if (!isEscalatedComm(comm)) return 0;
  return Math.max(1, comm.escalationStep || 1);
}

function levelReachedAt(
  comm: Communication,
  audits: AuditRow[],
  level: number,
  chains: EscalationChain[],
  teamId?: string,
) {
  const step = reachedLevels(comm);
  const last = parseStamp(comm.lastEscalatedOn) || savedEscalationAt(comm, audits) || escalationReceivedAt(comm, audits);
  if (!last) return undefined;
  if (level >= step) return last;
  let at = last;
  for (let s = step; s > level; s--) {
    at = addHoursDate(at, -waitHoursForLevel(s - 1, chains, teamId));
  }
  return at;
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

export function communicationDuty(
  comm: Communication,
  audits: AuditRow[],
  threads: Record<string, ThreadEmail[]>,
  parties: Party[] = [],
  chains: EscalationChain[] = [],
): ResponseDuty {
  const at = firstResponseAt(comm, audits, threads);
  const party = partyForComm(comm, parties);
  const owner = recordPerson(comm, party, chains) || "Unassigned";
  const mustReply = mustReplyOf(comm, party, chains);
  const who = presentablePerson(audits.find((row) => sameComm(row, comm) && row.action === "Responded" && row.performedBy)?.performedBy)
    || (at ? owner : "");
  return {
    owner,
    mustReply,
    responsible: owner,
    respondedBy: who || "",
    respondedAt: at ? stampIso(at) : undefined,
    responded: !!at,
  };
}

function namedDuty(name: string, respondedBy: string, respondedAt?: string, responded = false): ResponseDuty {
  const owner = name || "Unassigned";
  return { owner, mustReply: owner, responsible: owner, respondedBy, respondedAt, responded };
}

export function licenseDuty(doc: License, renewals: Renewal[]): ResponseDuty {
  const completed = completedAt(doc, renewals);
  const renewal = renewals.find((row) => sameDoc(row.documentId, doc));
  const owner = presentablePerson(doc.owner) || "Unassigned";
  const responder = presentablePerson(renewal?.owner) || presentablePerson(doc.owner) || "";
  return namedDuty(owner, completed ? responder : "", completed || undefined, !!completed);
}

export function noticeDuty(notice: Notice, docs: License[], renewals: Renewal[]): ResponseDuty {
  const doc = docs.find((row) => sameDoc(notice.documentId, row) || (!!notice.documentName && notice.documentName === row.name));
  if (!doc) {
    return namedDuty(presentablePerson(notice.owner) || "Unassigned", "", undefined, false);
  }
  return licenseDuty(doc, renewals);
}

export function communicationEscalations(
  comm: Communication,
  audits: AuditRow[],
  threads: Record<string, ThreadEmail[]>,
  now = new Date(),
  parties: Party[] = [],
  chains: EscalationChain[] = [],
): AuditEscalation[] {
  if (!isEscalatedComm(comm)) return [];
  const party = partyForComm(comm, parties);
  const teamId = party?.escalationTeamId;
  const duty = communicationDuty(comm, audits, threads, parties, chains);
  const repliedAt = duty.respondedAt ? parseStamp(duty.respondedAt) : undefined;
  const escalatedBy = audits.find((row) => sameComm(row, comm) && row.action === "Escalated" && row.performedBy)?.performedBy
    || comm.escalatedBy
    || (comm.isAutomaticallyEscalated ? "System (Automatic Escalation)" : "System");
  const reached = reachedLevels(comm);
  const levels = chainLevelNumbers(chains, teamId).filter((level) => level <= reached);
  return levels.map((level) => {
    const received = levelReachedAt(comm, audits, level, chains, teamId);
    const response = responseAfter(repliedAt, received);
    const people = peopleAtLevel(chains, level, teamId);
    const to = people.length
      ? people.join(", ")
      : (level === reached ? (comm.currentRecipient || comm.sup || chainLevelLabel(chains, level, teamId)) : chainLevelLabel(chains, level, teamId));
    return {
      key: `${comm.recordId || comm.id}-L${level}`,
      level,
      title: comm.id,
      subtitle: comm.party || "",
      to,
      by: escalatedBy,
      respondedBy: response ? duty.respondedBy : "",
      receivedAt: received ? stampIso(received) : undefined,
      responseAt: response ? stampIso(response) : undefined,
      lag: lagLabel(received, response, now),
      action: escalationAction(comm, !!response),
      responded: !!response,
    };
  });
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

export function licenseCategory(doc: License, parties: Party[]) {
  const party = partyOf(doc, parties);
  if (party?.category) return party.category;
  return auditDepartment(doc, party) === "Insurance" ? "Insurance" : "Government";
}

export function noticeBelongsToLicense(notice: Notice, docs: License[]) {
  return docs.some((doc) => sameDoc(notice.documentId, doc) || (!!notice.documentName && notice.documentName === doc.name));
}

export function noticeSubject(notice: Notice, docs: License[], parties: Party[]) {
  const doc = docs.find((row) => sameDoc(notice.documentId, row) || (!!notice.documentName && notice.documentName === row.name));
  return {
    doc,
    category: doc ? licenseCategory(doc, parties) : "Unassigned",
    criticality: doc ? priorityBand(doc.risk) : "Low" as PriorityBand,
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

/** Hide mailbox / integration accounts so the auditor sees a real person. */
export function presentablePerson(name?: string) {
  const text = (name || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const n = text.toLowerCase();
  if (n.includes("sharepoint") || n.includes("share point")) return "";
  if (n.includes("application user") || n.includes("#")) return "";
  if (n === "system" || n.startsWith("system (")) return "";
  return text;
}

function uniquePeople(values: (string | undefined)[]) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = presentablePerson(value);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * Business rule: the license/contract owner is both notified (reminder email)
 * and responsible for completing the renewal. Escalation also notifies the
 * party's escalation-chain people.
 */
export function licenseAccountability(
  doc: License,
  notices: Notice[] = [],
  parties: Party[] = [],
  chains: EscalationChain[] = [],
) {
  const responsible = presentablePerson(doc.owner) || "Unassigned";
  const notified = uniquePeople([responsible === "Unassigned" ? "" : responsible]);
  const escalated = !!doc.isEscalated || noticesFor(doc, notices).some((row) => row.type === "Escalation");
  if (escalated) {
    const party = partyOf(doc, parties);
    for (const level of chainLevelNumbers(chains, party?.escalationTeamId)) {
      notified.push(...peopleAtLevel(chains, level, party?.escalationTeamId).map((name) => presentablePerson(name)).filter(Boolean));
    }
  }
  return {
    responsible,
    notified: uniquePeople(notified),
    blame: isClosedLicense(doc) ? "" : responsible,
  };
}

export function notifiedPeopleOf(doc: License, notices: Notice[], parties: Party[] = [], chains: EscalationChain[] = []) {
  const duty = licenseAccountability(doc, notices, parties, chains);
  return duty.notified.length ? duty.notified : (duty.responsible === "Unassigned" ? [] : [duty.responsible]);
}

export function noticeRecipients(notice: Notice, doc?: License, parties: Party[] = [], chains: EscalationChain[] = []) {
  if (!doc) return uniquePeople([notice.owner]);
  const duty = licenseAccountability(doc, [notice], parties, chains);
  return duty.notified.length ? duty.notified : [duty.responsible];
}

export type BlameRow = {
  person: string;
  overdue: number;
  window: number;
  open: number;
  documents: string;
  risk: PriorityBand;
};

export function blameBoard(rows: RenewalAuditRow[]): BlameRow[] {
  const map = new Map<string, BlameRow>();
  const rank = (level: PriorityBand) => PRIORITY_BANDS.indexOf(level);
  for (const row of rows) {
    if (row.status === "Closed") continue;
    const person = row.accountable || "Unassigned";
    const rec = map.get(person) || {
      person,
      overdue: 0,
      window: 0,
      open: 0,
      documents: "",
      risk: "Low" as PriorityBand,
    };
    rec.open += 1;
    if (row.status === "Overdue") rec.overdue += 1;
    else if (row.inWindow) rec.window += 1;
    rec.documents = rec.documents ? `${rec.documents}; ${row.name}` : row.name;
    if (rank(row.risk) < rank(rec.risk)) rec.risk = row.risk;
    map.set(person, rec);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.person.localeCompare(b.person));
}

function isClosedLicense(doc: License) {
  return doc.status === "Renewed" || !!doc.done;
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

export function renewalAuditRow(doc: License, notices: Notice[], renewals: Renewal[], parties: Party[], chains: EscalationChain[] = []): RenewalAuditRow {
  const party = partyOf(doc, parties);
  const completed = completedAt(doc, renewals);
  const days = doc.expiry ? daysRemaining(doc.expiry) : 0;
  const closed = !!completed;
  const status: CycleStatus = closed ? "Closed" : days < 0 ? "Overdue" : "Open";
  const expiry = (doc.expiry || "").slice(0, 10);
  const start = expiry ? localIso(addDays(parseStamp(expiry) || new Date(expiry), -NOTIFY_LEAD_DAYS)) : "";
  const duty = licenseAccountability(doc, notices, parties, chains);
  const people = duty.notified;
  const accountable = duty.blame || duty.responsible;
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
    risk: priorityBand(doc.risk),
    notifiedPeople: people.join("; ") || accountable,
    accountable,
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
  const duty = licenseDuty(doc, renewals);
  const escalatedBy = doc.escalatedBy || "System (Expiry Monitor)";
  const l1: AuditEscalation = {
    key: `${row.key}-L1`,
    level: 1,
    title: doc.name,
    subtitle: [row.orgDepartment || row.department, doc.id].filter(Boolean).join(" · "),
    to: doc.owner || "Level 1",
    by: escalatedBy,
    respondedBy: response ? duty.respondedBy : "",
    receivedAt: received ? stampIso(received) : undefined,
    responseAt: response ? stampIso(response) : undefined,
    lag: lagLabel(received, response, now),
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
    level: 2,
    title: doc.name,
    subtitle: [row.orgDepartment || row.department, doc.id].filter(Boolean).join(" · "),
    to: "Level 2",
    by: escalatedBy,
    respondedBy: l2Response ? duty.respondedBy : "",
    receivedAt: l2Due ? stampIso(l2Due) : undefined,
    responseAt: l2Response ? stampIso(l2Response) : undefined,
    lag: lagLabel(l2Due, l2Response, now),
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
