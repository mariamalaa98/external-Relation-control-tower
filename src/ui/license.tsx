import { useMemo, useState } from "react";
import type { License, Notice, Renewal } from "../data/types";
import {
  ME,
  TODAY,
  daysBetween,
  docState,
  formatDateTime,
  markNoticeRead,
  useStore,
} from "../data/store";
import { DataTable, FilterField, flagBadge, priBadge, statusBadge } from "./widgets";

export function NotificationCenter({
  q,
  setQ,
  busy,
  onOpenDoc,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  onOpenDoc: (doc: License) => void;
}) {
  const db = useStore();
  const [type, setType] = useState("All");
  const [read, setRead] = useState("Unread");
  const filtered = useMemo(() => db.notices.filter((n) => {
    const hit = `${n.title} ${n.documentName || ""} ${n.message || ""} ${n.owner}`.toLowerCase().includes(q.toLowerCase());
    const typeOk = type === "All" || n.type === type;
    const readOk = read === "All" || (read === "Unread" ? !n.isRead : n.isRead);
    return hit && typeOk && readOk;
  }), [db.notices, q, type, read]);

  function openRelated(n: Notice) {
    const doc = db.docs.find((d) => d.recordId === n.documentId || d.id === n.documentId);
    if (doc) onOpenDoc(doc);
  }

  return (
    <>
      <div className="callout">
        <b>Notification log</b> records reminder, expiry, and escalation events from the license/contract expiry monitor.
        The app writes these rows to Dataverse. Email sending can be attached later with Power Automate.
      </div>
      <div className="filters">
        <FilterField label="Search">
          <input placeholder="Search title, document, owner" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option>All</option>
            <option>Reminder</option>
            <option>Expiry</option>
            <option>Escalation</option>
          </select>
        </FilterField>
        <FilterField label="Read">
          <select value={read} onChange={(e) => setRead(e.target.value)}>
            <option>All</option>
            <option>Unread</option>
            <option>Read</option>
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} shown · {db.notices.filter((n) => !n.isRead).length} unread</span>
      </div>
      <DataTable
        cols={["Sent", "Type", "Title", "Document", "Result", "Owner", ""]}
        rows={filtered.map((n) => ({
          key: n.recordId || n.id,
          onClick: () => openRelated(n),
          cells: [
            <span className="mono" key="s">{formatDateTime(n.sentOn)}</span>,
            statusBadge(n.type),
            <>{n.isRead ? n.title : <b>{n.title}</b>}</>,
            n.documentName || "—",
            flagBadge(n.result === "Sent", "Sent", "Failed"),
            n.owner || "—",
            n.isRead
              ? statusBadge("Read")
              : (
                <button
                  className="btn btn-outline btn-mini"
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void markNoticeRead(n.id);
                  }}
                >
                  Mark read
                </button>
              ),
          ],
        }))}
      />
    </>
  );
}

export function LicenseEscalationPanel({
  q,
  busy,
  docs,
  onOpen,
  onEscalate,
}: {
  q: string;
  busy: boolean;
  docs: License[];
  onOpen: (row: License) => void;
  onEscalate: (row: License) => void;
}) {
  const db = useStore();
  const rows = docs.filter((d) => {
    const hit = `${d.id} ${d.name} ${d.party} ${d.owner}`.toLowerCase().includes(q.toLowerCase());
    return hit && (d.isOverdue || d.isEscalated || docState(d) === "Expired");
  });
  const pending = docs.filter((d) => d.isOverdue && !d.isEscalated && !d.done);
  const escalated = docs.filter((d) => d.isEscalated);
  return (
    <>
      <div className="callout">
        <b>License / contract escalation.</b> When expiry is reached and the renewal is not completed, risk becomes Critical, the renewal is Overdue, and the record is sent to Escalation Center once.
      </div>
      <div className="kpis">
        <div className="kpi" style={{ ["--acc" as string]: "var(--bad)" }}>
          <div className="l">Pending expiry</div>
          <div className="v">{pending.length}</div>
          <div className="d">Expired, not escalated</div>
        </div>
        <div className="kpi" style={{ ["--acc" as string]: "var(--warn)" }}>
          <div className="v">{escalated.length}</div>
          <div className="l">Escalated</div>
          <div className="d">Is Escalated = Yes</div>
        </div>
      </div>
      <DataTable
        cols={["ID", "Document", "Expiry", "Days", "Risk", "Overdue", "Escalation", "Owner", ""]}
        rows={rows.map((r) => {
          const renewal = db.renewals.find((x) => x.recordId === r.currentRenewalId || x.documentId === r.recordId || x.documentId === r.id);
          return {
            key: r.recordId || r.id,
            onClick: () => onOpen(r),
            cells: [
              <span className="link" key="id">{r.id}</span>,
              r.name,
              <span className="mono" key="exp">{r.expiry}</span>,
              r.daysRemaining ?? daysBetween(TODAY, r.expiry),
              priBadge(r.risk),
              flagBadge(!!r.isOverdue, "Overdue", "On Track"),
              renewal?.escalation || (r.isEscalated ? "L1" : "Not Escalated"),
              r.owner || "—",
              r.isEscalated
                ? "Already escalated"
                : (
                  <button className="btn btn-outline btn-mini" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onEscalate(r); }}>
                    Escalate
                  </button>
                ),
            ],
          };
        })}
      />
    </>
  );
}

export function RenewalTaskTable({ rows }: { rows: Renewal[] }) {
  if (!rows.length) return null;
  return (
    <>
      <h2 className="sec">Renewal tasks ({rows.length})</h2>
      <DataTable
        cols={["ID", "Document", "Type", "Status", "Due", "Risk", "Escalation", "Owner", "Reminders"]}
        rows={rows.map((r) => ({
          key: r.recordId || r.id,
          cells: [
            r.id,
            r.documentName || "—",
            statusBadge(r.type),
            statusBadge(r.status),
            <span className="mono" key="due">{r.due ? r.due.slice(0, 10) : "—"}</span>,
            priBadge(r.risk),
            r.escalation,
            r.owner || ME,
            r.reminderCount ?? 0,
          ],
        }))}
      />
    </>
  );
}

