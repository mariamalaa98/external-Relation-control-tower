import { useSyncExternalStore } from "react";
import { SEED } from "./seed";
import type { BusinessUnitRef, Category, CommStatus, Communication, EmailAttachment, EvidenceFile, IntakeEmail, License, Party, Priority, SlaRule, Store, ThreadEmail } from "./types";
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
  mapComm,
  mapDoc,
  mapParty,
  mapRenewal,
  mapSla,
  needsEvidence,
  nowStamp,
  renewalChoice,
  riskChoice,
  senderDomain,
  slaState,
  slaStatusChoice,
  todayIso,
} from "./mappers";
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
import { Erc_renewalsService } from "../generated/services/Erc_renewalsService";
import { Erc_sla2sService } from "../generated/services/Erc_sla2sService";
import { SystemusersService } from "../generated/services/SystemusersService";
import type { Erc_communicationsBase } from "../generated/models/Erc_communicationsModel";
import type { Erc_externalpartiesBase } from "../generated/models/Erc_externalpartiesModel";
import type { Erc_licenseandcontractsBase } from "../generated/models/Erc_licenseandcontractsModel";
import { attachmentsFromEmailRecord, emailGetOptions, fetchAttachmentContent, listAttachmentsForEmails, mimeFromFileName } from "./emailAttachments";

let store: Store = { ...structuredClone(SEED), ready: false };
const listeners = new Set<() => void>();
const escalatingIds = new Set<string>();

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

function log(row: Communication, title: string, meta: string) {
  row.log = [...row.log, { title, meta }];
}

function findComm(id: string) {
  return store.comms.find((c) => c.id === id || c.recordId === id);
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

function fillPartyDisplay(row: Communication, parties: Party[] = store.parties): Communication {
  if (row.partyId) {
    const match = parties.find((p) => sameId(p.id, row.partyId) || p.name === row.party);
    if (match) return { ...row, party: match.name, partyId: match.id };
    return row;
  }
  if (row.party) {
    const match = parties.find((p) => p.name === row.party);
    if (match) return { ...row, partyId: match.id, party: match.name };
    return row;
  }
  return { ...row, party: "", pri: "None" };
}

async function commFromDataverse(id: string, fallback: Communication): Promise<Communication> {
  try {
    const got = await Erc_communicationsService.get(id);
    if (got.data) return fillPartyDisplay(mapComm(got.data));
  } catch { /* create response may omit formula columns */ }
  return fillPartyDisplay({ ...fallback, recordId: id, overdueFromColumn: true });
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
  const domain = senderDomain(email);
  return parties.find((p) => p.status === "Active" && p.email.toLowerCase() === email.toLowerCase())
    || parties.find((p) => p.status === "Active" && p.domain === domain);
}

function mapEmailToIntake(email: Emails, comms: Communication[], parties: Party[]): IntakeEmail {
  const sender = email.sender || "";
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
    to: email.torecipients || email.to || MAILBOX_PROD,
    subj: email.subject || "(no subject)",
    match: party?.name || "",
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

export async function hydrate(useDataverse: boolean) {
  if (!useDataverse) {
    store = {
      ...structuredClone(SEED),
      ready: true,
      source: "local",
      comms: structuredClone(SEED.comms).map((row) => applyFormulaFields(row)),
    };
    emit();
    if (store.source === "local") await runAutomaticEscalation();
    return;
  }
  try {
    const [parties, slas, comms, docs, renewals, units] = await Promise.all([
      Erc_externalpartiesService.getAll({ top: 250, orderBy: ["erc_partyname asc"] }),
      Erc_sla2sService.getAll({ top: 100 }),
      Erc_communicationsService.getAll({ top: 250, orderBy: ["createdon desc"] }),
      Erc_licenseandcontractsService.getAll({ top: 250, orderBy: ["erc_expirydate asc"] }),
      Erc_renewalsService.getAll({ top: 250, orderBy: ["erc_duedate asc"] }),
      BusinessunitsService.getAll({ top: 250, orderBy: ["name asc"] }).catch(() => ({ data: [] as { businessunitid: string; name: string }[] })),
    ]);
    const businessUnits: BusinessUnitRef[] = ((units as { data?: { businessunitid: string; name: string }[] }).data || [])
      .map((u) => ({ id: u.businessunitid, name: u.name }))
      .filter((u) => u.id && u.name);
    const mappedParties = (parties.data || []).map(mapParty).map((party) => {
      const unit = businessUnits.find((u) => u.id === party.buId);
      return unit ? { ...party, bu: party.bu || unit.name } : party;
    });
    const mappedSla = (slas.data || []).map(mapSla);
    const mappedComms = (comms.data || []).map(mapComm);
    const mappedDocs = (docs.data || []).map(mapDoc);
    const mappedRenewals = (renewals.data || []).map(mapRenewal);
    let intake: IntakeEmail[] = [];
    try {
      intake = await loadMailboxEmails(mappedComms, mappedParties);
    } catch {
      intake = [];
    }
    store = {
      source: "dataverse",
      ready: true,
      sla: mappedSla.length ? mappedSla : structuredClone(SEED.sla),
      parties: mappedParties,
      comms: mappedComms.map((row) => fillPartyDisplay(row, mappedParties)),
      docs: mappedDocs,
      renewals: mappedRenewals,
      intake,
      files: [],
      threadByComm: {},
      businessUnits,
    };
  } catch (err) {
    store = {
      ...structuredClone(SEED),
      ready: true,
      source: "local",
      comms: structuredClone(SEED.comms).map((row) => applyFormulaFields(row)),
      error: err instanceof Error ? err.message : "Dataverse is not available in this session.",
    };
    emit();
    await runAutomaticEscalation();
    return;
  }
  emit();
}

export async function refresh() {
  await hydrate(store.source === "dataverse");
}

export async function addParty(input: Omit<Party, "id" | "status"> & { status?: Party["status"] }) {
  const unit = store.businessUnits.find((u) => u.id === input.buId || u.name === input.bu);
  const party: Party = {
    ...input,
    id: `P${Date.now()}`,
    status: input.status || "Active",
    bu: unit?.name || input.bu,
    buId: unit?.id || input.buId,
  };
  if (store.source === "dataverse") {
    const payload = {
      erc_partyname: party.name,
      erc_officialemail: party.email,
      erc_domain: party.domain,
      erc_category: categoryChoice(party.category),
      erc_defaultpriority: defaultPriorityChoice(party.criticality),
      erc_priority: party.criticality === "Low" ? 4 : party.criticality === "Medium" ? 3 : 2,
      erc_active: true,
      ...(party.buId && !party.buId.startsWith("P") && /^[0-9a-f-]{36}$/i.test(party.buId) ? { "erc_BusinessUnit@odata.bind": `/businessunits(${party.buId})` } : {}),
    } as Omit<Erc_externalpartiesBase, "erc_externalpartyid">;
    let created;
    try {
      created = await Erc_externalpartiesService.create(payload);
    } catch {
      created = await Erc_externalpartiesService.create({
        erc_partyname: party.name,
        erc_officialemail: party.email,
        erc_domain: party.domain,
        erc_category: categoryChoice(party.category),
        erc_defaultpriority: defaultPriorityChoice(party.criticality),
        erc_active: true,
      } as Omit<Erc_externalpartiesBase, "erc_externalpartyid">);
      if (created.data && party.buId && /^[0-9a-f-]{36}$/i.test(party.buId)) {
        try {
          await Erc_externalpartiesService.update(created.data.erc_externalpartyid, {
            "erc_BusinessUnit@odata.bind": `/businessunits(${party.buId})`,
            erc_defaultpriority: defaultPriorityChoice(party.criticality),
            erc_priority: party.criticality === "Low" ? 4 : party.criticality === "Medium" ? 3 : 2,
          });
        } catch { /* party exists; lookup may be retried by the user */ }
      }
    }
    if (created.data) {
      party.id = created.data.erc_externalpartyid;
      try {
        const live = await Erc_externalpartiesService.get(party.id);
        if (live.data) {
          const mapped = mapParty(live.data);
          Object.assign(party, mapped, {
            criticality: mapped.criticality || party.criticality,
            bu: mapped.bu || party.bu,
            buId: mapped.buId || party.buId,
          });
        }
      } catch { /* keep submitted values */ }
    }
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
  const row: License = { ...input, id: nextLocalDocId(), recordId: "" };
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
      erc_daysremaining: daysBetween(todayIso(), row.expiry),
      erc_documentnumber: row.id,
      ...(row.partyId ? { "erc_ExternalParty@odata.bind": `/erc_externalparties(${row.partyId})` } : {}),
      ...(row.buId && /^[0-9a-f-]{36}$/i.test(row.buId) ? { "erc_BusinessUnit@odata.bind": `/businessunits(${row.buId})` } : {}),
    } as Omit<Erc_licenseandcontractsBase, "erc_licenseandcontractid">);
    if (created.data) {
      row.recordId = created.data.erc_licenseandcontractid;
      row.id = mapDoc(created.data).id;
    }
  } else {
    row.recordId = row.id;
  }
  store = { ...store, docs: [row, ...store.docs] };
  emit();
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
  } else if (!partyId) {
    next.partyId = undefined;
    next.party = "";
    next.pri = "None";
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
      party: fresh.party || next.party,
      partyId: fresh.partyId || next.partyId,
      pri: fresh.partyId || next.partyId ? fresh.pri : "None",
      cat: next.partyId ? fresh.cat : (extra.cat || fresh.cat),
      categoryAssigned: next.partyId ? fresh.categoryAssigned : (extra.cat ? true : fresh.categoryAssigned),
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
  return saveComm(current.id, { cat, partyId: "", party: "", pri: "None", log: current.log });
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
      store = { ...store, comms: (comms.data || []).map(mapComm) };
      emit();
    } catch { /* keep the last loaded formula values */ }
    return;
  }
  store = { ...store, comms: store.comms.map((c) => applyFormulaFields(c, now)) };
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
  const next: License = {
    ...current,
    issue: old,
    expiry: addDays(old, 365),
    status: "Renewed",
    done: todayIso(),
    notified: current.notified || nowStamp(),
    daysRemaining: 365,
  };
  if (store.source === "dataverse" && next.recordId) {
    await Erc_licenseandcontractsService.update(next.recordId, {
      erc_issuedate: isoDateTime(next.issue),
      erc_expirydate: isoDateTime(next.expiry),
      erc_renewalstatus: renewalChoice("Renewed"),
      erc_renewalcompleted: isoDateTime(next.done),
      erc_lastnotified: isoDateTime(dateOnly(next.notified)),
      erc_daysremaining: 365,
    });
  }
  store = { ...store, docs: store.docs.map((d) => d.recordId === next.recordId || d.id === next.id ? next : d) };
  emit();
  return next;
}

export async function completeCycle(id: string) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current) throw new Error("Document not found");
  const next: License = { ...current, done: todayIso(), status: current.status || "Renewed" };
  if (store.source === "dataverse" && next.recordId) {
    await Erc_licenseandcontractsService.update(next.recordId, {
      erc_renewalcompleted: isoDateTime(next.done),
      erc_renewalstatus: renewalChoice("Renewed"),
    });
  }
  store = { ...store, docs: store.docs.map((d) => d.recordId === next.recordId || d.id === next.id ? next : d) };
  emit();
  return next;
}

export async function sendRenewalNotice(id: string) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current) throw new Error("Document not found");
  const next: License = { ...current, notified: nowStamp() };
  if (store.source === "dataverse" && next.recordId) {
    await Erc_licenseandcontractsService.update(next.recordId, { erc_lastnotified: isoDateTime(todayIso()) });
  }
  store = { ...store, docs: store.docs.map((d) => d.recordId === next.recordId || d.id === next.id ? next : d) };
  emit();
  return next;
}

export async function reopenDoc(id: string) {
  const current = store.docs.find((d) => d.id === id || d.recordId === id);
  if (!current) throw new Error("Document not found");
  const next: License = { ...current, done: "", status: "" };
  if (store.source === "dataverse" && next.recordId) {
    await Erc_licenseandcontractsService.update(next.recordId, {
      erc_renewalcompleted: undefined,
      erc_renewalstatus: renewalChoice("In Progress"),
    });
  }
  store = { ...store, docs: store.docs.map((d) => d.recordId === next.recordId || d.id === next.id ? next : d) };
  emit();
  return next;
}

export const ME = "Mariam Alaa";
export { addDays, daysBetween, slaState, docState, todayIso, nowStamp, needsEvidence, applyFormulaFields };
export { canAutoEscalate, canManualEscalate, isAlreadyEscalated, formatDateTime, overdueLabel, escalatedLabel, yesNo, OVERDUE_HOURS } from "./communicationLogic";
export const TODAY = todayIso();
