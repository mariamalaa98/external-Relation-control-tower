import { useMemo, useState } from "react";
import {
  commAuditRow,
  formatAuditStamp,
  inDateRange,
  noticeBelongsToLicense,
  openClosedCounts,
} from "../data/auditLogic";
import { downloadExcel, exportFileName, exportLabel, rangeText } from "../data/excelExport";
import { docState, slaState, unreadNotices } from "../data/store";
import { CATS, type AuditRow, type Communication, type License, type Notice, type Party, type ThreadEmail } from "../data/types";
import { FilterField, Kpi, PageHead } from "./widgets";

export function ExecutiveDashboard({
  live,
  ready,
  missing,
  comms,
  docs,
  notices,
  audits,
  threads,
  parties,
  busy,
  onRefresh,
  go,
}: {
  live: boolean;
  ready: boolean;
  missing: string[];
  comms: Communication[];
  docs: License[];
  notices: Notice[];
  audits: AuditRow[];
  threads: Record<string, ThreadEmail[]>;
  parties: Party[];
  busy: boolean;
  onRefresh: () => void;
  go: (id: "tracker" | "pending" | "escalation" | "renewals" | "notifications" | "auditComm" | "reports") => void;
}) {
  const [category, setCategory] = useState("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = useMemo(
    () => comms.map((comm) => commAuditRow(comm, audits, threads, parties)),
    [comms, audits, threads, parties],
  );
  const filtered = useMemo(() => rows.filter((row) => {
    return (category === "All" || row.category === category) && inDateRange(row.receivedAt, from, to);
  }), [rows, category, from, to]);
  const volume = useMemo(() => openClosedCounts(filtered), [filtered]);
  const openComms = filtered.filter((row) => !row.closed);
  const breached = openComms.filter((row) => row.source.isOverdue || slaState(row.source) === "Breached");
  const closed = filtered.filter((row) => row.closed);
  const compliance = closed.length
    ? Math.round((closed.filter((row) => slaState(row.source) === "Within").length / closed.length) * 100)
    : 0;
  const expiring = docs.filter((d) => {
    const s = docState(d);
    return s === "Expiring" || s === "Expired";
  });
  const unreadNoticeCount = unreadNotices((notices || []).filter((n) => noticeBelongsToLicense(n, docs))).length;
  const kpi = (n: number) => (ready && live ? n : "—");
  const assignedCats = CATS.map((cat) => ({
    cat,
    n: rows.filter((row) => (from || to ? inDateRange(row.receivedAt, from, to) : true) && row.source.categoryAssigned && row.category === cat).length,
  }));
  const unassignedCat = rows.filter((row) => (from || to ? inDateRange(row.receivedAt, from, to) : true) && !row.source.categoryAssigned).length;
  const catCounts = live ? [...assignedCats, ...(unassignedCat ? [{ cat: "Unassigned" as const, n: unassignedCat }] : [])] : assignedCats;
  const maxCat = Math.max(...catCounts.map((x) => x.n), 1);
  const typeLabel = category === "All" ? "all types" : category;

  function exportExcel() {
    downloadExcel(exportFileName("dashboard", from, to), [
      {
        name: "Filters",
        cols: ["From", "To", "Category", "Open", "Closed", "Not replied"],
        rows: [[from || "All dates", to || "All dates", category, String(volume.open), String(volume.closed), String(volume.unreplied)]],
      },
      {
        name: "Communications",
        cols: ["CommID", "Party", "Category", "Owner", "Must reply", "Replied by", "Not replied", "Status", "Received"],
        rows: filtered.map((row) => [
          row.commId, row.party, row.category, row.owner, row.mustReply,
          row.respondedBy || "No response", row.accountable || "", row.status,
          formatAuditStamp(row.receivedAt),
        ]),
      },
    ]);
  }

  return (
    <>
      <PageHead
        title="Executive Dashboard"
        sub={ready
          ? (live
            ? `${filtered.length} communications · ${typeLabel} · ${rangeText(from, to)}`
            : "Live Dataverse is not connected")
          : "Loading Dataverse…"}
      >
        <button className="btn btn-outline" type="button" disabled={busy} onClick={onRefresh}>Refresh</button>
        <button className="btn btn-outline" type="button" onClick={exportExcel}>{exportLabel(from, to)}</button>
      </PageHead>
      {missing.length ? (
        <div className="banner warn">
          {live && ready
            ? <>Some live data is incomplete:</>
            : <>Dashboard is waiting on real Dataverse data:</>}
          <ul className="gaps">
            {missing.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : (
        <div className="callout">
          Filter by a type such as <b>Insurance</b> and a date range to see how many communications are <b>open</b> versus <b>closed</b>, and how many have not been replied to. Export Excel uses the same filter.
        </div>
      )}
      <div className="filters">
        <FilterField label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FilterField>
        <FilterField label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FilterField>
        <FilterField label="Type">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>All</option>
            {CATS.map((cat) => <option key={cat}>{cat}</option>)}
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} communications · {typeLabel} · {rangeText(from, to)}</span>
      </div>
      <div className="kpis">
        <Kpi acc="var(--bronze)" label={`${category === "All" ? "All" : category} communications`} value={kpi(filtered.length)} detail={live ? "Matching the type and dates" : "Waiting for Dataverse"} onClick={() => go("tracker")} />
        <Kpi acc="var(--info)" label="Open (not closed)" value={kpi(volume.open)} detail="Still in progress" onClick={() => go("pending")} />
        <Kpi acc="var(--ok)" label="Closed" value={kpi(volume.closed)} detail="Closed in this filter" onClick={() => go("reports")} />
        <Kpi acc="var(--bad)" label="Not replied" value={kpi(volume.openUnreplied)} detail="Open with no response" onClick={() => go("auditComm")} />
        <Kpi acc="var(--bad)" label="Overdue" value={kpi(breached.length)} detail="Is OverDue column" onClick={() => go("escalation")} />
        <Kpi acc="var(--ok)" label="SLA Compliance" value={ready && live ? `${compliance}%` : "—"} detail={closed.length ? "Closed records in filter" : "No closed records yet"} />
        <Kpi acc="var(--warn)" label="Renewals Due" value={kpi(expiring.length)} detail="Within 90 days / expired" onClick={() => go("renewals")} />
        <Kpi acc="var(--info)" label="Unread notices" value={kpi(unreadNoticeCount)} detail="Reminder / expiry / escalation" onClick={() => go("notifications")} />
      </div>
      <div className="two">
        <div className="card chartcard">
          <h3>Communications by Category</h3>
          <div className="cs">{live ? "Click a type to filter open vs closed" : "Unavailable until Dataverse is connected"}</div>
          <div className="bars">
            {catCounts.map((x) => (
              <div className={`bar${category === x.cat ? " on" : ""}`} key={x.cat} onClick={() => setCategory(x.cat === "Unassigned" ? "All" : x.cat)}>
                <b>{live ? x.n : "—"}</b>
                <i style={{ height: `${live ? (x.n / maxCat) * 70 + 8 : 8}%`, background: x.cat === "Unassigned" ? "var(--warn)" : category === x.cat ? "var(--bad)" : "var(--bronze)" }} />
                <span>{x.cat.slice(0, 3)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card chartcard">
          <h3>Open vs closed · {typeLabel}</h3>
          <div className="cs">{live ? `${volume.open} open · ${volume.closed} closed` : "Unavailable until Dataverse is connected"}</div>
          <div className="donutwrap">
            <div className="donut" data-pct={live ? `${volume.total ? Math.round((volume.closed / volume.total) * 100) : 0}%` : "—"} style={{ background: live
              ? `conic-gradient(var(--ok) 0 ${volume.total ? (volume.closed / volume.total) * 100 : 0}%, var(--info) ${volume.total ? (volume.closed / volume.total) * 100 : 0}% 100%)`
              : "var(--line)" }} />
            <div className="legend">
              <div><i style={{ background: "var(--ok)" }} /> Closed {live ? volume.closed : "—"}</div>
              <div><i style={{ background: "var(--info)" }} /> Open {live ? volume.open : "—"}</div>
              <div><i style={{ background: "var(--bad)" }} /> Not replied {live ? volume.openUnreplied : "—"}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
