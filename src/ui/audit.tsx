import { useMemo, useState } from "react";
import {
  commAuditRow,
  commCompliance,
  communicationEscalations,
  formatAuditDate,
  formatAuditStamp,
  inDateRange,
  renewalAuditRow,
  renewalEscalations,
  renewalSummary,
  weeklyCompletions,
  type AuditEscalation,
  type CommAuditRow,
  type RenewalAuditRow,
} from "../data/auditLogic";
import { completeCycle, matchesSearch, sendRenewalNotice } from "../data/store";
import { CATS, type AuditRow, type Communication, type License, type Notice, type Party, type Renewal, type ThreadEmail } from "../data/types";
import { DataTable, FilterField, Kpi, PageHead, catBadge, statusBadge } from "./widgets";

function critBadge(level: string) {
  const tone = level === "High" ? "b-bad" : level === "Medium" ? "b-warn" : "b-gray";
  return <span className={`badge ${tone}`}>{level}</span>;
}

function deptBadge(level: string) {
  return <span className={`badge ${level === "Insurance" ? "b-gold" : "b-info"}`}>{level}</span>;
}

function responseBadge(ok: boolean) {
  return <span className={`badge ${ok ? "b-ok" : "b-bad"}`}>{ok ? "Responded" : "No Response"}</span>;
}

function sla24Badge(within: boolean) {
  return <span className={`badge ${within ? "b-ok" : "b-bad"}`}>{within ? "Within 24h" : "Delayed"}</span>;
}

function lockTag(on: boolean) {
  return on ? <span title="Closed — read only"> 🔒</span> : null;
}

function csvCell(value: string) {
  const text = (value || "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(name: string, sections: { name: string; cols: string[]; rows: string[][] }[]) {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(csvCell(section.name));
    lines.push(section.cols.map(csvCell).join(","));
    for (const row of section.rows) lines.push(row.map(csvCell).join(","));
    lines.push("");
  }
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function EscalationTable({ rows }: { rows: AuditEscalation[] }) {
  return (
    <DataTable
      cols={["Record", "Escalated To", "Escalation Received", "Response", "Response Lag", "Action Taken", "Status"]}
      rows={rows.map((row) => ({
        key: row.key,
        cells: [
          <span key="id">{row.title}{row.subtitle ? <div style={{ color: "var(--muted)", fontSize: 11 }}>{row.subtitle}</div> : null}</span>,
          row.to,
          <span className="mono" key="recv">{formatAuditStamp(row.receivedAt) || "—"}</span>,
          row.responseAt ? <span className="mono" key="resp">{formatAuditStamp(row.responseAt)}</span> : responseBadge(false),
          <span className="mono" key="lag">{row.lag}</span>,
          row.action || <span className="badge b-warn" key="act">No action recorded</span>,
          responseBadge(row.responded),
        ],
      }))}
    />
  );
}

export function CommunicationAuditScreen({
  q,
  setQ,
  comms,
  audits,
  threads,
  busy,
  onOpen,
  onRefresh,
}: {
  q: string;
  setQ: (v: string) => void;
  comms: Communication[];
  audits: AuditRow[];
  threads: Record<string, ThreadEmail[]>;
  busy?: boolean;
  onOpen: (row: Communication) => void;
  onRefresh: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("All");
  const [criticality, setCriticality] = useState("All");
  const [response, setResponse] = useState("All");

  const rows = useMemo(
    () => comms.map((comm) => commAuditRow(comm, audits, threads)),
    [comms, audits, threads],
  );
  const kpis = useMemo(() => commCompliance(rows), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const hit = matchesSearch(q, row.commId, row.party, row.keyword, row.responseAction, row.category, row.source.subj);
    const stateOk = response === "All" || (response === "Within 24h" ? row.within24 : !row.within24);
    return hit
      && stateOk
      && (category === "All" || row.category === category)
      && (criticality === "All" || row.criticality === criticality)
      && inDateRange(row.receivedAt, from, to);
  }), [rows, q, from, to, category, criticality, response]);
  const escalations = useMemo(
    () => comms.flatMap((comm) => communicationEscalations(comm, audits, threads)),
    [comms, audits, threads],
  );
  const l1 = escalations.filter((row) => row.level === "L1");
  const l2 = escalations.filter((row) => row.level === "L2");
  const waiting = (list: AuditEscalation[]) => list.filter((row) => !row.responded).length;

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`communication-audit-${today}.csv`, [
      {
        name: "Communication register",
        cols: ["CommID", "External Party", "Category", "Criticality", "Subject Keyword", "Comm Date & Time", "Response Date & Time", "Response Action", "Status", "Response SLA"],
        rows: filtered.map((row) => [
          row.commId, row.party, row.category, row.criticality, row.keyword,
          formatAuditStamp(row.receivedAt), formatAuditStamp(row.responseAt) || "No Response",
          row.responseAction, row.status, row.within24 ? "Within 24h" : "Delayed",
        ]),
      },
      {
        name: "Escalation 1 — Supervisor",
        cols: ["CommID", "Party", "Escalated To", "Escalation Received", "Response", "Response Lag", "Action Taken", "Status"],
        rows: l1.map((row) => [row.title, row.subtitle, row.to, formatAuditStamp(row.receivedAt), formatAuditStamp(row.responseAt) || "No Response", row.lag, row.action, row.responded ? "Responded" : "No Response"]),
      },
      {
        name: "Escalation 2 — Executive",
        cols: ["CommID", "Party", "Escalated To", "Escalation Received", "Response", "Response Lag", "Action Taken", "Status"],
        rows: l2.map((row) => [row.title, row.subtitle, row.to, formatAuditStamp(row.receivedAt), formatAuditStamp(row.responseAt) || "No Response", row.lag, row.action, row.responded ? "Responded" : "No Response"]),
      },
    ]);
  }

  return (
    <>
      <PageHead title="Communication Audit View" sub={`Read-only · ${rows.length} records · 24-hour response standard`}>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onRefresh}>↻ Refresh</button>
        <button className="btn btn-outline" type="button" onClick={exportCsv}>Export CSV</button>
      </PageHead>
      <div className="callout">
        Read-only compliance view. Response performance is measured from the <b>communication received date and time</b> to the first response, against a <b>24-hour standard</b>. Escalation 1 and 2 each show received time, response time and action taken; an escalation with no response is flagged <b>No Response</b>.
      </div>
      <div className="kpis">
        <Kpi acc="var(--ok)" label="Responded within 24 hours" value={kpis.within} detail={`of ${kpis.total} communications`} onClick={() => setResponse("Within 24h")} />
        <Kpi acc="var(--bad)" label="Delayed communications" value={kpis.delayed} detail="Over 24 hours or no response" onClick={() => setResponse("Delayed")} />
        <Kpi acc="var(--bronze)" label="Response compliance" value={`${kpis.pct}%`} detail="Within-24h ÷ total communications" onClick={() => setResponse("Within 24h")} />
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search CommID, party or keyword" value={q} onInput={(e) => setQ(e.currentTarget.value)} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FilterField>
        <FilterField label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FilterField>
        <FilterField label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>All</option>
            {CATS.map((cat) => <option key={cat}>{cat}</option>)}
          </select>
        </FilterField>
        <FilterField label="Criticality">
          <select value={criticality} onChange={(e) => setCriticality(e.target.value)}>
            <option>All</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </FilterField>
        <FilterField label="Response">
          <select value={response} onChange={(e) => setResponse(e.target.value)}>
            <option>All</option>
            <option>Within 24h</option>
            <option>Delayed</option>
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["CommID", "External Party", "Category", "Criticality", "Subject Keyword", "Comm Date & Time", "Response Date & Time", "Response Action", "Status", "Response SLA"]}
        rows={filtered.map((row) => ({
          key: row.key,
          onClick: () => onOpen(row.source),
          legal: row.category === "Legal",
          cells: commCells(row),
        }))}
      />
      <div className="card sumbar">
        <span>Total responded within 24 hours: <b style={{ color: "var(--ok)" }}>{kpis.within}</b></span>
        <span>Total delayed: <b style={{ color: "var(--bad)" }}>{kpis.delayed}</b></span>
        <span>Response compliance: <b style={{ color: Number(kpis.pct) >= 85 ? "var(--ok)" : "var(--warn)" }}>{kpis.pct}%</b></span>
        <span style={{ color: "var(--muted)" }}>Measured from communication received date/time to first response</span>
      </div>
      <h2 className="sec">Escalation 1 — Supervisor level ({waiting(l1)} awaiting response)</h2>
      <EscalationTable rows={l1} />
      <h2 className="sec">Escalation 2 — Executive level ({waiting(l2)} awaiting response)</h2>
      <EscalationTable rows={l2} />
    </>
  );
}

function commCells(row: CommAuditRow) {
  return [
    row.commId,
    row.party,
    catBadge(row.category),
    critBadge(row.criticality),
    row.keyword || "—",
    <span className="mono" key="rec">{formatAuditStamp(row.receivedAt) || "—"}</span>,
    row.responseAt ? <span className="mono" key="resp">{formatAuditStamp(row.responseAt)}</span> : responseBadge(false),
    row.responseAction,
    <span key="st">{statusBadge(row.status)}{lockTag(row.closed)}</span>,
    sla24Badge(row.within24),
  ];
}

export function NotificationAuditScreen({
  q,
  setQ,
  docs,
  notices,
  renewals,
  parties,
  busy,
  onOpen,
  onRefresh,
  onDone,
  onFail,
}: {
  q: string;
  setQ: (v: string) => void;
  docs: License[];
  notices: Notice[];
  renewals: Renewal[];
  parties: Party[];
  busy?: boolean;
  onOpen: (row: License) => void;
  onRefresh: () => void;
  onDone: (message: string) => void;
  onFail: (message: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [department, setDepartment] = useState("All");
  const [type, setType] = useState("All");
  const [status, setStatus] = useState("All");
  const [bu, setBu] = useState("All");
  const [working, setWorking] = useState("");

  const rows = useMemo(
    () => docs.map((doc) => renewalAuditRow(doc, notices, renewals, parties)),
    [docs, notices, renewals, parties],
  );
  const summary = useMemo(() => renewalSummary(rows), [rows]);
  const weeks = useMemo(() => weeklyCompletions(rows), [rows]);
  const units = useMemo(() => [...new Set(rows.map((row) => row.bu).filter((name) => name && name !== "—"))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const hit = matchesSearch(q, row.name, row.bu, row.department, row.orgDepartment, row.type, row.source.id, row.source.party);
    const statusOk = status === "All"
      || (status === "Due within 120 days" ? row.inWindow : row.status === status);
    return hit
      && statusOk
      && (department === "All" || row.department === department)
      && (type === "All" || row.type === type)
      && (bu === "All" || row.bu === bu)
      && inDateRange(row.expiry, from, to);
  }), [rows, q, from, to, department, type, status, bu]);
  const overdue = rows.filter((row) => row.status === "Overdue");
  const escalations = useMemo(
    () => docs.flatMap((doc) => {
      const row = rows.find((item) => item.key === (doc.recordId || doc.id));
      return row ? renewalEscalations(doc, row, notices, renewals) : [];
    }),
    [docs, rows, notices, renewals],
  );
  const l1 = escalations.filter((row) => row.level === "L1");
  const l2 = escalations.filter((row) => row.level === "L2");
  const waiting = (list: AuditEscalation[]) => list.filter((row) => !row.responded).length;

  async function runAction(id: string, label: string, work: () => Promise<unknown>) {
    setWorking(id + label);
    try {
      await work();
      onDone(label);
    } catch (err) {
      onFail(err instanceof Error ? err.message : "Action failed");
    } finally {
      setWorking("");
    }
  }

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`notification-audit-${today}.csv`, [
      {
        name: "Renewal cycles",
        cols: ["Business Unit", "Related Department", "Renewal Type", "Document", "Expiry Date", "Notification Start (E-120)", "Notification Date", "Renewal Completion", "Current Status"],
        rows: filtered.map((row) => [
          row.bu, row.department, row.type, row.name, row.expiry,
          formatAuditDate(row.notificationStart), formatAuditStamp(row.notifiedAt),
          formatAuditDate(row.completedAt), row.status,
        ]),
      },
      {
        name: "Renewals completed each week",
        cols: ["Week commencing", "Renewals completed", "Documents", "Business units"],
        rows: weeks.map((week) => [week.week, String(week.count), week.documents, week.units]),
      },
      {
        name: "Overdue renewals",
        cols: ["Business Unit", "Department", "Document", "Expiry Date", "Days Overdue", "Notification Date", "Status"],
        rows: overdue.map((row) => [row.bu, row.department, row.name, row.expiry, String(row.daysOverdue), formatAuditStamp(row.notifiedAt) || "Not sent", "Overdue"]),
      },
      {
        name: "Escalation 1 — Department",
        cols: ["Document", "Department", "Escalated To", "Escalation Received", "Response", "Response Lag", "Action Taken", "Status"],
        rows: l1.map((row) => [row.title, row.subtitle, row.to, formatAuditStamp(row.receivedAt), formatAuditStamp(row.responseAt) || "No Response", row.lag, row.action, row.responded ? "Responded" : "No Response"]),
      },
      {
        name: "Escalation 2 — Executive",
        cols: ["Document", "Department", "Escalated To", "Escalation Received", "Response", "Response Lag", "Action Taken", "Status"],
        rows: l2.map((row) => [row.title, row.subtitle, row.to, formatAuditStamp(row.receivedAt), formatAuditStamp(row.responseAt) || "No Response", row.lag, row.action, row.responded ? "Responded" : "No Response"]),
      },
    ]);
  }

  return (
    <>
      <PageHead title="Notification Audit View" sub={`Insurance contracts & governmental licences · ${rows.length} renewal cycles`}>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onRefresh}>↻ Refresh</button>
        <button className="btn btn-outline" type="button" onClick={exportCsv}>Export CSV</button>
      </PageHead>
      <div className="callout">
        Insurance contracts and governmental licences. The notification window opens <b>120 days before expiry</b>. A cycle is <b>Closed</b> only when a completion date exists, and <b>Overdue</b> once expiry passes without one. Escalation 1 and 2 show received time, response time and action taken, with <b>No Response</b> where none was given.
      </div>
      <div className="kpis">
        <Kpi acc="var(--warn)" label="Due within 120 days" value={summary.due} detail="Notification window open" onClick={() => setStatus("Due within 120 days")} />
        <Kpi acc="var(--ok)" label="Renewals completed" value={summary.done} detail={`Across ${summary.weeks} weeks`} onClick={() => setStatus("Closed")} />
        <Kpi acc="var(--bad)" label="Overdue" value={summary.overdue} detail="Past expiry, not renewed" onClick={() => setStatus("Overdue")} />
        <Kpi acc="var(--bronze)" label="Completion rate" value={`${summary.pct}%`} detail="Completed ÷ all cycles" />
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search document, BU or department" value={q} onInput={(e) => setQ(e.currentTarget.value)} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FilterField>
        <FilterField label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FilterField>
        <FilterField label="Department">
          <select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option>All</option>
            <option>Insurance</option>
            <option>Governmental</option>
          </select>
        </FilterField>
        <FilterField label="Renewal type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option>All</option>
            <option>License</option>
            <option>Contract</option>
            <option>Permit</option>
          </select>
        </FilterField>
        <FilterField label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>All</option>
            <option>Open</option>
            <option>Closed</option>
            <option>Overdue</option>
            <option>Due within 120 days</option>
          </select>
        </FilterField>
        <FilterField label="Business Unit">
          <select value={bu} onChange={(e) => setBu(e.target.value)}>
            <option>All</option>
            {units.map((name) => <option key={name}>{name}</option>)}
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["Business Unit", "Related Department", "Renewal Type", "Document", "Expiry Date", "Notification Start (E-120)", "Notification Date", "Renewal Completion", "Current Status", "Action"]}
        rows={filtered.map((row) => ({
          key: row.key,
          onClick: () => onOpen(row.source),
          cells: renewalCells(row, busy || !!working, (label, work) => void runAction(row.key, label, work)),
        }))}
      />
      <div className="card sumbar">
        <span>Due within 120 days: <b style={{ color: "var(--warn)" }}>{summary.due}</b></span>
        <span>Completed: <b style={{ color: "var(--ok)" }}>{summary.done}</b></span>
        <span>Open: <b style={{ color: "var(--info)" }}>{summary.open}</b></span>
        <span>Overdue: <b style={{ color: "var(--bad)" }}>{summary.overdue}</b></span>
        <span>Notification lead time: <b>120 days</b></span>
      </div>
      <h2 className="sec">Renewals completed each week</h2>
      <DataTable
        cols={["Week commencing", "Renewals completed", "Documents", "Business units"]}
        rows={weeks.length ? weeks.map((week) => ({
          key: week.week,
          cells: [
            <span className="mono" key="w">{formatAuditDate(week.week)}</span>,
            <span className="mono" key="n">{week.count}</span>,
            week.documents,
            week.units,
          ],
        })) : [{ key: "none", cells: ["—", "0", "No completions recorded", "—"] }]}
      />
      <h2 className="sec">Overdue renewals ({overdue.length})</h2>
      <DataTable
        cols={["Business Unit", "Department", "Document", "Expiry Date", "Days Overdue", "Notification Date", "Status"]}
        rows={overdue.map((row) => ({
          key: row.key,
          onClick: () => onOpen(row.source),
          cells: [
            row.bu,
            deptBadge(row.department),
            row.name,
            <span className="mono" key="ex">{formatAuditDate(row.expiry) || "—"}</span>,
            <span className="strong-bad mono" key="days">{row.daysOverdue}</span>,
            row.notifiedAt ? <span className="mono" key="nt">{formatAuditStamp(row.notifiedAt)}</span> : <span className="badge b-warn" key="nt">Not sent</span>,
            statusBadge("Overdue"),
          ],
        }))}
      />
      <h2 className="sec">Escalation 1 — Department level ({waiting(l1)} awaiting response)</h2>
      <EscalationTable rows={l1} />
      <h2 className="sec">Escalation 2 — Executive level ({waiting(l2)} awaiting response)</h2>
      <EscalationTable rows={l2} />
    </>
  );
}

function renewalCells(
  row: RenewalAuditRow,
  disabled: boolean,
  run: (label: string, work: () => Promise<unknown>) => void,
) {
  const id = row.source.id;
  let action = <span key="act">{statusBadge("Closed")}{lockTag(true)}</span>;
  if (row.status !== "Closed") {
    action = row.notifiedAt
      ? <button key="act" className="btn btn-outline btn-mini" type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); run("Completion recorded", () => completeCycle(id)); }}>Record completion</button>
      : <button key="act" className="btn btn-outline btn-mini" type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); run("Notification sent", () => sendRenewalNotice(id)); }}>Send notification</button>;
  }
  return [
    row.bu,
    <span key="dept">{deptBadge(row.department)}{row.orgDepartment ? <div style={{ color: "var(--muted)", fontSize: 11 }}>{row.orgDepartment}</div> : null}</span>,
    statusBadge(row.type),
    row.name,
    <span className="mono" key="ex">{formatAuditDate(row.expiry) || "—"}</span>,
    <span className="mono" key="start">{formatAuditDate(row.notificationStart) || "—"}</span>,
    row.notifiedAt ? <span className="mono" key="nt">{formatAuditStamp(row.notifiedAt)}</span> : <span className="badge b-warn" key="nt">Not sent</span>,
    row.completedAt ? <span className="mono" key="done">{formatAuditDate(row.completedAt)}</span> : "—",
    statusBadge(row.status),
    action,
  ];
}
