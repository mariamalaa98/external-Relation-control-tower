import { useSyncExternalStore } from "react";
import { SEED } from "./seed";
import type { BusinessUnitRef, Category, CommStatus, Communication, EmailAttachment, EvidenceFile, IntakeEmail, License, Notice, NoticeType, Party, Priority, Renewal, SlaRule, Store, ThreadEmail } from "./types";
import {
  addDays,
  asPriority,
  categoryChoice,
  commTypeInbound,
  dateOnly,
  defaultPriorityChoice,
  daysBetween,
  docState,
  docTypeChoice,
  fallbackSlaDays,
  isoDateTime,
  lifecycleChoice,
  lookupDisplay,
  mapComm,
  mapDoc,
  mapNotice,
  mapParty,
  mapRenewal,
  mapSla,
  needsEvidence,
  noticeResultChoice,
  noticeTypeChoice,
  nowStamp,
  partyStatusChoice,
  renewalChoice,
  renewalRiskChoice,
  renewalTaskStatusChoice,
  renewalTypeChoice,
  escalationChoice,
  riskChoice,
  senderDomain,
  slaState,
  slaStatusChoice,
  todayIso,
} from "./mappers";
import {
  applyLicenseFormulas,
  clip100,
  DEFAULT_REMINDER_THRESHOLD,
  isLicenseClosed,
  isThresholdReached,
  noticeMessage,
  noticeTitle,
  openRenewalFor,
  summarizeMonitor,
  thresholdOf,
} from "./licenseLogic";
import {
  applyFormulaFields,
  automaticEscalationPatch,
  canAutoEscalate,
  canManualEscalate,
  closureFromFlow,
  dueFromCreated,
  extraCommFields,
  findThread,
  formatDateTime,
  isCentralMailbox,
  conversationPrefix,
  emailBodyParts,
  normalizeSubject,
  manualEscalationPatch,
  toIso,
} from "./communicationLogic";
import { MAILBOX_MAHA, MAILBOX_PROD, CENTRAL_MAILBOX_ADDRESSES } from "./types";
import { EmailsService } from "../generated/services/EmailsService";
import { ActivitypartiesService } from "../generated/services/ActivitypartiesService";
import { BusinessunitsService } from "../generated/services/BusinessunitsService";
import { CENTRAL_MAILBOX_PARTY_ID, FLOWS, TO_RECIPIENT } from "./flows";
import type { Emails } from "../generated/models/EmailsModel";
import { Erc_communicationsService } from "../generated/services/Erc_communicationsService";
import { Erc_externalpartiesService } from "../generated/services/Erc_externalpartiesService";
import { Erc_licenseandcontractsService } from "../generated/services/Erc_licenseandcontractsService";
import { Erc_notificationsService } from "../generated/services/Erc_notificationsService";
import { Erc_renewalsService } from "../generated/services/Erc_renewalsService";
import { Erc_sla2sService } from "../generated/services/Erc_sla2sService";
import { SystemusersService } from "../generated/services/SystemusersService";
import { TeamsService } from "../generated/services/TeamsService";
import type { Erc_communicationsBase } from "../generated/models/Erc_communicationsModel";
import type { Erc_externalpartiesBase } from "../generated/models/Erc_externalpartiesModel";
import type { Erc_licenseandcontractsBase } from "../generated/models/Erc_licenseandcontractsModel";
import type { Erc_notificationsBase } from "../generated/models/Erc_notificationsModel";
import type { Erc_renewalsBase } from "../generated/models/Erc_renewalsModel";
import { attachmentsFromEmailRecord, emailGetOptions, fetchAttachmentContent, listAttachmentsForEmails, mimeFromFileName } from "./emailAttachments";

let store: Store = {
  source: "local",
  ready: false,
  sla: [],
  parties: [],
  comms: [],
  docs: [],
  renewals: [],
  notices: [],
  intake: [],
  files: [],
  threadByComm: {},
  businessUnits: [],
  warnings: [],
};
const listeners = new Set<() => void>();
const escalatingIds = new Set<string>();
let licenseMonitorRunning = false;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStore() {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

export function slaDays(cat: string, pri: string) {
  const rule = findSla(cat as Category, pri as Priority);
  return rule?.resolveDays ?? fallbackSlaDays(asPriority(pri));
}

export function findSla(cat: Category, pri: Priority): SlaRule | undefined {
  return store.sla.find((r) => r.active && r.category === cat && r.priority === pri)
    || SEED.sla.find((r) => r.category === cat && r.priority === pri);
}

export function matchPartyByEmail(email: string) {
  const domain = senderDomain(email);
  return store.parties.find((p) => p.status === "Active" && (p.domain === domain || p.email.toLowerCase() === email.toLowerCase()));
}

export function commLocked(row?: Communication) {
  return !!row && row.status === "Closed";
}

export function docLocked(row?: License) {
  return !!row && (!!row.done || row.status === "Renewed");
}

function nextSeq(ids: string[], prefix: string) {
  const n = Math.max(0, ...ids.map((id) => {
    const part = id.split("-").pop() || "";
    const num = Number(part);
    return Number.isFinite(num) ? num : 0;
  })) + 1;
  return `${prefix}${String(n).padStart(4, "0")}`;
}

function nextLocalCommId() {
  return nextSeq(store.comms.map((c) => c.id), "COM-2026-");
}

function nextLocalDocId() {
  return nextSeq(store.docs.map((c) => c.id), "DOC-2026-");
}

function nextLocalRenewalId() {
  return nextSeq(store.renewals.map((c) => c.id), "REN-2026-");
}

function nextLocalNoticeId() {
  return nextSeq(store.notices.map((c) => c.id), "NTF-2026-");
}

function isGuid(id?: unknown): id is string {
  if (typeof id !== "string" || !id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.replace(/[{}]/g, "").trim());
}

function replaceDoc(next: License) {
  store = { ...store, docs: store.docs.map((d) => d.recordId === next.recordId || d.id === next.id ? next : d) };
  emit();
  return next;
}

async function userIdByName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  try {
    const escaped = trimmed.replace(/'/g, "''");
    const result = await SystemusersService.getAll({ top: 5, filter: `fullname eq '${escaped}'` });
    return result.data?.[0]?.systemuserid;
  } catch {
    return undefined;
  }
}

function log(row: Communication, title: string, meta: string) {
  row.log = [...row.log, { title, meta }];
}

function findComm(id: string) {
  return store.comms.find((c) => c.id === id || c.recordId === id || sameId(c.recordId, id) || sameId(c.id, id));
}

function replaceComm(next: Communication) {
  store = { ...store, comms: store.comms.map((c) => c.recordId === next.recordId || c.id === next.id ? next : c) };
  emit();
  return next;
}

function sameId(a?: string, b?: string) {
  if (!a || !b) return false;
  return a.replace(/[{}]/g, "").toLowerCase() === b.replace(/[{}]/g, "").toLowerCase();
}

export { sameId };

const ownerNameCache = new Map<string, string>();

function ownerCacheKey(id: string) {
  return id.replace(/[{}]/g, "").toLowerCase();
}

async function resolveMissingOwners(rows: Communication[]): Promise<Communication[]> {
  const missing = rows.filter((r) => !String(r.owner || "").trim() && r.ownerId);
  if (!missing.length) return rows;
  const unresolved = [...new Set(missing.map((r) => r.ownerId!).filter((id) => !ownerNameCache.has(ownerCacheKey(id))))];
  const chunkSize = 12;
  for (let i = 0; i < unresolved.length; i += chunkSize) {
    const chunk = unresolved.slice(i, i + chunkSize);
    try {
      const filter = chunk.map((id) => `systemuserid eq ${ownerCacheKey(id)}`).join(" or ");
      const users = await SystemusersService.getAll({ top: chunk.length, filter, select: ["systemuserid", "fullname"] });
      for (const user of users.data || []) {
        if (user.systemuserid && user.fullname) ownerNameCache.set(ownerCacheKey(user.systemuserid), user.fullname);
      }
    } catch { /* owner may be a team */ }
    const still = chunk.filter((id) => !ownerNameCache.has(ownerCacheKey(id)));
    if (!still.length) continue;
    try {
      const filter = still.map((id) => `teamid eq ${ownerCacheKey(id)}`).join(" or ");
      const teams = await TeamsService.getAll({ top: still.length, filter, select: ["teamid", "name"] });
      for (const team of teams.data || []) {
        if (team.teamid && team.name) ownerNameCache.set(ownerCacheKey(team.teamid), team.name);
      }
    } catch { /* leave blank if lookup is denied */ }
  }
  return rows.map((row) => {
    if (String(row.owner || "").trim() || !row.ownerId) return row;
    const name = ownerNameCache.get(ownerCacheKey(row.ownerId));
    return name ? { ...row, owner: name } : row;
  });
}

export function matchesSearch(q: string, ...fields: unknown[]) {
  const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const blob = fields
    .map((field) => {
      if (field == null || field === false) return "";
      if (typeof field === "string" || typeof field === "number") return String(field);
      if (typeof field === "object" && field !== null && "name" in (field as object)) {
        return String((field as { name?: string }).name || "");
      }
      return String(field);
    })
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return tokens.every((token) => blob.includes(token));
}

export function uniqueOrgLabels(values: Array<string | undefined>) {
  return [...new Set(values.map((v) => (v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function unitByRef(value?: string, units: BusinessUnitRef[] = store.businessUnits) {
  const raw = (value || "").trim();
  if (!raw) return undefined;
  return units.find((u) => u.name === raw || sameId(u.id, raw));
}

export function partyOrgOptions(parties: Party[], bu = "All", units: BusinessUnitRef[] = store.businessUnits) {
  const businessUnits = uniqueOrgLabels(
    units.length ? units.map((u) => u.name) : parties.map((p) => p.bu),
  );
  const selected = unitByRef(bu, units);
  const inBu = bu === "All"
    ? parties
    : parties.filter((p) => (p.bu || "").trim() === bu || (!!selected && sameId(p.buId, selected.id)));
  return {
    businessUnits,
    departments: uniqueOrgLabels(inBu.map((p) => p.department)),
  };
}

function orgParty(row: { partyId?: string; party?: string }, parties: Party[]) {
  return parties.find((p) => sameId(p.id, row.partyId) || (!!row.party && p.name === row.party));
}

function matchesOrg(
  bu: string,
  dept: string,
  values: { bu?: string; buId?: string; department?: string },
  units: BusinessUnitRef[] = store.businessUnits,
) {
  if (bu !== "All") {
    const selected = unitByRef(bu, units);
    const rowUnit = unitByRef(values.buId, units) || unitByRef(values.bu, units);
    const nameMatch = (values.bu || "").trim() === bu;
    if (selected && rowUnit) {
      if (!sameId(selected.id, rowUnit.id) && !nameMatch) return false;
    } else if (!nameMatch && !(selected && sameId(selected.id, values.buId))) {
      return false;
    }
  }
  if (dept !== "All" && (values.department || "").trim() !== dept) return false;
  return true;
}

export function partyMatchesOrg(party: Party, bu: string, dept: string, units: BusinessUnitRef[] = store.businessUnits) {
  return matchesOrg(bu, dept, party, units);
}

export function commMatchesOrg(row: Communication, bu: string, dept: string, parties: Party[] = store.parties, units: BusinessUnitRef[] = store.businessUnits) {
  const party = orgParty(row, parties);
  return matchesOrg(bu, dept, {
    bu: row.bu || party?.bu,
    buId: party?.buId,
    department: row.department || party?.department,
  }, units);
}

export function docMatchesOrg(row: License, bu: string, dept: string, parties: Party[] = store.parties, units: BusinessUnitRef[] = store.businessUnits) {
  const party = orgParty(row, parties);
  return matchesOrg(bu, dept, {
    bu: row.bu || party?.bu,
    buId: row.buId || party?.buId,
    department: row.department || party?.department,
  }, units);
}

function applyUnitName<T extends { bu?: string; buId?: string }>(row: T, units: BusinessUnitRef[]): T {
  const unit = units.find((u) => sameId(u.id, row.buId))
    || units.find((u) => sameId(u.id, row.bu))
    || units.find((u) => u.name === (row.bu || "").trim());
  if (!unit) return row;
  return { ...row, bu: unit.name, buId: unit.id };
}

function partyNameEquals(a?: string, b?: string) {
  return !!(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function fillPartyDisplay(row: Communication, parties: Party[] = store.parties): Communication {
  const withOwner = (next: Communication, party?: Party) => {
    if (String(next.owner || "").trim() || !party?.owner) return next;
    return { ...next, owner: party.owner };
  };
  if (row.partyId) {
    const match = parties.find((p) => sameId(p.id, row.partyId) || partyNameEquals(p.name, row.party));
    if (match) {
      if (store.source === "dataverse") return withOwner({ ...row, party: match.name, partyId: match.id }, match);
      return withOwner({
        ...row,
        party: match.name,
        partyId: match.id,
        cat: match.category || row.cat,
        bu: match.bu || row.bu,
        categoryAssigned: true,
      }, match);
    }
    return { ...row, party: row.party || "Linked party" };
  }
  if (row.party) {
    const match = parties.find((p) => partyNameEquals(p.name, row.party));
    if (match) {
      if (store.source === "dataverse") return withOwner({ ...row, partyId: match.id, party: match.name }, match);
      return withOwner({
        ...row,
        partyId: match.id,
        party: match.name,
        cat: match.category || row.cat,
        bu: match.bu || row.bu,
        categoryAssigned: true,
      }, match);
    }
    return row;
  }
  return { ...row, party: "" };
}

async function commFromDataverse(id: string, fallback: Communication): Promise<Communication> {
  try {
    const got = await Erc_communicationsService.get(id);
    if (got.data) return fillPartyDisplay((await resolveMissingOwners([mapComm(got.data)]))[0]);
  } catch { /* create response may omit formula columns */ }
  return fillPartyDisplay({ ...fallback, recordId: id, overdueFromColumn: true });
}

export async function loadCommunicationById(id: string): Promise<Communication | undefined> {
  const existing = findComm(id);
  if (existing) return existing;
  if (store.source !== "dataverse" || !isGuid(id)) return undefined;
  try {
    const got = await Erc_communicationsService.get(id.replace(/[{}]/g, ""));
    if (!got.data) return undefined;
    const mapped = fillPartyDisplay((await resolveMissingOwners([applyUnitName(mapComm(got.data), store.businessUnits)]))[0]);
    if (!findComm(mapped.recordId || mapped.id)) {
      store = { ...store, comms: [mapped, ...store.comms] };
      emit();
    }
    return mapped;
  } catch {
    return undefined;
  }
}

async function closedByBind(name: string): Promise<Partial<Erc_communicationsBase>> {
  const trimmed = name.trim();
  if (!trimmed) return {};
  try {
    const escaped = trimmed.replace(/'/g, "''");
    const result = await SystemusersService.getAll({
      top: 5,
      filter: `fullname eq '${escaped}'`,
    });
    const id = result.data?.[0]?.systemuserid;
    return id ? { "erc_ClosedBy@odata.bind": `/systemusers(${id})` } : {};
  } catch {
    return {};
  }
}

async function persistComm(row: Communication, fields: Partial<Erc_communicationsBase> = {}) {
  if (store.source !== "dataverse" || !row.recordId) return;
  await Erc_communicationsService.update(row.recordId, {
    erc_slastatus: slaStatusChoice(slaState(row)),
    ...fields,
  });
}

function partyForSender(email: string, parties: Party[]) {
  const angle = email.match(/<([^>]+)>/);
  const address = (angle ? angle[1] : email).trim().toLowerCase();
  const domain = senderDomain(address);
  return parties.find((p) => p.status === "Active" && p.email.toLowerCase() === address)
    || parties.find((p) => p.status === "Active" && !!p.domain && p.domain === domain);
}

function emailText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null) {
    const obj = value as { name?: string; address?: string; addressused?: string };
    return (obj.name || obj.address || obj.addressused || "").trim();
  }
  return String(value).trim();
}

function mapEmailToIntake(email: Emails, comms: Communication[], parties: Party[]): IntakeEmail {
  const sender = emailText(email.sender)
    || emailText(email.from)
    || lookupDisplay(email, "emailsender")
    || lookupDisplay(email, "from");
  const to = emailText(email.torecipients) || emailText(email.to) || MAILBOX_PROD;
  const party = partyForSender(sender, parties);
  const regarding = email._regardingobjectid_value;
  const linked = comms.find((c) => c.recordId && c.recordId === regarding)
    || findThread(comms, {
      id: email.activityid,
      recv: email.createdon || "",
      from: sender,
      to: email.torecipients || email.to || "",
      subj: email.subject || "",
      match: party?.name || "",
      cat: party?.category || "Corporate",
      pri: "Medium",
      owner: party?.owner || "",
      status: "New",
      conversationIndex: email.conversationindex,
      inReplyTo: email._parentactivityid_value,
    });
  return {
    id: email.activityid,
    recv: formatDateTime(email.createdon) || email.createdon || "",
    from: sender,
    to,
    subj: email.subject || "(no subject)",
    match: party?.name || linked?.party || "",
    cat: party?.category || "Corporate",
    pri: "Medium",
    owner: party?.owner || "",
    status: linked ? "Routed" : "New",
    commId: linked?.id,
    conversationIndex: email.conversationindex,
    inReplyTo: email._parentactivityid_value,
    threadAction: linked ? "Created" : undefined,
  };
}

/** Emails sent to a central mailbox. Regarding is not required — the mailbox page lists every matching message. */
async function loadMailboxEmails(comms: Communication[], parties: Party[]): Promise<IntakeEmail[]> {
  const collected = new Map<string, Emails>();

  function addRows(rows: Emails[] | undefined) {
    for (const email of rows || []) {
      if (email.activityid && (isCentralMailbox(email.torecipients || email.to) || collected.has(email.activityid))) {
        collected.set(email.activityid, email);
      }
    }
  }

  try {
    const incoming = await EmailsService.getAll({
      top: 250,
      orderBy: ["createdon desc"],
    });
    addRows((incoming.data || []).filter((email) => isCentralMailbox(email.torecipients || email.to || email.cc)));
  } catch { /* try activity parties next */ }

  const mailboxFilter = CENTRAL_MAILBOX_ADDRESSES
    .map((addr) => `addressused eq '${addr.replace(/'/g, "''")}'`)
    .join(" or ");

  async function activityIds(filter: string) {
    try {
      const rows = await ActivitypartiesService.getAll({ top: 500, filter });
      return (rows.data || []).map((p) => p._activityid_value).filter((id): id is string => !!id);
    } catch {
      return [];
    }
  }

  const partyIds = [
    ...await activityIds(`participationtypemask eq ${TO_RECIPIENT} and (${mailboxFilter})`),
    ...await activityIds(`_partyid_value eq ${CENTRAL_MAILBOX_PARTY_ID} and participationtypemask eq ${TO_RECIPIENT}`),
  ];
  const missing = [...new Set(partyIds)].filter((id) => !collected.has(id));
  for (let i = 0; i < missing.length; i += 20) {
    const chunk = missing.slice(i, i + 20);
    try {
      const result = await EmailsService.getAll({
        top: chunk.length,
        filter: chunk.map((id) => `activityid eq ${id}`).join(" or "),
      });
      for (const email of result.data || []) collected.set(email.activityid, email);
    } catch { /* skip this batch */ }
  }

  return [...collected.values()]
    .sort((a, b) => Date.parse(b.createdon || "") - Date.parse(a.createdon || ""))
    .map((email) => mapEmailToIntake(email, comms, parties));
}

function mapThreadEmail(email: Emails): ThreadEmail {
  const incoming = email.directioncode === false || (email.directioncodename || "").toLowerCase().includes("incoming");
  const subject = email.subject || "(no subject)";
  const parts = emailBodyParts(email.safedescription || email.description);
  const body = parts.body || parts.quoted;
  return {
    id: email.activityid,
    subject,
    from: email.sender || email.from || "",
    to: email.torecipients || email.to || "",
    sentOn: email.senton || email.createdon || email.actualend || "",
    direction: incoming ? "Inbound" : "Outbound",
    preview: body.slice(0, 280),
    body: parts.body,
    quoted: parts.quoted,
    attachmentCount: email.attachmentcount || 0,
    attachments: [],
    isReply: !!email._parentactivityid_value || /^(re|fw|fwd)\s*:/i.test(subject),
    conversationIndex: email.conversationindex,
  };
}

function localAttachments(comm: Communication, mailId: string): EmailAttachment[] {
  return store.files
    .filter((f) => f.rel === comm.id || f.rel === comm.recordId)
    .map((f) => ({
      id: `${mailId}-${f.id}`,
      name: f.name,
      mimeType: mimeFromFileName(f.name),
      size: 0,
      emailId: mailId,
      localBody: `Attachment: ${f.name}\nDate: ${f.date}\nBy: ${f.by}\n\nThis is a readable copy of the file attached to the email.`,
    }));
}

function threadKey(comm: Communication) {
  return comm.recordId || comm.id;
}

export function threadEmails(comm: Communication): ThreadEmail[] {
  return store.threadByComm?.[threadKey(comm)] || [];
}

function localThread(comm: Communication): ThreadEmail[] {
  const subject = normalizeSubject(comm.emailSubject || comm.subj);
  const prefix = conversationPrefix(comm.conversationIndex);
  const fromIntake = store.intake.filter((m) => (
    m.commId === comm.id
    || (prefix && conversationPrefix(m.conversationIndex) === prefix)
    || m.inReplyTo === comm.id
    || m.inReplyTo === comm.recordId
    || (subject && normalizeSubject(m.subj) === subject)
  ));
  const mapped: ThreadEmail[] = fromIntake.map((m) => ({
    id: m.id,
    subject: m.subj,
    from: m.from,
    to: m.to,
    sentOn: m.recv,
    direction: "Inbound" as const,
    preview: "",
    body: "",
    quoted: "",
    attachmentCount: 0,
    attachments: [],
    isReply: !!m.inReplyTo || m.threadAction === "Attached",
    conversationIndex: m.conversationIndex,
  }));
  if (!mapped.length) {
    mapped.push({
      id: comm.emailActivityId || comm.id,
      subject: comm.emailSubject || comm.subj,
      from: comm.party,
      to: MAILBOX_MAHA,
      sentOn: comm.createdOn || comm.rec,
      direction: comm.type === "Outbound" ? "Outbound" : "Inbound",
      preview: comm.description || comm.respAction || "",
      body: comm.description || comm.respAction || "",
      quoted: "",
      attachmentCount: 0,
      attachments: [],
      isReply: false,
      conversationIndex: comm.conversationIndex,
    });
  }
  const files = localAttachments(comm, mapped[0].id);
  if (files.length) {
    mapped[0] = { ...mapped[0], attachments: files, attachmentCount: files.length };
  }
  return mapped;
}

export async function loadCommThread(comm: Communication): Promise<ThreadEmail[]> {
  const key = threadKey(comm);
  if (store.source !== "dataverse") {
    const emails = localThread(comm);
    store = { ...store, threadByComm: { ...store.threadByComm, [key]: emails } };
    emit();
    return emails;
  }
  const clauses: string[] = [];
  if (comm.recordId) clauses.push(`_regardingobjectid_value eq ${comm.recordId}`);
  if (comm.emailActivityId) {
    clauses.push(`activityid eq ${comm.emailActivityId}`);
    clauses.push(`_parentactivityid_value eq ${comm.emailActivityId}`);
  }
  const prefix = conversationPrefix(comm.conversationIndex);
  if (prefix) clauses.push(`startswith(conversationindex,'${prefix.replace(/'/g, "''")}')`);
  let rows: Emails[] = [];
  try {
    const result = await EmailsService.getAll({
      top: 50,
      orderBy: ["createdon asc"],
      filter: clauses.length ? clauses.join(" or ") : undefined,
    });
    rows = result.data || [];
  } catch {
    if (comm.recordId) {
      try {
        const fallback = await EmailsService.getAll({
          top: 50,
          orderBy: ["createdon asc"],
          filter: `_regardingobjectid_value eq ${comm.recordId}`,
        });
        rows = fallback.data || [];
      } catch {
        rows = [];
      }
    }
  }
  const emails = await Promise.all((rows).map(async (email) => {
    let full = email;
    try {
      const loaded = await EmailsService.get(email.activityid, emailGetOptions);
      full = loaded.data || email;
    } catch {
      try {
        const loaded = await EmailsService.get(email.activityid);
        full = loaded.data || email;
      } catch {
        full = email;
      }
    }
    const mapped = mapThreadEmail(full);
    const attachments = attachmentsFromEmailRecord(full, mapped.id);
    if (attachments.length) {
      mapped.attachments = attachments;
      mapped.attachmentCount = attachments.length;
    }
    return mapped;
  }));
  const missing = emails.filter((mail) => mail.attachmentCount > 0 && !(mail.attachments && mail.attachments.length));
  if (missing.length) {
    try {
      const grouped = await listAttachmentsForEmails(missing.map((mail) => mail.id));
      for (const mail of missing) {
        const attachments = grouped.get(mail.id) || [];
        mail.attachments = attachments;
        if (attachments.length) mail.attachmentCount = attachments.length;
      }
    } catch {
      /* keep attachment counts from the email row */
    }
  }
  store = { ...store, threadByComm: { ...store.threadByComm, [key]: emails } };
  emit();
  return emails;
}

export async function loadEmailAttachmentFile(att: EmailAttachment) {
  return fetchAttachmentContent(att);
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function hydrate(useDataverse: boolean) {
  if (!useDataverse) {
    store = {
      ...structuredClone(SEED),
      ready: true,
      source: "local",
      comms: structuredClone(SEED.comms).map((row) => applyFormulaFields(row)),
      docs: structuredClone(SEED.docs).map((row) => applyLicenseFormulas(row)),
      notices: structuredClone(SEED.notices),
      warnings: ["Not connected to Dataverse. The dashboard will not show live figures until this app runs inside Power Apps."],
    };
    emit();
    await runAutomaticEscalation();
    await runLicenseMonitor();
    return;
  }

  const warnings: string[] = [];
  async function loadTable<T, R>(
    name: string,
    work: Promise<{ data?: T[] }>,
    mapRow: (row: T) => R,
    opts: { emptyOk?: boolean } = {},
  ): Promise<R[]> {
    try {
      const result = await withTimeout(work, 20000, name);
      const raw = result.data || [];
      if (!raw.length && !opts.emptyOk) warnings.push(`${name}: no records found in Dataverse.`);
      return raw.flatMap((row) => {
        try { return [mapRow(row)]; } catch { return []; }
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      warnings.push(`${name} could not be loaded (${detail}).`);
      return [];
    }
  }

  const [mappedParties, mappedSla, mappedCommsRaw, mappedDocs, mappedRenewals, mappedNotices, unitRows] = await Promise.all([
    loadTable("External parties", Erc_externalpartiesService.getAll({ top: 500, orderBy: ["erc_partyname asc"] }), (row) => row),
    loadTable("SLA rules", Erc_sla2sService.getAll({ top: 100 }), (row) => row),
    loadTable("Communications", Erc_communicationsService.getAll({ top: 250, orderBy: ["createdon desc"] }), (row) => row),
    loadTable("Licenses and contracts", Erc_licenseandcontractsService.getAll({ top: 250, orderBy: ["erc_expirydate asc"] }), (row) => row),
    loadTable("Renewals", Erc_renewalsService.getAll({ top: 250, orderBy: ["erc_duedate asc"] }), (row) => row, { emptyOk: true }),
    loadTable("Notifications", Erc_notificationsService.getAll({ top: 250, orderBy: ["createdon desc"] }), (row) => row, { emptyOk: true }),
    loadTable("Business units", BusinessunitsService.getAll({ top: 500, orderBy: ["name asc"] }), (row) => row, { emptyOk: true }),
  ]);

  const businessUnits: BusinessUnitRef[] = (unitRows as { businessunitid: string; name: string; isdisabled?: boolean }[])
    .filter((u) => u.businessunitid && u.name && u.isdisabled !== true)
    .map((u) => ({ id: u.businessunitid, name: u.name }));

  const parties = mappedParties.flatMap((row) => {
    try { return [applyUnitName(mapParty(row as Parameters<typeof mapParty>[0]), businessUnits)]; } catch { return []; }
  });
  const sla = mappedSla.flatMap((row) => {
    try { return [mapSla(row as Parameters<typeof mapSla>[0])]; } catch { return []; }
  });
  const mappedComms = await resolveMissingOwners(mappedCommsRaw.flatMap((row) => {
    try { return [applyUnitName(mapComm(row as Parameters<typeof mapComm>[0]), businessUnits)]; } catch { return []; }
  }));
  const docs = mappedDocs.flatMap((row) => {
    try { return [applyUnitName(mapDoc(row as Parameters<typeof mapDoc>[0]), businessUnits)]; } catch { return []; }
  });
  const renewals = mappedRenewals.flatMap((row) => {
    try { return [mapRenewal(row as Parameters<typeof mapRenewal>[0])]; } catch { return []; }
  });
  const notices = mappedNotices.flatMap((row) => {
    try { return [mapNotice(row as Parameters<typeof mapNotice>[0])]; } catch { return []; }
  });

  store = {
    source: "dataverse",
    ready: true,
    error: warnings.some((w) => w.includes("could not be loaded")) && !mappedComms.length && !parties.length && !docs.length
      ? warnings[0]
      : undefined,
    warnings,
    sla,
    parties,
    comms: mappedComms.map((row) => fillPartyDisplay(row, parties)),
    docs,
    renewals,
    notices,
    intake: [],
    files: [],
    threadByComm: {},
    businessUnits,
  };
  emit();
  try {
    const intake = await loadMailboxEmails(mappedComms, parties);
    store = { ...store, intake };
    emit();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    store = { ...store, warnings: [...(store.warnings || []), `Central mailbox emails could not be loaded (${detail}).`] };
    emit();
  }
}

export async function refresh() {
  await hydrate(true);
}

function dataverseMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    const row = err as {
      message?: string;
      errorMessage?: string;
      error?: { message?: string; error?: { message?: string } };
      data?: { message?: string };
    };
    return String(
      row.message
      || row.errorMessage
      || row.error?.message
      || row.error?.error?.message
      || row.data?.message
      || "",
    ).trim();
  }
  return "";
}

function partyIdFromResult(result: unknown): string | undefined {
  if (!result) return undefined;
  if (isGuid(result)) return result.trim();
  if (typeof result !== "object") return undefined;
  const row = result as Record<string, unknown>;
  const data = row.data;
  if (isGuid(data)) return String(data).trim();
  const bags = [data, row].filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  for (const bag of bags) {
    const direct = bag.erc_externalpartyid ?? bag.id ?? bag.Id;
    if (isGuid(direct)) return String(direct).trim();
    const odata = bag["@odata.id"] ?? bag["odata.id"] ?? bag.odataid;
    if (typeof odata === "string") {
      const match = odata.match(/\(([0-9a-f-]{36})\)/i);
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}

function odataQuote(value: string) {
  return value.replace(/'/g, "''");
}

async function createExternalParty(record: Omit<Erc_externalpartiesBase, "erc_externalpartyid">) {
  try {
    const result = await Erc_externalpartiesService.create(record);
    const failed = (result as { success?: boolean; wasSuccessful?: boolean }).success === false
      || (result as { wasSuccessful?: boolean }).wasSuccessful === false;
    const id = partyIdFromResult(result);
    if (failed && !id) throw new Error(dataverseMessage(result) || "Dataverse rejected the External Party create.");
    return { id, result };
  } catch (err) {
    throw new Error(dataverseMessage(err) || "Could not create the External Party in Dataverse.");
  }
}

async function findCreatedPartyId(name: string, email: string) {
  const filters = [
    `erc_partyname eq '${odataQuote(name)}' and erc_officialemail eq '${odataQuote(email)}'`,
    `erc_partyname eq '${odataQuote(name)}'`,
  ];
  for (const filter of filters) {
    try {
      const rows = await Erc_externalpartiesService.getAll({ top: 5, filter, orderBy: ["createdon desc"] });
      const id = rows.data?.map((row) => row.erc_externalpartyid).find((value) => isGuid(value));
      if (id) return id;
    } catch { /* try next filter */ }
  }
  return undefined;
}

export async function addParty(input: Omit<Party, "id" | "status"> & { status?: Party["status"] }) {
  const domain = String(input.domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "")
    .toLowerCase();
  if (!domain || !domain.includes(".")) {
    throw new Error("Domain is required (for example gmail.com or mohp.gov.eg), without @.");
  }
  const unit = store.businessUnits.find((u) => u.id === input.buId || u.name === input.bu);
  const party: Party = {
    ...input,
    domain,
    id: `P${Date.now()}`,
    status: input.status || "Draft",
    bu: unit?.name || input.bu,
    buId: unit?.id || input.buId,
  };
  if (store.source === "dataverse") {
    const statusChoice = partyStatusChoice(party.status);
    const buBind = party.buId && !party.buId.startsWith("P") && /^[0-9a-f-]{36}$/i.test(party.buId)
      ? { "erc_BusinessUnit@odata.bind": `/businessunits(${party.buId})` }
      : {};
    const attempts: Array<Omit<Erc_externalpartiesBase, "erc_externalpartyid">> = [
      {
        erc_partyname: party.name,
        erc_officialemail: party.email,
        erc_domain: party.domain,
        erc_category: categoryChoice(party.category),
        erc_defaultpriority: defaultPriorityChoice(party.criticality),
        erc_priority: party.criticality === "Low" ? 4 : party.criticality === "Medium" ? 3 : 2,
        cr18c_extrnalparty_status: statusChoice,
        ...buBind,
      } as Omit<Erc_externalpartiesBase, "erc_externalpartyid">,
      {
        erc_partyname: party.name,
        erc_officialemail: party.email,
        erc_domain: party.domain,
        erc_category: categoryChoice(party.category),
        erc_defaultpriority: defaultPriorityChoice(party.criticality),
        cr18c_extrnalparty_status: statusChoice,
      } as Omit<Erc_externalpartiesBase, "erc_externalpartyid">,
      {
        erc_partyname: party.name,
        erc_officialemail: party.email,
        erc_domain: party.domain,
        erc_category: categoryChoice(party.category),
        erc_defaultpriority: defaultPriorityChoice(party.criticality),
      } as Omit<Erc_externalpartiesBase, "erc_externalpartyid">,
    ];
    let id: string | undefined;
    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const created = await createExternalParty(attempt);
        id = created.id || await findCreatedPartyId(party.name, party.email);
        if (id) break;
        errors.push("Create returned no record id.");
      } catch (err) {
        errors.push(dataverseMessage(err) || "Create failed.");
      }
    }
    if (!id) {
      throw new Error(errors.filter(Boolean).pop() || "Dataverse did not save the External Party. Check required columns and try again.");
    }
    party.id = id;
    try {
      await Erc_externalpartiesService.update(id, {
        cr18c_extrnalparty_status: statusChoice,
        ...buBind,
      });
    } catch { /* party exists; status/BU can be completed by the flow or a later edit */ }
    try {
      const live = await Erc_externalpartiesService.get(party.id);
      if (live.data) {
        const mapped = mapParty(live.data);
        Object.assign(party, mapped, {
          status: mapped.status || party.status,
          criticality: mapped.criticality || party.criticality,
          ...applyUnitName({
            bu: mapped.bu || party.bu,
            buId: mapped.buId || party.buId,
          }, store.businessUnits),
        });
      }
    } catch { /* keep submitted values */ }
  }
  store = { ...store, parties: [party, ...store.parties] };
  emit();
  return party;
}

export async function addComm(input: Omit<Communication, "id" | "recordId" | "log" | "ev" | "type" | "createdOn" | "isOverdue" | "isEscalated" | "isAutomaticallyEscalated" | "isManuallyEscalated"> & Partial<Communication>) {
  const createdOn = input.createdOn || toIso(new Date());
  const rec = input.rec || dateOnly(createdOn) || todayIso();
  const due = input.due || dueFromCreated(createdOn);
  const rule = findSla(input.cat, input.pri);
  const party = store.parties.find((p) => p.name === input.party || p.id === input.partyId);
  const row: Communication = applyFormulaFields({
    ...input,
    id: nextLocalCommId(),
    recordId: "",
    rec,
    due,
    createdOn,
    partyId: input.partyId || party?.id,
    slaId: input.slaId || rule?.id,
    slaName: input.slaName || rule?.name,
    ev: input.ev ?? 0,
    type: input.type || "Inbound",
    emailSubject: input.emailSubject || input.subj,
    isOverdue: false,
    isEscalated: input.isEscalated ?? false,
    isAutomaticallyEscalated: input.isAutomaticallyEscalated ?? false,
    isManuallyEscalated: input.isManuallyEscalated ?? false,
    log: input.log || [
      { title: "Communication created from email activity", meta: `${nowStamp()} — due ${due} (Created On + 2 hours)` },
    ],
  });
  if (store.source === "dataverse") {
    const payload = {
      erc_subject: row.subj,
      erc_communicationtype: commTypeInbound(),
      erc_lifecyclestatus: lifecycleChoice(row.status),
      erc_slastatus: slaStatusChoice(slaState(row)),
      erc_receiveddate: isoDateTime(row.rec),
      erc_responsesummary: row.respAction || row.resp,
      ...extraCommFields(row),
      ...(row.partyId ? { "erc_ExternalParty@odata.bind": `/erc_externalparties(${row.partyId})` } : { erc_category: categoryChoice(row.cat) }),
      ...(row.slaId && !row.slaId.startsWith("S") ? { "erc_SLARule@odata.bind": `/erc_sla2s(${row.slaId})` } : {}),
    } as unknown as Omit<Erc_communicationsBase, "erc_communicationid">;
    try {
      const created = await Erc_communicationsService.create(payload);
      if (created.data) {
        const live = await commFromDataverse(created.data.erc_communicationid, row);
        Object.assign(row, live);
      }
    } catch {
      const created = await Erc_communicationsService.create({
        erc_subject: row.subj,
        erc_communicationtype: commTypeInbound(),
        erc_lifecyclestatus: lifecycleChoice(row.status),
        erc_receiveddate: isoDateTime(row.rec),
      } as Omit<Erc_communicationsBase, "erc_communicationid">);
      if (created.data) {
        const live = await commFromDataverse(created.data.erc_communicationid, row);
        Object.assign(row, live);
      }
    }
  } else {
    row.recordId = row.id;
  }
  store = { ...store, comms: [row, ...store.comms] };
  emit();
  return row;
}

export async function addDoc(input: Omit<License, "id" | "recordId">) {
  const expiry = input.expiry;
  const row: License = applyLicenseFormulas({
    ...input,
    id: nextLocalDocId(),
    recordId: "",
    reminderThreshold: input.reminderThreshold || DEFAULT_REMINDER_THRESHOLD,
    reminderSent: false,
    isEscalated: false,
  });
  const party = store.parties.find((p) => p.name === input.party || p.id === input.partyId);
  const unit = store.businessUnits.find((u) => u.id === input.buId || u.name === input.bu);
  row.partyId = input.partyId || party?.id;
  row.buId = input.buId || unit?.id;
  row.bu = unit?.name || input.bu;
  if (store.source === "dataverse") {
    const created = await Erc_licenseandcontractsService.create({
      erc_licenseandcontract1: row.name,
      erc_documenttype: docTypeChoice(row.type),
      erc_expirydate: isoDateTime(row.expiry) || row.expiry,
      erc_issuedate: isoDateTime(row.issue),
      erc_risklevel: riskChoice(row.risk),
      erc_renewalstatus: renewalChoice("Not Started"),
      erc_active: true,
      erc_daysremaining: row.daysRemaining ?? daysBetween(todayIso(), expiry),
      erc_reminderthreshold: thresholdOf(row),
      erc_remindersent: false,
      erc_isescalated: false,
      erc_documentnumber: row.id,
      ...(row.partyId ? { "erc_ExternalParty@odata.bind": `/erc_externalparties(${row.partyId})` } : {}),
      ...(row.buId && isGuid(row.buId) ? { "erc_BusinessUnit@odata.bind": `/businessunits(${row.buId})` } : {}),
    } as Omit<Erc_licenseandcontractsBase, "erc_licenseandcontractid">);
    if (created.data) {
      row.recordId = created.data.erc_licenseandcontractid;
      Object.assign(row, applyLicenseFormulas({ ...row, ...mapDoc(created.data), recordId: created.data.erc_licenseandcontractid }));
    }
  } else {
    row.recordId = row.id;
  }
  store = { ...store, docs: [row, ...store.docs] };
  emit();
  if (isThresholdReached(row)) await runLicenseMonitor();
  return row;
}

export async function ingestEmail(mail: IntakeEmail) {
  if (mail.to && !isCentralMailbox(mail.to)) {
    store = {
      ...store,
      intake: store.intake.map((x) => x.id === mail.id ? { ...x, status: "In Review" } : x),
    };
    emit();
    return { kind: "ignored" as const, mail };
  }
  const thread = findThread(store.comms, mail);
  if (thread) {
    log(thread, "Reply attached to existing thread", `${mail.recv} — ${mail.from} · ${mail.subj}`);
    const next = { ...thread, log: thread.log };
    store = {
      ...store,
      comms: store.comms.map((c) => c.id === next.id || c.recordId === next.recordId ? next : c),
      intake: store.intake.map((x) => x.id === mail.id ? { ...x, status: "Routed", commId: next.id, threadAction: "Attached" } : x),
    };
    emit();
    return { kind: "attached" as const, comm: next, mail };
  }
  const party = store.parties.find((p) => p.name === mail.match) || matchPartyByEmail(mail.from);
  const parsed = new Date(mail.recv.replace(" ", "T"));
  const createdOn = Number.isNaN(parsed.getTime()) ? toIso(new Date()) : toIso(parsed);
  const comm = await addComm({
    party: party?.name || "",
    partyId: party?.id,
    cat: party?.category || mail.cat,
    subj: mail.subj,
    emailSubject: mail.subj,
    owner: mail.owner || party?.owner || ME,
    sup: "",
    pri: party ? mail.pri : "None",
    rec: dateOnly(mail.recv) || todayIso(),
    createdOn,
    due: "",
    status: "In Progress",
    bu: party?.bu || "",
    conversationIndex: mail.conversationIndex,
    threadId: mail.conversationIndex,
    emailActivityId: mail.id,
    log: [
      { title: "Email received on central mailbox (Dataverse email)", meta: `${mail.recv} — ${mail.from} → ${mail.to || MAILBOX_MAHA}` },
      { title: party ? "Sender matched to External Party Master" : "Unmatched sender — review required", meta: party?.name || mail.from },
      { title: "New thread — Communication created", meta: `${nowStamp()} — due date = Created On + 2 hours` },
    ],
  });
  store = {
    ...store,
    intake: store.intake.map((x) => x.id === mail.id ? { ...x, status: "Routed", commId: comm.id, threadAction: "Created", match: party?.name || x.match } : x),
  };
  emit();
  return { kind: "created" as const, comm, mail };
}

export async function routeEmail(mail: IntakeEmail, opts: { party: string; cat: Category; pri: Priority; owner: string; sup: string; bu: string }) {
  const existing = store.intake.find((x) => x.id === mail.id);
  const current = existing || mail;
  current.match = opts.party;
  current.cat = opts.cat;
  current.pri = opts.pri;
  current.owner = opts.owner;
  const result = await ingestEmail({ ...current, match: opts.party, cat: opts.cat, pri: opts.pri, owner: opts.owner });
  if (result.kind === "created" || result.kind === "attached") {
    const row = result.comm;
    const next = { ...row, owner: opts.owner, sup: opts.sup, bu: opts.bu, cat: opts.cat, pri: opts.pri };
    await persistComm(next, {});
    return replaceComm(next);
  }
  throw new Error("Email was not ingested — mailbox filter did not match the central mailbox");
}

export async function simulateInboundEmail(from: string, subj: string, opts: { to?: string; inReplyTo?: string; conversationIndex?: string } = {}) {
  const party = matchPartyByEmail(from);
  const cat = party?.category || guessCategory(from, subj);
  const pri = party?.criticality === "Low" ? "Low" : party?.criticality === "Medium" ? "Medium" : cat === "Legal" || cat === "Government" ? "Critical" : "High";
  const mail: IntakeEmail = {
    id: `EML-${Date.now()}`,
    recv: nowStamp(),
    from,
    to: opts.to || MAILBOX_MAHA,
    subj,
    match: party?.name || "",
    cat,
    pri: asPriority(pri),
    owner: party?.owner || "Mariam Alaa",
    status: "New",
    inReplyTo: opts.inReplyTo,
    conversationIndex: opts.conversationIndex || (opts.inReplyTo ? store.comms.find((c) => c.id === opts.inReplyTo || c.recordId === opts.inReplyTo)?.conversationIndex : undefined) || `thread-EML-${Date.now()}`,
  };
  store = { ...store, intake: [mail, ...store.intake] };
  emit();
  await ingestEmail(mail);
  return mail;
}

function guessCategory(from: string, subj: string): Category {
  const blob = `${from} ${subj}`.toLowerCase();
  if (blob.includes("legal") || blob.includes("notice") || blob.includes("إخطار")) return "Legal";
  if (blob.includes("gov.eg") || blob.includes("ministry") || blob.includes("mohp")) return "Government";
  if (blob.includes("eda") || blob.includes("gahar") || blob.includes("license") || blob.includes("ترخيص")) return "Regulatory";
  if (blob.includes("claim") || blob.includes("insurance") || blob.includes("metlife") || blob.includes("axa")) return "Insurance";
  if (blob.includes("partner") || blob.includes("referral")) return "Partner";
  return "Corporate";
}

export async function setCommStatus(id: string, status: CommStatus, extra: Partial<Communication> = {}) {
  const current = findComm(id);
  if (!current) throw new Error("Communication not found");
  const next = applyFormulaFields({ ...current, ...extra, status });
  if (store.source === "dataverse" && next.recordId) {
    await persistComm(next, {
      erc_lifecyclestatus: lifecycleChoice(status),
      erc_responsesummary: next.respAction || next.resp,
    });
  }
  return replaceComm(next);
}

export async function saveComm(id: string, extra: Partial<Communication>) {
  const current = findComm(id);
  if (!current) throw new Error("Communication not found");
  if (commLocked(current) && extra.status !== "In Progress") throw new Error("Record is closed");
  const next = applyFormulaFields({ ...current, ...extra });
  const partyId = extra.partyId !== undefined ? extra.partyId : next.partyId;
  const party = store.parties.find((p) => sameId(p.id, partyId) || p.name === next.party);
  if (party) {
    next.partyId = party.id;
    next.party = party.name;
    if (store.source !== "dataverse") {
      next.cat = party.category;
      next.bu = party.bu;
      next.categoryAssigned = true;
    }
  } else if (!partyId) {
    next.partyId = undefined;
    next.party = "";
    if (extra.cat) next.categoryAssigned = true;
  }
  await persistComm(next, {
    erc_lifecyclestatus: lifecycleChoice(next.status),
    erc_subject: next.subj,
    erc_emailsubject: next.emailSubject || next.subj,
    erc_description: next.description,
    ...(next.partyId && !String(next.partyId).startsWith("P") ? { "erc_ExternalParty@odata.bind": `/erc_externalparties(${next.partyId})` } : {}),
    ...(!next.partyId && extra.cat ? { erc_category: categoryChoice(next.cat) } : {}),
  });
  if (store.source === "dataverse" && next.recordId) {
    const fresh = await commFromDataverse(next.recordId, next);
    return replaceComm({
      ...fresh,
      party: next.party || fresh.party,
      partyId: next.partyId || fresh.partyId,
      bu: fresh.bu,
      pri: fresh.pri,
      cat: fresh.cat,
      categoryAssigned: fresh.categoryAssigned,
    });
  }
  return replaceComm(next);
}

export function isUnmatchedComm(row: Communication) {
  return !row.partyId;
}

export function unmatchedComms(includeClosed = false) {
  return store.comms.filter((c) => !c.partyId && (includeClosed || c.status !== "Closed"));
}

export function unmatchedIntake() {
  return store.intake.filter((x) => !x.match && x.status !== "Routed");
}

export async function linkCommToParty(id: string, partyId: string) {
  const party = store.parties.find((p) => sameId(p.id, partyId));
  if (!party) throw new Error("External party not found");
  const current = findComm(id);
  if (!current) throw new Error("Communication not found");
  log(current, "Linked to External Party Master", `${nowStamp()} — ${party.name}`);
  return saveComm(current.id, { partyId: party.id, party: party.name, log: current.log });
}

export async function assignCommCategory(id: string, cat: Category) {
  const current = findComm(id);
  if (!current) throw new Error("Communication not found");
  if (current.partyId) throw new Error("Category follows the linked External Party");
  log(current, "Category set without External Party", `${nowStamp()} — ${cat}`);
  return saveComm(current.id, { cat, partyId: "", party: "", log: current.log });
}

export async function resolveUnmatchedEmail(mail: IntakeEmail, opts: { partyId?: string; cat?: Category }) {
  if (opts.partyId) {
    const party = store.parties.find((p) => sameId(p.id, opts.partyId));
    if (!party) throw new Error("External party not found");
    return routeEmail(mail, {
      party: party.name,
      cat: party.category,
      pri: party.criticality === "Low" ? "Low" : party.criticality === "Medium" ? "Medium" : "High",
      owner: party.owner || ME,
      sup: "",
      bu: party.bu,
    });
  }
  if (!opts.cat) throw new Error("Choose an External Party or a category");
  const result = await ingestEmail({ ...mail, match: "", cat: opts.cat, pri: "None" });
  if (result.kind === "ignored") throw new Error("Email was not ingested — mailbox filter did not match the central mailbox");
  if (result.kind === "attached" || result.kind === "created") {
    if (!result.comm.partyId) await assignCommCategory(result.comm.id, opts.cat);
    return result.comm;
  }
  throw new Error("Email was not ingested");
}

export async function tickFormulas(now = new Date()) {
  if (store.source === "dataverse") {
    try {
      const comms = await Erc_communicationsService.getAll({ top: 250, orderBy: ["createdon desc"] });
      store = { ...store, comms: await resolveMissingOwners((comms.data || []).map(mapComm).map((row) => fillPartyDisplay(row))) };
      emit();
    } catch { /* keep the last loaded formula values */ }
    return;
  }
  store = {
    ...store,
    comms: store.comms.map((c) => applyFormulaFields(c, now)),
    docs: store.docs.map((d) => applyLicenseFormulas(d)),
  };
  emit();
  await runAutomaticEscalation(now);
}

export async function runAutomaticEscalation(now = new Date()) {
  if (store.source === "dataverse") {
    await hydrate(true);
    return 0;
  }
  const refreshed = store.comms.map((c) => applyFormulaFields(c, now));
  const targets = refreshed.filter((c) => canAutoEscalate(c));
  const nextRows = targets.map((row) => applyFormulaFields(automaticEscalationPatch(row, now)));
  const byId = new Map(nextRows.map((r) => [r.recordId || r.id, r]));
  store = {
    ...store,
    comms: refreshed.map((c) => byId.get(c.recordId) || byId.get(c.id) || c),
  };
  emit();
  return nextRows.length;
}

export async function escalateManually(
  id: string,
  reason: string,
  by = ME,
  extras: { closedBy?: string; closureComment?: string } = {},
) {
  const current = findComm(id);
  if (!current) throw new Error("Communication not found");
  if (!canManualEscalate(current)) {
    throw new Error("This communication is already escalated. Manual escalation can run only once.");
  }
  const reasonText = reason.trim();
  if (!reasonText) throw new Error("Escalation reason is required");
  const key = current.recordId || current.id;
  if (escalatingIds.has(key)) throw new Error("Escalation is already running for this record");
  escalatingIds.add(key);
  const next = applyFormulaFields(manualEscalationPatch(current, reasonText, by, {
    closedBy: extras.closedBy?.trim() || current.closedBy,
    closureComment: extras.closureComment?.trim() || current.closureComment,
  }));
  replaceComm(next);
  try {
    await persistComm(next, {
      erc_ismanuallyescalated: true,
      erc_isescalated: true,
      erc_escalationreason: next.escalationReason,
    });
    if (next.closureComment || extras.closedBy) {
      try {
        await persistComm(next, {
          ...(next.closureComment ? { erc_closurecomment: next.closureComment } : {}),
          ...(await closedByBind(extras.closedBy || next.closedBy || "")),
        });
      } catch { /* lock is already written; closure stamps are optional */ }
    }
    if (store.source === "dataverse" && next.recordId) {
      const fresh = await commFromDataverse(next.recordId, next);
      return replaceComm({
        ...fresh,
        closedBy: fresh.closedBy || next.closedBy,
        closureComment: fresh.closureComment || next.closureComment,
        isManuallyEscalated: true,
        isEscalated: true,
        isAutomaticallyEscalated: false,
        escalationReason: next.escalationReason,
        escalatedBy: next.escalatedBy,
      });
    }
    return next;
  } catch (err) {
    replaceComm(current);
    throw err;
  } finally {
    escalatingIds.delete(key);
  }
}

export async function respondToComm(id: string, message: string, channel: string) {
  const current = findComm(id);
  if (!current || commLocked(current)) throw new Error("Record is closed");
  const stamp = nowStamp();
  log(current, `Response sent by ${channel}`, `${stamp} — ${message.slice(0, 80)}`);
  return setCommStatus(current.id, "In Progress", {
    resp: stamp,
    respAction: message.slice(0, 120),
    log: current.log,
  });
}

export async function closeComm(id: string, comment: string, evidenceCount?: number) {
  const current = findComm(id);
  if (!current || commLocked(current)) throw new Error("Record is closed");
  let emails = threadEmails(current);
  if (!emails.length) emails = await loadCommThread(current);
  const count = evidenceCount ?? emails.length;
  if (needsEvidence(current.cat) && count < 1) {
    throw new Error(`${current.cat} records cannot be closed without an email on the thread`);
  }
  if (count < 1) throw new Error("No emails on this thread yet. Evidence comes from the Emails table.");
  if (!comment.trim()) throw new Error("A closure comment is required");
  const commentText = comment.trim();
  const next = store.source === "dataverse"
    ? applyFormulaFields({
        ...current,
        status: "Closed",
        closureComment: commentText,
        ev: count,
        log: [
          ...current.log,
          { title: FLOWS.captureClosed.name, meta: `${nowStamp()} — ${FLOWS.captureClosed.filter}` },
        ],
      })
    : applyFormulaFields({ ...closureFromFlow(current, commentText, ME), ev: count });
  await persistComm(next, {
    erc_lifecyclestatus: lifecycleChoice("Closed"),
    erc_closurecomment: next.closureComment,
  });
  return replaceComm(next);
}

export async function reopenComm(id: string, reason: string) {
  const current = store.comms.find((c) => c.id === id || c.recordId === id);
  if (!current) throw new Error("Communication not found");
  log(current, "Record reopened", `${nowStamp()} — ${reason}`);
  return setCommStatus(current.id, "In Progress", { closed: "", log: current.log });
}

export async function startWork(id: string) {
  const current = store.comms.find((c) => c.id === id || c.recordId === id);
  if (!current || commLocked(current) || current.status === "In Progress") return current;
  log(current, "Owner started work", nowStamp());
  return setCommStatus(current.id, "In Progress", { log: current.log });
}

export function addEvidence(rel: string, name: string, by: string) {
  const file: EvidenceFile = { id: `F${Date.now()}`, name, rel, date: todayIso(), by };
  const comms = store.comms.map((c) => {
    if (c.id !== rel && c.recordId !== rel) return c;
    log(c, "Evidence uploaded", `${file.date} — ${file.name}`);
    return { ...c, ev: c.ev + 1, log: c.log };
  });
  store = { ...store, files: [file, ...store.files], comms };
  emit();
  return file;
}

export async function renewDoc(id: string) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current || docLocked(current)) throw new Error("Renewal cycle is closed");
  const old = current.expiry;
  const next = applyLicenseFormulas({
    ...current,
    issue: old,
    expiry: addDays(old, 365),
    status: "Renewed",
    done: todayIso(),
    notified: current.notified || nowStamp(),
    reminderSent: false,
    isEscalated: false,
    escalationReason: "",
    isOverdue: false,
  });
  await persistLicense(next, {
    erc_issuedate: isoDateTime(next.issue),
    erc_expirydate: isoDateTime(next.expiry),
    erc_renewalstatus: renewalChoice("Renewed"),
    erc_renewalcompleted: isoDateTime(next.done),
    erc_lastnotified: isoDateTime(dateOnly(next.notified)),
    erc_daysremaining: next.daysRemaining,
    erc_risklevel: riskChoice(next.risk),
    erc_remindersent: false,
    erc_isescalated: false,
  });
  await completeOpenRenewal(next);
  return replaceDoc(next);
}

export async function completeCycle(id: string) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current) throw new Error("Document not found");
  const next = applyLicenseFormulas({
    ...current,
    done: todayIso(),
    status: "Renewed",
    isOverdue: false,
    reminderSent: true,
  });
  await persistLicense(next, {
    erc_renewalcompleted: isoDateTime(next.done),
    erc_renewalstatus: renewalChoice("Renewed"),
    erc_daysremaining: next.daysRemaining,
    erc_risklevel: riskChoice(next.risk),
  });
  await completeOpenRenewal(next);
  return replaceDoc(next);
}

export async function sendRenewalNotice(id: string) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current) throw new Error("Document not found");
  const forced: License = { ...current, reminderSent: false };
  store = { ...store, docs: store.docs.map((d) => d.recordId === forced.recordId || d.id === forced.id ? forced : d) };
  await runLicenseMonitor();
  return store.docs.find((d) => d.id === id || d.recordId === id) || forced;
}

export async function reopenDoc(id: string) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current) throw new Error("Document not found");
  const next = applyLicenseFormulas({
    ...current,
    done: "",
    status: "",
    reminderSent: false,
    isEscalated: false,
    escalationReason: "",
  });
  await persistLicense(next, {
    erc_renewalcompleted: undefined,
    erc_renewalstatus: renewalChoice("In Progress"),
    erc_remindersent: false,
    erc_isescalated: false,
    erc_daysremaining: next.daysRemaining,
    erc_risklevel: riskChoice(next.risk),
  });
  return replaceDoc(next);
}

export async function escalateLicense(id: string, reason: string, by = ME) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current) throw new Error("Document not found");
  if (current.isEscalated) throw new Error("This document is already escalated");
  const reasonText = reason.trim();
  if (!reasonText) throw new Error("Escalation reason is required");
  await escalateLicenseRecord(current, reasonText, by);
  return store.docs.find((d) => d.id === id || d.recordId === id) || current;
}

export async function markNoticeRead(id: string) {
  const current = store.notices.find((n) => n.id === id || n.recordId === id);
  if (!current || current.isRead) return current;
  const next: Notice = { ...current, isRead: true };
  if (store.source === "dataverse" && isGuid(next.recordId)) {
    await Erc_notificationsService.update(next.recordId, { erc_isread: true });
  }
  store = { ...store, notices: store.notices.map((n) => n.recordId === next.recordId || n.id === next.id ? next : n) };
  emit();
  return next;
}

async function persistLicense(row: License, fields: Partial<Erc_licenseandcontractsBase> = {}) {
  if (store.source !== "dataverse" || !isGuid(row.recordId)) return;
  await Erc_licenseandcontractsService.update(row.recordId, fields);
}

async function persistRenewal(row: Renewal, fields: Partial<Omit<Erc_renewalsBase, "erc_renewalid">> = {}) {
  if (store.source !== "dataverse" || !isGuid(row.recordId)) return;
  await Erc_renewalsService.update(row.recordId, fields);
}

async function completeOpenRenewal(doc: License) {
  const open = openRenewalFor(doc, store.renewals);
  if (!open) return;
  const next: Renewal = { ...open, status: "Completed", completed: todayIso() };
  await persistRenewal(next, {
    erc_renewalstatus: renewalTaskStatusChoice("Completed"),
    erc_completiondate: isoDateTime(next.completed),
  });
  store = { ...store, renewals: store.renewals.map((r) => r.recordId === next.recordId || r.id === next.id ? next : r) };
  emit();
}

async function createRenewalTask(doc: License): Promise<Renewal> {
  const ownerId = store.source === "dataverse" ? await userIdByName(doc.owner) : undefined;
  const row: Renewal = {
    id: nextLocalRenewalId(),
    recordId: "",
    documentId: doc.recordId || doc.id,
    documentName: doc.name,
    type: doc.type,
    status: "Open",
    due: doc.expiry,
    risk: doc.risk,
    owner: doc.owner,
    ownerId,
    reminderDate: todayIso(),
    reminderCount: 1,
    escalation: "Not Escalated",
    notes: `Created at ${thresholdOf(doc)}-day reminder threshold`,
  };
  if (store.source === "dataverse" && isGuid(doc.recordId)) {
    const created = await Erc_renewalsService.create({
      erc_newcolumn: clip100(`Renewal — ${doc.name}`),
      erc_renewaltype: renewalTypeChoice(doc.type),
      erc_renewalstatus: renewalTaskStatusChoice("Open"),
      erc_risklevel: renewalRiskChoice(doc.risk),
      erc_duedate: isoDateTime(doc.expiry),
      erc_reminderdate: isoDateTime(todayIso()),
      erc_remindercount: 1,
      erc_escalationstatus: escalationChoice("Not Escalated"),
      erc_renewalnotes: clip100(row.notes || ""),
      "erc_Licenseandcontract@odata.bind": `/erc_licenseandcontracts(${doc.recordId})`,
      ...(ownerId ? { "erc_Owner@odata.bind": `/systemusers(${ownerId})` } : {}),
    } as Omit<Erc_renewalsBase, "erc_renewalid">);
    if (created.data) {
      row.recordId = created.data.erc_renewalid;
      Object.assign(row, mapRenewal(created.data));
    }
  } else {
    row.recordId = row.id;
  }
  store = { ...store, renewals: [row, ...store.renewals] };
  emit();
  return row;
}

async function logNotice(type: NoticeType, doc: License, renewal?: Renewal) {
  const days = doc.daysRemaining ?? 0;
  const row: Notice = {
    id: nextLocalNoticeId(),
    recordId: "",
    title: noticeTitle(type, doc),
    type,
    documentId: doc.recordId || doc.id,
    documentName: doc.name,
    renewalId: renewal?.recordId || renewal?.id,
    renewalName: renewal?.id,
    sentOn: new Date().toISOString(),
    result: "Sent",
    message: noticeMessage(type, doc, days),
    isRead: false,
    owner: doc.owner,
  };
  if (store.source === "dataverse" && isGuid(doc.recordId)) {
    const created = await Erc_notificationsService.create({
      erc_notificationtitle: clip100(row.title),
      erc_notificationtype: noticeTypeChoice(type),
      erc_senton: row.sentOn,
      erc_result: noticeResultChoice("Sent"),
      erc_message: clip100(row.message || ""),
      erc_notificationmessage: clip100(row.message || ""),
      erc_isread: false,
      "erc_LicenseandContract@odata.bind": `/erc_licenseandcontracts(${doc.recordId})`,
      ...(renewal && isGuid(renewal.recordId) ? { "erc_Renewal@odata.bind": `/erc_renewals(${renewal.recordId})` } : {}),
    } as Omit<Erc_notificationsBase, "erc_notificationid">);
    if (created.data) {
      row.recordId = created.data.erc_notificationid;
      Object.assign(row, mapNotice(created.data));
    }
  } else {
    row.recordId = row.id;
  }
  store = { ...store, notices: [row, ...store.notices] };
  emit();
  return row;
}

async function escalateLicenseRecord(doc: License, reason: string, by: string) {
  const next: License = {
    ...doc,
    isEscalated: true,
    escalatedBy: by,
    escalationReason: clip100(reason),
    risk: "Critical",
    status: doc.isOverdue ? "Expired" : doc.status,
  };
  const userId = store.source === "dataverse" ? await userIdByName(by) : undefined;
  const patch: Partial<Erc_licenseandcontractsBase> = {
    erc_isescalated: true,
    erc_escalationreason: next.escalationReason,
    erc_risklevel: riskChoice("Critical"),
  };
  if (next.status === "Expired") patch.erc_renewalstatus = renewalChoice("Expired");
  if (userId) patch["erc_EscalatedBy@odata.bind"] = `/systemusers(${userId})`;
  await persistLicense(next, patch);
  replaceDoc(next);
  const open = openRenewalFor(next, store.renewals);
  if (open) {
    const updated: Renewal = { ...open, escalation: "L1", status: next.isOverdue ? "Overdue" : open.status, risk: "Critical" };
    await persistRenewal(updated, {
      erc_escalationstatus: escalationChoice("L1"),
      erc_renewalstatus: renewalTaskStatusChoice(updated.status),
      erc_risklevel: renewalRiskChoice("Critical"),
    });
    store = { ...store, renewals: store.renewals.map((r) => r.recordId === updated.recordId || r.id === updated.id ? updated : r) };
    emit();
    await logNotice("Escalation", next, updated);
  } else {
    await logNotice("Escalation", next);
  }
}

export async function runLicenseMonitor() {
  if (licenseMonitorRunning) return { renewals: 0, notices: 0, escalations: 0 };
  licenseMonitorRunning = true;
  const result = { renewals: 0, notices: 0, escalations: 0 };
  try {
    const docs = store.docs.map((d) => applyLicenseFormulas(d));
    store = { ...store, docs };
    emit();
    for (const raw of docs) {
      try {
      if (isLicenseClosed(raw)) continue;
      let doc = applyLicenseFormulas(raw);
      await persistLicense(doc, {
        erc_daysremaining: doc.daysRemaining,
        erc_risklevel: riskChoice(doc.risk),
        ...(doc.isOverdue ? { erc_renewalstatus: renewalChoice("Expired") } : {}),
      });
      replaceDoc(doc);

      if (doc.isOverdue) {
        const open = openRenewalFor(doc, store.renewals);
        if (open && open.status !== "Overdue") {
          const overdue: Renewal = { ...open, status: "Overdue", risk: "Critical" };
          await persistRenewal(overdue, {
            erc_renewalstatus: renewalTaskStatusChoice("Overdue"),
            erc_risklevel: renewalRiskChoice("Critical"),
          });
          store = { ...store, renewals: store.renewals.map((r) => r.recordId === overdue.recordId || r.id === overdue.id ? overdue : r) };
          emit();
        }
        if (!doc.reminderSent) {
          const renewal = open || await createRenewalTask(doc);
          if (!open) result.renewals += 1;
          await logNotice("Expiry", doc, renewal);
          result.notices += 1;
          doc = {
            ...doc,
            reminderSent: true,
            notified: nowStamp(),
            currentRenewalId: renewal.recordId,
            currentRenewalName: renewal.documentName,
          };
          await persistLicense(doc, {
            erc_remindersent: true,
            erc_lastnotified: isoDateTime(todayIso()),
            erc_renewalstatus: renewalChoice("Expired"),
            ...(isGuid(renewal.recordId) ? { "erc_CurrentRenewal@odata.bind": `/erc_renewals(${renewal.recordId})` } : {}),
          });
          replaceDoc(doc);
        }
        if (!doc.isEscalated) {
          await escalateLicenseRecord(doc, "Expiry reached without renewal completion", "System (Expiry Monitor)");
          result.escalations += 1;
        }
        continue;
      }

      if (!isThresholdReached(doc) || doc.reminderSent) continue;
      let renewal = openRenewalFor(doc, store.renewals);
      if (!renewal) {
        renewal = await createRenewalTask(doc);
        result.renewals += 1;
      }
      await logNotice("Reminder", doc, renewal);
      result.notices += 1;
      doc = {
        ...doc,
        reminderSent: true,
        notified: nowStamp(),
        currentRenewalId: renewal.recordId,
        currentRenewalName: renewal.documentName,
        status: doc.status || "In Progress",
      };
      await persistLicense(doc, {
        erc_remindersent: true,
        erc_lastnotified: isoDateTime(todayIso()),
        erc_renewalstatus: renewalChoice("In Progress"),
        ...(isGuid(renewal.recordId) ? { "erc_CurrentRenewal@odata.bind": `/erc_renewals(${renewal.recordId})` } : {}),
      });
      replaceDoc(doc);
      } catch {
        /* continue remaining documents */
      }
    }
  } finally {
    licenseMonitorRunning = false;
  }
  return result;
}

export const ME = "Mariam Alaa";
export { addDays, daysBetween, slaState, docState, todayIso, nowStamp, needsEvidence, applyFormulaFields, summarizeMonitor };
export { communicationDeepLink, communicationPlayUrl, parseCommunicationDeepLink, copyText, COMM_DEEP_LINK_PARAM, cleanRecordGuid, setHostQueryParams } from "./deeplink";
export { canAutoEscalate, canManualEscalate, isAlreadyEscalated, formatDateTime, overdueLabel, escalatedLabel, yesNo, OVERDUE_HOURS } from "./communicationLogic";
export { DEFAULT_REMINDER_THRESHOLD, thresholdOf, unreadNotices } from "./licenseLogic";
export const TODAY = todayIso();
