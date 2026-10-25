import { useMemo, useState } from "react";
import {
  communicationDuty,
  communicationEscalations,
  formatAuditStamp,
  licenseDuty,
  renewalAuditRow,
  renewalEscalations,
} from "../data/auditLogic";
import { canManualEscalate, docState, formatDateTime, useStore } from "../data/store";
import type { Communication, License } from "../data/types";
import { DataTable, FilterField, Kpi } from "./widgets";

type SourceFilter = "All" | "Communication" | "License";
type ResponseFilter = "All" | "No response" | "Responded";

type EscalationRow = {
  key: string;
  source: "Communication" | "License";
  title: string;
  detail: string;
  owner: string;
  to: string;
  when?: string;
  by: string;
  respondedBy: string;
  respondedAt?: string;
  responded: boolean;
  canEscalate: boolean;
  actionLabel: string;
  blockedLabel: string;
  onOpen: () => void;
  onEscalate?: () => void;
};

function dutyBadge(responded: boolean) {
  return <span className={`badge ${responded ? "b-ok" : "b-bad"}`}>{responded ? "Responded" : "No response"}</span>;
}

export function SystemEscalationCenter({
  q,
  setQ,
  busy,
  comms,
  docs,
  onOpenComm,
  onOpenDoc,
  onEscalateComm,
  onEscalateDoc,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  comms: Communication[];
  docs: License[];
  onOpenComm: (row: Communication) => void;
  onOpenDoc: (row: License) => void;
  onEscalateComm: (row: Communication) => void;
  onEscalateDoc: (row: License) => void;
}) {
  const db = useStore();
  const [source, setSource] = useState<SourceFilter>("All");
  const [response, setResponse] = useState<ResponseFilter>("All");

  const rows = useMemo(() => {
    const commRows: EscalationRow[] = comms.flatMap((comm) => {
      const escalated = !!(comm.isEscalated || comm.isAutomaticallyEscalated || comm.isManuallyEscalated);
      const pending = comm.status !== "Closed" && comm.isOverdue && !comm.isEscalated;
      if (!escalated && !pending) return [];
      const levels = communicationEscalations(comm, db.audits, db.threadByComm);
      const top = levels[levels.length - 1];
      const duty = communicationDuty(comm, db.audits, db.threadByComm);
      const step = comm.escalationStep || 0;
      const allowed = canManualEscalate(comm);
      return [{
        key: comm.recordId || comm.id,
        source: "Communication",
        title: comm.id,
        detail: step > 0
          ? `${comm.subj}${comm.nextEscalationOn ? ` · next ${formatDateTime(comm.nextEscalationOn)}` : ""}`
          : comm.subj,
        owner: duty.responsible,
        to: step > 0
          ? `Level ${step}${comm.currentRecipient ? ` · ${comm.currentRecipient}` : ""}`
          : (top?.to || comm.sup || "Supervisor"),
        when: comm.lastEscalatedOn || top?.receivedAt || comm.due,
        by: comm.escalatedBy || (pending ? "Waiting to escalate" : "System"),
        respondedBy: duty.respondedBy,
        respondedAt: duty.respondedAt,
        responded: duty.responded,
        canEscalate: allowed,
        actionLabel: `Escalate to level ${step + 1}`,
        blockedLabel: comm.status === "Closed" ? "Closed" : "Chain complete",
        onOpen: () => onOpenComm(comm),
        onEscalate: allowed ? () => onEscalateComm(comm) : undefined,
      }];
    });
    const docRows: EscalationRow[] = docs.flatMap((doc) => {
      const state = docState(doc);
      const escalated = !!doc.isEscalated;
      const pending = !doc.isEscalated && !doc.done && (doc.isOverdue || state === "Expired");
      if (!escalated && !pending) return [];
      const audit = renewalAuditRow(doc, db.notices, db.renewals, db.parties);
      const levels = renewalEscalations(doc, audit, db.notices, db.renewals);
      const top = levels[levels.length - 1];
      const duty = licenseDuty(doc, db.renewals);
      return [{
        key: doc.recordId || doc.id,
        source: "License",
        title: doc.id,
        detail: doc.name,
        owner: duty.responsible,
        to: top?.to || "Department Head",
        when: top?.receivedAt || doc.expiry,
        by: doc.escalatedBy || (pending ? "Waiting to escalate" : "System"),
        respondedBy: duty.respondedBy,
        respondedAt: duty.respondedAt,
        responded: duty.responded,
        canEscalate: !doc.isEscalated && !doc.done,
        actionLabel: "Escalate",
        blockedLabel: "Already escalated",
        onOpen: () => onOpenDoc(doc),
        onEscalate: !doc.isEscalated && !doc.done ? () => onEscalateDoc(doc) : undefined,
      }];
    });
    return [...commRows, ...docRows];
  }, [comms, docs, db.audits, db.threadByComm, db.notices, db.renewals, db.parties, db.escalationChains, onOpenComm, onOpenDoc, onEscalateComm, onEscalateDoc]);

  const filtered = rows.filter((row) => {
    const blob = `${row.title} ${row.detail} ${row.owner} ${row.to} ${row.by} ${row.respondedBy}`.toLowerCase();
    const sourceOk = source === "All" || row.source === source;
    const responseOk = response === "All" || (response === "Responded" ? row.responded : !row.responded);
    return blob.includes(q.toLowerCase()) && sourceOk && responseOk;
  });
  const waiting = rows.filter((row) => !row.responded);
  const commCount = rows.filter((row) => row.source === "Communication").length;
  const docCount = rows.filter((row) => row.source === "License").length;

  return (
    <>
      <div className="callout">
        A new communication notifies the <b>responsible team</b> first. If nobody closes it and the status stays open, automatic escalation starts once it is overdue, then notifies everyone on the next level after the wait on the chain (24 hours when wait hours is blank). <b>Next level</b> sends that level now. <b>Responded by</b> and <b>Responded on</b> record who acted and when.
      </div>
      <div className="kpis">
        <Kpi acc="var(--bronze)" label="All escalations" value={rows.length} detail="Communications and licenses" onClick={() => { setSource("All"); setResponse("All"); }} />
        <Kpi acc="var(--bad)" label="No response" value={waiting.length} detail="Owner is still accountable" onClick={() => setResponse("No response")} />
        <Kpi acc="var(--info)" label="Communications" value={commCount} detail="Cases escalated or overdue" onClick={() => setSource("Communication")} />
        <Kpi acc="var(--warn)" label="Licenses" value={docCount} detail="Renewals escalated or expired" onClick={() => setSource("License")} />
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search record, owner, or who responded" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="Source">
          <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
            <option>All</option>
            <option>Communication</option>
            <option>License</option>
          </select>
        </FilterField>
        <FilterField label="Response">
          <select value={response} onChange={(e) => setResponse(e.target.value as ResponseFilter)}>
            <option>All</option>
            <option>No response</option>
            <option>Responded</option>
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["Source", "Record", "Owner", "Escalated to", "Escalated on", "Escalated by", "Responded by", "Responded on", "Accountability", ""]}
        rows={filtered.map((row) => ({
          key: row.key,
          onClick: row.onOpen,
          cells: [
            <span className={`badge ${row.source === "License" ? "b-gold" : "b-info"}`} key="src">{row.source}</span>,
            <span key="id"><span className="link">{row.title}</span><div style={{ color: "var(--muted)", fontSize: 11 }}>{row.detail}</div></span>,
            row.responded ? row.owner : <span className="accountable" key="own">{row.owner}</span>,
            row.to,
            <span className="mono" key="when">{formatAuditStamp(row.when) || formatDateTime(row.when) || "—"}</span>,
            row.by,
            row.respondedBy || "—",
            row.respondedAt ? <span className="mono" key="at">{formatAuditStamp(row.respondedAt) || formatDateTime(row.respondedAt)}</span> : "—",
            dutyBadge(row.responded),
            row.onEscalate
              ? <button key="go" className="btn btn-outline btn-mini" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); row.onEscalate?.(); }}>{row.actionLabel}</button>
              : row.blockedLabel,
          ],
        }))}
      />
    </>
  );
}
