import type { DocRisk, License, Notice, NoticeType, Renewal } from "./types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value?: string) {
  if (!value) return "";
  return value.slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const a = new Date(dateOnly(from) + "T00:00:00");
  const b = new Date(dateOnly(to) + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Default reminder window when the license has no threshold set. */
export const DEFAULT_REMINDER_THRESHOLD = 120;

export function daysRemaining(expiry: string, today = todayIso()) {
  if (!expiry) return 0;
  return daysBetween(today, dateOnly(expiry) || expiry);
}

/** Risk from days remaining. Critical on or after expiry. */
export function riskFromDays(days: number): DocRisk {
  if (days <= 0) return "Critical";
  if (days <= 30) return "High";
  if (days <= 90) return "Medium";
  return "Low";
}

export function thresholdOf(row: Pick<License, "reminderThreshold">) {
  const n = Number(row.reminderThreshold);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REMINDER_THRESHOLD;
}

export function isLicenseClosed(row: Pick<License, "status" | "done">) {
  return row.status === "Renewed" || !!row.done;
}

export function isLicenseOverdue(row: Pick<License, "expiry" | "status" | "done">, today = todayIso()) {
  if (isLicenseClosed(row)) return false;
  return daysRemaining(row.expiry, today) < 0;
}

export function isThresholdReached(row: Pick<License, "expiry" | "reminderThreshold" | "status" | "done">, today = todayIso()) {
  if (isLicenseClosed(row)) return false;
  return daysRemaining(row.expiry, today) <= thresholdOf(row);
}

export function applyLicenseFormulas(row: License, today = todayIso()): License {
  const days = daysRemaining(row.expiry, today);
  const closed = isLicenseClosed(row);
  const overdue = !closed && days < 0;
  const status = closed ? "Renewed" : overdue ? "Expired" : row.status === "Expired" ? undefined : row.status;
  let renewalStatus = row.renewalStatus || "Not Started";
  if (closed) renewalStatus = "Renewed";
  else if (overdue) renewalStatus = "Expired";
  else if (renewalStatus === "Expired" || renewalStatus === "Renewed") renewalStatus = "In Progress";
  return {
    ...row,
    daysRemaining: days,
    risk: closed ? row.risk : riskFromDays(days),
    isOverdue: overdue,
    status,
    renewalStatus,
    active: row.active !== false,
  };
}

export function openRenewalFor(doc: License, renewals: Renewal[]) {
  const id = doc.recordId || doc.id;
  return renewals.find((r) => {
    const match = r.documentId === id || r.documentId === doc.id || r.documentId === doc.recordId;
    return match && r.status !== "Completed" && r.status !== "Cancelled";
  });
}

export function noticeTitle(type: NoticeType, doc: License) {
  if (type === "Escalation") return `Escalation — ${doc.name}`;
  if (type === "Expiry") return `Expiry reached — ${doc.name}`;
  return `Renewal reminder — ${doc.name}`;
}

export function noticeMessage(type: NoticeType, doc: License, days: number) {
  if (type === "Escalation") {
    return `${doc.name} expired ${doc.expiry} without renewal. Escalated to Escalation Center.`;
  }
  if (type === "Expiry") {
    return `${doc.name} reached expiry (${doc.expiry}). Risk is Critical.`;
  }
  return `${doc.name} is ${days} day${days === 1 ? "" : "s"} from expiry (${doc.expiry}). Renewal task created.`;
}

export function clip100(value: string) {
  const text = value.trim();
  return text.length <= 100 ? text : `${text.slice(0, 97)}...`;
}

export function summarizeMonitor(result: { renewals: number; notices: number; escalations: number }) {
  const parts: string[] = [];
  if (result.renewals) parts.push(`${result.renewals} renewal task${result.renewals === 1 ? "" : "s"}`);
  if (result.notices) parts.push(`${result.notices} notification${result.notices === 1 ? "" : "s"}`);
  if (result.escalations) parts.push(`${result.escalations} escalation${result.escalations === 1 ? "" : "s"}`);
  return parts.length ? `Expiry monitor: ${parts.join(", ")}` : "Expiry monitor: no new actions";
}

export function unreadNotices(rows: Notice[]) {
  return rows.filter((n) => !n.isRead);
}
