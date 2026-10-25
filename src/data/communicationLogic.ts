import { CENTRAL_MAILBOX_ADDRESSES, type CommStatus, type Communication, type EscalationChain, type IntakeEmail } from "./types";
import { FLOWS, matchesAutoEscalationFilter } from "./flows";

/** Used when a chain row has no erc_waithours, matching the cloud flow. */
export const DEFAULT_LEVEL_WAIT_HOURS = 24;
/** Local preview cap when no Esclation Chain rows are loaded. */
const LOCAL_CHAIN_LEVELS = 5;

/** Prototype stand-in only. Live overdue is the Dataverse formula column erc_isoverdue (Created On + 2 hours). */
export const OVERDUE_HOURS = 2;

export function yesNoChoice(value?: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function extraCommFields(row: Communication) {
  return {
    erc_description: row.description,
    erc_emailsubject: row.emailSubject || row.subj,
    erc_isescalated: yesNoChoice(row.isEscalated),
    erc_ismanuallyescalated: yesNoChoice(row.isManuallyEscalated),
    erc_escalationreason: row.escalationReason,
    erc_closurecomment: row.closureComment,
    erc_caserefrence: row.caseRef || undefined,
  };
}

const CENTRAL_MAILBOXES = CENTRAL_MAILBOX_ADDRESSES.map((x) => x.toLowerCase());

export function parseDate(value?: string) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function toIso(value: Date) {
  return value.toISOString();
}

export function formatDateTime(value?: string) {
  const d = parseDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function addHours(value: string | Date, hours: number) {
  const d = typeof value === "string" ? parseDate(value) : new Date(value);
  if (!d) return "";
  d.setHours(d.getHours() + hours);
  return toIso(d);
}

export function dueFromCreated(createdOn?: string) {
  if (!createdOn) return "";
  return addHours(createdOn, OVERDUE_HOURS);
}

export function computeIsOverdue(row: Pick<Communication, "createdOn" | "status" | "closed">, now = new Date()) {
  const due = parseDate(dueFromCreated(row.createdOn));
  if (!due) return false;
  if (row.status === "Closed" && row.closed) {
    const closed = parseDate(row.closed);
    return !!closed && closed.getTime() > due.getTime();
  }
  return now.getTime() >= due.getTime();
}

function activeChain(chains: EscalationChain[], teamId?: string) {
  const active = chains.filter((row) => row.active && row.sequence > 0);
  if (!teamId) return active;
  const mine = active.filter((row) => row.teamId === teamId);
  return mine.length ? mine : active;
}

/** True when someone is still waiting on the level after `currentStep`. */
export function hasFollowingLevel(currentStep: number, chains: EscalationChain[] = [], teamId?: string) {
  const rows = activeChain(chains, teamId);
  if (!rows.length) return currentStep < LOCAL_CHAIN_LEVELS;
  return rows.some((row) => row.sequence === currentStep + 1 && !!row.userId);
}

function waitHoursForLevel(level: number, chains: EscalationChain[], teamId?: string) {
  const hours = activeChain(chains, teamId).find((row) => row.sequence === level && row.waitHours && row.waitHours > 0)?.waitHours;
  return hours || DEFAULT_LEVEL_WAIT_HOURS;
}

function levelAdvance(row: Communication, at: Date, chains: EscalationChain[], teamId?: string) {
  const step = (row.escalationStep || 0) + 1;
  const people = activeChain(chains, teamId)
    .filter((item) => item.sequence === step && item.userName)
    .map((item) => item.userName as string);
  const following = hasFollowingLevel(step, chains, teamId);
  return {
    escalationStep: step,
    lastEscalatedOn: toIso(at),
    nextEscalationOn: following ? addHours(at, waitHoursForLevel(step, chains, teamId)) : undefined,
    currentRecipient: people.length ? people.join(", ") : row.currentRecipient,
  };
}

export function isEscalationLocked(row: Communication, chains: EscalationChain[] = [], teamId?: string) {
  return row.status === "Closed" || !hasFollowingLevel(row.escalationStep || 0, chains, teamId);
}

export function canAutoEscalate(row: Communication, chains: EscalationChain[] = [], teamId?: string) {
  return matchesAutoEscalationFilter(row) && hasFollowingLevel(row.escalationStep || 0, chains, teamId);
}

export function isAlreadyEscalated(row: Pick<Communication, "isEscalated" | "isManuallyEscalated" | "isAutomaticallyEscalated">) {
  return !!row.isEscalated || !!row.isManuallyEscalated || !!row.isAutomaticallyEscalated;
}

export function canManualEscalate(row: Communication, chains: EscalationChain[] = [], teamId?: string) {
  return row.status !== "Closed" && hasFollowingLevel(row.escalationStep || 0, chains, teamId);
}

export function yesNo(value?: boolean) {
  return value ? "Yes" : "No";
}

export function overdueLabel(overdue: boolean) {
  return overdue ? "Overdue" : "On Track";
}

export function escalatedLabel(escalated: boolean) {
  return escalated ? "Escalated" : "Not Escalated";
}

export function isCentralMailbox(address?: string) {
  if (!address) return false;
  const blob = address.toLowerCase();
  return CENTRAL_MAILBOXES.some((box) => blob.includes(box));
}

export function normalizeSubject(subj: string) {
  return (subj || "")
    .replace(/^(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function conversationPrefix(index?: string) {
  if (!index) return "";
  return index.replace(/\s+/g, "").slice(0, 44);
}

export function findThread(comms: Communication[], email: IntakeEmail) {
  const prefix = conversationPrefix(email.conversationIndex);
  if (prefix) {
    const byIndex = comms.find((c) => conversationPrefix(c.conversationIndex) === prefix || c.threadId === prefix);
    if (byIndex) return byIndex;
  }
  if (email.inReplyTo) {
    const byReply = comms.find((c) => c.emailActivityId === email.inReplyTo || c.threadId === email.inReplyTo || c.recordId === email.inReplyTo || c.id === email.inReplyTo);
    if (byReply) return byReply;
  }
  const subject = normalizeSubject(email.subj);
  if (!subject) return undefined;
  return comms.find((c) => c.status !== "Closed" && normalizeSubject(c.emailSubject || c.subj) === subject);
}

export function applyFormulaFields(row: Communication, now = new Date()): Communication {
  const createdOn = row.createdOn || row.rec;
  if (row.overdueFromColumn) {
    return { ...row, createdOn };
  }
  const due = row.due && parseDate(row.due) ? row.due : dueFromCreated(createdOn);
  return {
    ...row,
    createdOn,
    due,
    isOverdue: computeIsOverdue({ ...row, createdOn }, now),
  };
}

/** Reply Responsible team on the related external party. */
export function responsibleTeamOf(
  _row: Pick<Communication, "owner">,
  party?: { responsibleTeam?: string },
) {
  return party?.responsibleTeam?.trim() || "Unassigned";
}

/** Records the create-time team email. Does not advance the escalation chain. */
export function withTeamNotification(
  row: Communication,
  party?: { responsibleTeam?: string },
  at?: Date,
): Communication {
  const when = at || parseDate(row.createdOn) || new Date();
  const entry = {
    title: FLOWS.notifyResponsibleTeam.name,
    meta: `${toIso(when)} — ${responsibleTeamOf(row, party)} · ${FLOWS.notifyResponsibleTeam.filter}`,
  };
  const existing = row.log.findIndex((item) => item.title === entry.title);
  if (existing >= 0) {
    if (row.log[existing].meta === entry.meta) return row;
    const log = row.log.slice();
    log[existing] = entry;
    return { ...row, log };
  }
  const log = row.log.slice();
  const afterCreate = log.findIndex((item) => /creat/i.test(item.title));
  log.splice(afterCreate >= 0 ? afterCreate + 1 : 0, 0, entry);
  return { ...row, log };
}

export function automaticEscalationPatch(
  row: Communication,
  at = new Date(),
  chains: EscalationChain[] = [],
  teamId?: string,
): Communication {
  const advance = levelAdvance(row, at, chains, teamId);
  return {
    ...row,
    ...advance,
    isAutomaticallyEscalated: true,
    isEscalated: true,
    escalatedBy: row.escalatedBy || "System (Automatic Escalation)",
    log: [
      ...row.log,
      { title: FLOWS.autoEscalation.name, meta: `${toIso(at)} — level ${advance.escalationStep} · ${FLOWS.autoEscalation.filter}` },
    ],
  };
}

export function manualEscalationPatch(
  row: Communication,
  reason: string,
  by: string,
  extras: { closedBy?: string; closureComment?: string; chains?: EscalationChain[]; teamId?: string } = {},
  at = new Date(),
): Communication {
  const advance = levelAdvance(row, at, extras.chains || [], extras.teamId);
  return {
    ...row,
    ...advance,
    isManuallyEscalated: true,
    isEscalated: true,
    isAutomaticallyEscalated: row.isAutomaticallyEscalated,
    escalatedBy: by,
    escalationReason: reason,
    closedBy: extras.closedBy || row.closedBy,
    closureComment: extras.closureComment || row.closureComment,
    log: [
      ...row.log,
      { title: FLOWS.manualEscalation.name, meta: `${toIso(at)} — level ${advance.escalationStep} · ${by}${reason ? ` · ${reason}` : ""}` },
    ],
  };
}

export function closureFromFlow(row: Communication, comment: string, by: string, at = new Date()): Communication {
  const stamp = toIso(at);
  return {
    ...row,
    status: "Closed" as CommStatus,
    closed: stamp,
    closedBy: by,
    nextEscalationOn: undefined,
    closureComment: comment,
    log: [
      ...row.log,
      { title: FLOWS.captureClosed.name, meta: `${stamp} — ${FLOWS.captureClosed.filter} · closed by ${by}` },
    ],
  };
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, token: string) => {
    const key = token.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith("#x")) {
      const n = parseInt(key.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    if (key.startsWith("#")) {
      const n = parseInt(key.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    return full;
  });
}

function htmlToText(html?: string) {
  let s = html || "";
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(decodeEntities(s));
  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return s;
}

function stripMailBanners(text: string) {
  return text
    .replace(/You don't often get email from[\s\S]*?Learn why this is important\.?/gi, "")
    .replace(/CAUTION:\s*This email originated from outside[\s\S]*?(?:content is safe\.?|know the content is safe\.?)/gi, "")
    .replace(/This email originated from outside[\s\S]*?content is safe\.?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function emailBodyParts(html?: string) {
  const text = stripMailBanners(htmlToText(html));
  const split = text.split(/\n(?=On .+ wrote:)/i);
  const body = (split[0] || "").trim();
  const quoted = split.slice(1).join("\n").trim();
  return { body, quoted };
}
