import { useMemo, useState } from "react";
import { chainLevelNumbers } from "../data/communicationLogic";
import {
  commAuditRow,
  commCompliance,
  communicationEscalations,
  formatAuditDate,
  formatAuditStamp,
  inDateRange,
  noticeBelongsToLicense,
  noticeDuty,
  noticeRecipients,
  noticeSubject,
  blameBoard,
  openClosedCounts,
  renewalAuditRow,
  renewalEscalations,
  renewalSummary,
  PRIORITY_BANDS,
  type AuditEscalation,
  type CommAuditRow,
  type RenewalAuditRow,
} from "../data/auditLogic";
import { downloadExcel, exportFileName, exportLabel, rangeText } from "../data/excelExport";
import { completeCycle, markNoticeRead, matchesSearch, sendRenewalNotice } from "../data/store";
import { CATS, type AuditRow, type Communication, type EscalationChain, type License, type Notice, type Party, type Renewal, type ThreadEmail } from "../data/types";
import { DataTable, FilterField, Kpi, PageHead, catBadge, priBadge, statusBadge } from "./widgets";

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

function personCell(name: string, accountable: boolean) {
  if (!name) return accountable ? <span className="accountable">Unassigned</span> : "—";
  return accountable ? <span className="accountable">{name}</span> : name;
}

function peopleCell(names: string[], blame: boolean) {
  if (!names.length) return personCell("", blame);
  return (
    <span>
      {names.map((name, index) => (
        <span key={name}>{index ? "; " : null}{personCell(name, blame)}</span>
      ))}
    </span>
  );
}

const DELAY_ROWS = ["Critical", "High", "Medium", "Low"] as const;
const DELAY_BANDS = [
  { id: 0, label: "Due within 120 days", detail: "Window open, not late", tone: "warn" },
  { id: 1, label: "1 – 30 days late", detail: "Just overdue", tone: "bad" },
  { id: 2, label: "31 – 90 days late", detail: "Serious delay", tone: "bad" },
  { id: 3, label: "Over 90 days late", detail: "Critical delay", tone: "bad" },
] as const;

function delayBand(row: RenewalAuditRow) {
  if (row.status === "Closed") return -1;
  if (row.status === "Overdue") {
    if (row.daysOverdue > 90) return 3;
    if (row.daysOverdue > 30) return 2;
    return 1;
  }
  if (row.inWindow) return 0;
  return -1;
}

function delayLabel(row: RenewalAuditRow) {
  if (row.status === "Overdue") return `${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"} overdue`;
  return "Due within 120 days";
}

function DelayTracker({
  rows,
  onOpen,
  onPickRisk,
}: {
  rows: RenewalAuditRow[];
  onOpen: (row: License) => void;
  onPickRisk: (risk: string) => void;
}) {
  const placed = rows.map((row) => ({ row, band: delayBand(row) })).filter((item) => item.band >= 0);
  return (
    <>
      <h2 className="sec">Delay tracker</h2>
      <div className="callout">
        Same layout as the Risk Matrix, but for <b>delay</b>. The <b>document owner</b> is notified at 120 days and is responsible until the renewal is completed.
      </div>
      <div className="risk-matrix delay">
        <div className="risk-head">
          <div className="risk-corner" />
          {DELAY_BANDS.map((band) => (
            <div className={`risk-colhead ${band.tone}`} key={band.id}>
              <div className="l">{band.label}</div>
              <div className="n">{placed.filter((item) => item.band === band.id).length}</div>
            </div>
          ))}
        </div>
        {DELAY_ROWS.map((risk) => (
          <div className="risk-row" key={risk}>
            <button type="button" className={`risk-rowhead risk-${risk.toLowerCase()}`} onClick={() => onPickRisk(risk)}>{risk}</button>
            {DELAY_BANDS.map((band) => {
              const list = placed
                .filter((item) => item.row.risk === risk && item.band === band.id)
                .sort((a, b) => b.row.daysOverdue - a.row.daysOverdue);
              return (
                <div className={`risk-cell${list.length ? "" : " empty"}`} key={band.id}>
                  {list.length ? list.map(({ row }) => (
                    <button className="risk-card" type="button" key={row.key} onClick={() => onOpen(row.source)}>
                      <div className="nm">{row.name}</div>
                      <div className="meta">
                        {statusBadge(row.type)}
                        <b>{delayLabel(row)}</b>
                      </div>
                      <div className="meta">Notified: {row.notifiedPeople || "—"}</div>
                      <div className="meta">Responsible: <span className="accountable">{row.accountable}</span></div>
                    </button>
                  )) : <span>None</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function groupedEscalations(rows: AuditEscalation[], expected: number[] = []) {
  const levels = [...new Set([...expected, ...rows.map((row) => row.level)])].filter((n) => n > 0).sort((a, b) => a - b);
  return levels.map((level) => {
    const list = rows.filter((row) => row.level === level);
    const tos = [...new Set(list.map((row) => row.to).filter(Boolean))];
    return { level, rows: list, heading: tos.length === 1 ? tos[0] : `Level ${level}` };
  });
}

function waitingCount(list: AuditEscalation[]) {
  return list.filter((row) => !row.responded).length;
}

function EscalationTable({ rows }: { rows: AuditEscalation[] }) {
  return (
    <DataTable
      cols={["Record", "Escalated by", "Escalated on", "Escalated to", "Responded by", "Responded on", "Response lag", "Action taken", "Status"]}
      rows={rows.map((row) => ({
        key: row.key,
        cells: [
          <span key="id">{row.title}{row.subtitle ? <div style={{ color: "var(--muted)", fontSize: 11 }}>{row.subtitle}</div> : null}</span>,
          personCell(row.by, !row.responded),
          <span className="mono" key="recv">{formatAuditStamp(row.receivedAt) || "—"}</span>,
          row.to,
          row.responded ? (row.respondedBy || "—") : "—",
          row.responseAt ? <span className="mono" key="resp">{formatAuditStamp(row.responseAt)}</span> : "—",
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
  parties = [],
  chains = [],
  busy,
  onOpen,
  onRefresh,
}: {
  q: string;
  setQ: (v: string) => void;
  comms: Communication[];
  audits: AuditRow[];
  threads: Record<string, ThreadEmail[]>;
  parties?: Party[];
  chains?: EscalationChain[];
  busy?: boolean;
  onOpen: (row: Communication) => void;
  onRefresh: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [response, setResponse] = useState("All");

  const rows = useMemo(
    () => comms.map((comm) => commAuditRow(comm, audits, threads, parties)),
    [comms, audits, threads, parties],
  );
  const dated = useMemo(() => rows.filter((row) => {
    const hit = matchesSearch(q, row.commId, row.party, row.keyword, row.responseAction, row.category, row.source.subj, row.owner, row.mustReply, row.respondedBy, row.accountable);
    return hit && inDateRange(row.receivedAt, from, to);
  }), [rows, q, from, to]);
  const filtered = useMemo(() => dated.filter((row) => {
    const stateOk = response === "All"
      || (response === "Within 24h" ? row.within24 : response === "Delayed" ? !row.within24 : response === "Not replied" ? !row.responseAt : !!row.responseAt);
    const statusOk = status === "All" || (status === "Open" ? !row.closed : row.status === status);
    return stateOk
      && statusOk
      && (category === "All" || row.category === category);
  }), [dated, category, response, status]);
  const kpis = useMemo(() => commCompliance(filtered), [filtered]);
  const volume = useMemo(() => openClosedCounts(filtered), [filtered]);
  const escalations = useMemo(() => {
    const ids = new Set(filtered.map((row) => row.commId));
    return comms
      .filter((comm) => ids.has(comm.id))
      .flatMap((comm) => communicationEscalations(comm, audits, threads, new Date(), parties, chains));
  }, [comms, audits, threads, parties, chains, filtered]);
  const sections = groupedEscalations(escalations, chainLevelNumbers(chains));

  function exportExcel() {
    downloadExcel(exportFileName("communication-audit", from, to), [
      {
        name: "Filters",
        cols: ["From", "To", "Category", "Status", "Response", "Rows"],
        rows: [[from || "All dates", to || "All dates", category, status, response, String(filtered.length)]],
      },
      {
        name: "Communication register",
        cols: ["CommID", "External Party", "Category", "Subject Keyword", "Received", "Owner", "Must reply", "Replied by", "Not replied", "Response Date", "Response Action", "Status", "Response SLA"],
        rows: filtered.map((row) => [
          row.commId, row.party, row.category, row.keyword,
          formatAuditStamp(row.receivedAt), row.owner, row.mustReply,
          row.respondedBy || "No response", row.accountable || "",
          formatAuditStamp(row.responseAt) || "No Response",
          row.responseAction, row.status, row.within24 ? "Within 24h" : "Delayed",
        ]),
      },
      {
        name: "Escalations",
        cols: ["Level", "CommID", "Party", "Escalated by", "Escalated on", "Escalated to", "Responded by", "Responded on", "Response Lag", "Action Taken", "Status"],
        rows: escalations.map((row) => [
          `Level ${row.level}`, row.title, row.subtitle, row.by, formatAuditStamp(row.receivedAt), row.to,
          row.respondedBy || "No response", formatAuditStamp(row.responseAt) || "No Response", row.lag, row.action,
          row.responded ? "Responded" : "No Response",
        ]),
      },
    ]);
  }

  return (
    <>
      <PageHead title="Communication Audit View" sub={`Read-only · ${filtered.length} of ${rows.length} records · ${rangeText(from, to)}`}>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onRefresh}>↻ Refresh</button>
        <button className="btn btn-outline" type="button" onClick={exportExcel}>{exportLabel(from, to)}</button>
      </PageHead>
      <div className="callout">
        Auditor view. Each row shows the <b>owner</b>, who <b>must reply</b>, who <b>replied</b>, and who has <b>not replied</b>. Set <b>From</b> and <b>To</b>, then export Excel for that period.
      </div>
      <div className="kpis">
        <Kpi acc="var(--info)" label="Open (not closed)" value={volume.open} detail={`${volume.closed} closed in this filter`} onClick={() => setStatus("Open")} />
        <Kpi acc="var(--bad)" label="Not replied" value={volume.unreplied} detail={`${volume.openUnreplied} still open with no reply`} onClick={() => setResponse("Not replied")} />
        <Kpi acc="var(--ok)" label="Responded within 24 hours" value={kpis.within} detail={`of ${kpis.total} communications`} onClick={() => setResponse("Within 24h")} />
        <Kpi acc="var(--bronze)" label="Response compliance" value={`${kpis.pct}%`} detail="Within-24h ÷ rows in filter" onClick={() => setResponse("Within 24h")} />
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search CommID, party, owner or who must reply" value={q} onInput={(e) => setQ(e.currentTarget.value)} onChange={(e) => setQ(e.target.value)} />
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
        <FilterField label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>All</option>
            <option>Open</option>
            <option>Closed</option>
          </select>
        </FilterField>
        <FilterField label="Reply">
          <select value={response} onChange={(e) => setResponse(e.target.value)}>
            <option>All</option>
            <option>Not replied</option>
            <option>Replied</option>
            <option>Within 24h</option>
            <option>Delayed</option>
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} shown · {rangeText(from, to)}</span>
      </div>
      <DataTable
        cols={["CommID", "External Party", "Category", "Owner", "Must reply", "Replied by", "Not replied", "Received", "Status", "Response SLA"]}
        rows={filtered.map((row) => ({
          key: row.key,
          onClick: () => onOpen(row.source),
          legal: row.category === "Legal",
          cells: commCells(row),
        }))}
      />
      <div className="card sumbar">
        <span>Open: <b style={{ color: "var(--info)" }}>{volume.open}</b></span>
        <span>Closed: <b style={{ color: "var(--ok)" }}>{volume.closed}</b></span>
        <span>Not replied: <b style={{ color: "var(--bad)" }}>{volume.unreplied}</b></span>
        <span>Within 24h: <b style={{ color: "var(--ok)" }}>{kpis.within}</b></span>
      </div>
      {sections.map((section) => (
        <div key={section.level}>
          <h2 className="sec">Escalation {section.level} — {section.heading} ({waitingCount(section.rows)} awaiting response)</h2>
          <EscalationTable rows={section.rows} />
        </div>
      ))}
    </>
  );
}

function commCells(row: CommAuditRow) {
  return [
    row.commId,
    row.party,
    catBadge(row.category),
    row.owner,
    personCell(row.mustReply, !row.responseAt),
    row.respondedBy || "—",
    row.accountable ? personCell(row.accountable, true) : "—",
    <span className="mono" key="rec">{formatAuditStamp(row.receivedAt) || "—"}</span>,
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
  chains = [],
  busy,
  unreadCount = 0,
  onOpen,
  onDone,
  onFail,
}: {
  q: string;
  setQ: (v: string) => void;
  docs: License[];
  notices: Notice[];
  renewals: Renewal[];
  parties: Party[];
  chains?: EscalationChain[];
  busy?: boolean;
  unreadCount?: number;
  onOpen: (row: License) => void;
  onDone: (message: string) => void;
  onFail: (message: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [department, setDepartment] = useState("All");
  const [type, setType] = useState("All");
  const [status, setStatus] = useState("All");
  const [risk, setRisk] = useState("All");
  const [bu, setBu] = useState("All");
  const [working, setWorking] = useState("");

  const rows = useMemo(
    () => docs.map((doc) => renewalAuditRow(doc, notices, renewals, parties, chains)),
    [docs, notices, renewals, parties, chains],
  );
  const summary = useMemo(() => renewalSummary(rows), [rows]);
  const units = useMemo(() => [...new Set(rows.map((row) => row.bu).filter((name) => name && name !== "—"))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const hit = matchesSearch(q, row.name, row.bu, row.department, row.orgDepartment, row.type, row.source.id, row.source.party, row.accountable, row.notifiedPeople);
    const statusOk = status === "All"
      || (status === "Due within 120 days" ? row.inWindow : row.status === status);
    return hit
      && statusOk
      && (department === "All" || row.department === department)
      && (type === "All" || row.type === type)
      && (risk === "All" || row.risk === risk)
      && (bu === "All" || row.bu === bu)
      && inDateRange(row.expiry, from, to);
  }), [rows, q, from, to, department, type, status, risk, bu]);
  const escalations = useMemo(() => {
    const keys = new Set(filtered.map((row) => row.key));
    return docs.flatMap((doc) => {
      const row = rows.find((item) => item.key === (doc.recordId || doc.id));
      if (!row || !keys.has(row.key)) return [];
      return renewalEscalations(doc, row, notices, renewals);
    });
  }, [docs, rows, notices, renewals, filtered]);
  const sections = groupedEscalations(escalations);
  const noticePacks = useMemo(() => notices
    .filter((notice) => noticeBelongsToLicense(notice, docs))
    .map((notice) => {
      const duty = noticeDuty(notice, docs, renewals);
      const subject = noticeSubject(notice, docs, parties);
      const docKey = subject.doc ? (subject.doc.recordId || subject.doc.id) : "";
      const cycle = docKey ? rows.find((item) => item.key === docKey) : undefined;
      return { notice, duty, subject, cycle };
    }), [notices, docs, renewals, parties, rows]);
  const noticeDated = useMemo(() => noticePacks.filter(({ notice, duty, subject }) => {
    const hit = matchesSearch(q, notice.title, notice.documentName, notice.owner, notice.message, duty.respondedBy, duty.responsible, subject.category, subject.criticality);
    return hit && inDateRange(notice.sentOn, from, to);
  }), [noticePacks, q, from, to]);
  const noticeRows = useMemo(() => noticeDated.filter(({ cycle }) => {
    if (!cycle) return false;
    const statusOk = status === "All" || (status === "Due within 120 days" ? cycle.inWindow : cycle.status === status);
    return statusOk
      && (department === "All" || cycle.department === department)
      && (type === "All" || cycle.type === type)
      && (risk === "All" || cycle.risk === risk)
      && (bu === "All" || cycle.bu === bu);
  }), [noticeDated, department, type, status, risk, bu]);
  const blameRows = useMemo(() => blameBoard(filtered), [filtered]);

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

  function exportExcel() {
    downloadExcel(exportFileName("notification-audit", from, to), [
      {
        name: "Filters",
        cols: ["From", "To", "Department filter", "Type filter", "Status filter", "Risk filter", "Business unit filter", "Renewal rows", "Notifications"],
        rows: [[from || "All dates", to || "All dates", department, type, status, risk, bu, String(filtered.length), String(noticeRows.length)]],
      },
      {
        name: "Who to blame",
        cols: ["Person", "Highest risk", "Overdue", "Due within 120 days", "Open", "Documents"],
        rows: blameRows.map((row) => [row.person, row.risk, String(row.overdue), String(row.window), String(row.open), row.documents]),
      },
      {
        name: "Renewal cycles",
        cols: ["Business Unit", "Related Department", "Renewal Type", "Document", "Risk", "Expiry Date", "Notification Start (E-120)", "Notification Date", "Notified persons", "Responsible", "Renewal Completion", "Current Status"],
        rows: filtered.map((row) => [
          row.bu, row.department, row.type, row.name, row.risk, row.expiry,
          formatAuditDate(row.notificationStart), formatAuditStamp(row.notifiedAt),
          row.notifiedPeople, row.status === "Closed" ? "" : row.accountable,
          formatAuditDate(row.completedAt), row.status,
        ]),
      },
      {
        name: "Escalations",
        cols: ["Level", "Document", "Department", "Escalated by", "Escalated on", "Escalated to", "Responded by", "Responded on", "Response Lag", "Action Taken", "Status"],
        rows: escalations.map((row) => [
          `Level ${row.level}`, row.title, row.subtitle, row.by, formatAuditStamp(row.receivedAt), row.to,
          row.respondedBy || "No response", formatAuditStamp(row.responseAt) || "No Response", row.lag, row.action,
          row.responded ? "Responded" : "No Response",
        ]),
      },
      {
        name: "License notifications",
        cols: ["Sent on", "Type", "Title", "Document", "Risk", "Notified persons", "Responsible", "Responded by", "Responded on"],
        rows: noticeRows.map(({ notice, duty, subject }) => [
          formatAuditStamp(notice.sentOn), notice.type, notice.title, notice.documentName || "",
          subject.criticality, noticeRecipients(notice, subject.doc, parties, chains).join("; ") || duty.responsible,
          duty.responded ? "" : duty.responsible,
          duty.respondedBy || "No response", formatAuditStamp(duty.respondedAt) || "No response",
        ]),
      },
    ]);
  }

  return (
    <>
      <PageHead title="License & Contract Audit" sub={`${unreadCount} unread reminders · ${filtered.length} renewal cycles · ${rangeText(from, to)}`}>
        <button className="btn btn-outline" type="button" onClick={exportExcel}>{exportLabel(from, to)}</button>
      </PageHead>
      <div className="callout">
        This page is <b>licenses, contracts and permits only</b>. The <b>document owner</b> is notified when the 120-day window opens, and stays <b>responsible</b> until the renewal is completed. If the case is escalated, the escalation-chain people are also notified. Use <b>Who to blame</b> when nobody completed the work.
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
        <FilterField label="Risk">
          <select value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option>All</option>
            {PRIORITY_BANDS.map((level) => <option key={level}>{level}</option>)}
          </select>
        </FilterField>
        <FilterField label="Business Unit">
          <select value={bu} onChange={(e) => setBu(e.target.value)}>
            <option>All</option>
            {units.map((name) => <option key={name}>{name}</option>)}
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} license/contract renewals · {noticeRows.length} document notifications · risk {risk} · {rangeText(from, to)}</span>
      </div>
      <DelayTracker rows={filtered} onOpen={onOpen} onPickRisk={(level) => setRisk(level === risk ? "All" : level)} />
      <h2 className="sec">Who to blame ({blameRows.length})</h2>
      <div className="callout">
        <b>Responsible</b> is the document owner. That person is emailed when the reminder is created. If the renewal is still open or overdue, this is who the auditor blames. <b>Unassigned</b> means the document has no owner.
      </div>
      <DataTable
        cols={["Person", "Highest risk", "Overdue", "Due within 120 days", "Open", "Documents"]}
        rows={blameRows.length ? blameRows.map((row) => ({
          key: row.person,
          cells: [
            personCell(row.person, row.overdue > 0 || row.open > 0),
            priBadge(row.risk),
            <span className={row.overdue ? "strong-bad mono" : "mono"} key="od">{row.overdue}</span>,
            <span className="mono" key="win">{row.window}</span>,
            <span className="mono" key="open">{row.open}</span>,
            row.documents || "—",
          ],
        })) : [{ key: "none", cells: ["No open renewals in this filter", "—", "0", "0", "0", "—"] }]}
      />
      <DataTable
        cols={["Business Unit", "Related Department", "Renewal Type", "Document", "Risk", "Expiry Date", "Notification Start (E-120)", "Notification Date", "Notified persons", "Responsible", "Renewal Completion", "Current Status", "Action"]}
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
      <h2 className="sec">License and contract notifications ({noticeRows.length})</h2>
      <DataTable
        cols={["Sent on", "Type", "Title", "Document", "Risk", "Notified persons", "Responsible", "Responded by", "Responded on", "Accountability", ""]}
        rows={noticeRows.map(({ notice, duty, subject }) => ({
          key: notice.recordId || notice.id,
          onClick: () => {
            const doc = docs.find((row) => row.recordId === notice.documentId || row.id === notice.documentId || row.name === notice.documentName);
            if (doc) onOpen(doc);
          },
          cells: [
            <span className="mono" key="sent">{formatAuditStamp(notice.sentOn) || "—"}</span>,
            statusBadge(notice.type),
            notice.isRead ? notice.title : <b key="title">{notice.title}</b>,
            notice.documentName || "—",
            priBadge(subject.criticality),
            peopleCell(noticeRecipients(notice, subject.doc, parties, chains), false),
            duty.responded ? "—" : personCell(duty.responsible, true),
            duty.respondedBy || "—",
            duty.respondedAt ? <span className="mono" key="at">{formatAuditStamp(duty.respondedAt)}</span> : "—",
            responseBadge(duty.responded),
            notice.isRead
              ? statusBadge("Read")
              : (
                <button
                  className="btn btn-outline btn-mini"
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void markNoticeRead(notice.id);
                  }}
                >
                  Mark read
                </button>
              ),
          ],
        }))}
      />
      {sections.map((section) => (
        <div key={section.level}>
          <h2 className="sec">Escalation {section.level} — {section.heading} ({waitingCount(section.rows)} awaiting response)</h2>
          <EscalationTable rows={section.rows} />
        </div>
      ))}
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
    priBadge(row.risk),
    <span className="mono" key="ex">{formatAuditDate(row.expiry) || "—"}</span>,
    <span className="mono" key="start">{formatAuditDate(row.notificationStart) || "—"}</span>,
    row.notifiedAt ? <span className="mono" key="nt">{formatAuditStamp(row.notifiedAt)}</span> : <span className="badge b-warn" key="nt">Not sent</span>,
    row.notifiedPeople || "—",
    row.status === "Closed" ? "—" : personCell(row.accountable, true),
    row.completedAt ? <span className="mono" key="done">{formatAuditDate(row.completedAt)}</span> : "—",
    statusBadge(row.status),
    action,
  ];
}
