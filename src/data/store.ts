import { useSyncExternalStore } from "react";
import { SEED } from "./seed";
import type { Communication, License, Party, SlaState, Store } from "./types";

const TODAY = "2026-08-24";
let store: Store = structuredClone(SEED);
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function daysBetween(from: string, to: string) {
  return Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86400000);
}

export function slaState(row: Communication): SlaState {
  if (row.status === "Closed") {
    const closed = row.closed || row.due;
    return daysBetween(row.due, closed) > 0 ? "Breached" : "Within";
  }
  const left = daysBetween(TODAY, row.due);
  if (left < 0) return "Breached";
  if (left <= 1) return "At Risk";
  return "Within";
}

export function docState(row: License) {
  const left = daysBetween(TODAY, row.expiry);
  if (row.status === "Renewed") return "Renewed";
  if (left < 0) return "Expired";
  if (left <= 90) return "Expiring";
  return "Active";
}

export function slaDays(cat: string, pri: string) {
  const rule = store.sla.find((r) => r.category === cat && r.priority === pri);
  return rule?.resolveDays ?? 10;
}

export function addDays(date: string, n: number) {
  const x = new Date(date + "T00:00:00");
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStore() {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

export function addParty(party: Party) {
  store = { ...store, parties: [party, ...store.parties] };
  emit();
}

export function addComm(row: Communication) {
  store = { ...store, comms: [row, ...store.comms] };
  emit();
}

export function addDoc(row: License) {
  store = { ...store, docs: [row, ...store.docs] };
  emit();
}

export function nextCommId() {
  const n = Math.max(...store.comms.map((c) => Number(c.id.split("-")[2] || 0))) + 1;
  return `COM-2026-${String(n).padStart(4, "0")}`;
}

export function nextDocId() {
  const n = Math.max(...store.docs.map((c) => Number(c.id.split("-")[2] || 0))) + 1;
  return `DOC-2026-${String(n).padStart(4, "0")}`;
}

export const ME = "Ahmed Salah";
export { TODAY };
