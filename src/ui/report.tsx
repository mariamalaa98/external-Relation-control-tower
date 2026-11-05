import { useMemo, useState } from "react";
import {
  PRIORITY_BANDS,
  commAuditRow,
  formatAuditStamp,
  groupReplies,
  inDateRange,
  noticeBelongsToLicense,
  noticeDuty,
  noticeSubject,
  openClosedCounts,
  responsibilityByLevel,
  type AuditFact,
  type LevelResponsibility,
  type PersonLoad,
  type ReplyGroup,
} from "../data/auditLogic";
import { downloadExcel, exportFileName, exportLabel, rangeText } from "../data/excelExport";
import { CATS, type AuditRow, type Communication, type License, type Notice, type Party, type Renewal, type ThreadEmail } from "../data/types";
import { DataTable, FilterField, Kpi, PageHead, catBadge, priBadge } from "./widgets";

const AREAS = ["Communications", "Licenses and contracts"] as const;

function namesOf(people: PersonLoad[]) {
  return people.map((person) => person.name).join("; ");
}

function personCell(name: string, accountable: boolean) {
  if (!name) return accountable ? <span className="accountable">Unassigned</span> : "—";
  return accountable ? <span className="accountable">{name}</span> : name;
}

function personChips(people: PersonLoad[], tone: "done" | "open") {
  if (!people.length) return <span className="metric-sub">—</span>;
  return (
    <div className="person-list">
      {people.map((person) => (
        <span className={`person-chip ${tone}`} key={person.name}>{person.name}</span>
      ))}
    </div>
  );
}

function ReplyDashboard({
  title,
  sentLabel,
  groups,
  onPick,
}: {
  title: string;
  sentLabel: string;
  groups: ReplyGroup[];
  onPick?: (key: string) => void;
}) {
  const sent = groups.reduce((sum, group) => sum + group.sent, 0);
  const repliedPeople = new Set(groups.flatMap((group) => group.personsReplied.map((person) => person.name))).size;
  const openPeople = new Set(groups.flatMap((group) => group.personsOpen.map((person) => person.name))).size;
  return (
    <>
      <h2 className="sec">{title}</h2>
      <div className="kpis">
        <Kpi acc="var(--bronze)" label={sentLabel} value={sent} detail="Matching the filters" />
        <Kpi acc="var(--ok)" label="Persons replied" value={repliedPeople} detail="Unique people who answered" />
        <Kpi acc="var(--bad)" label="Persons not replied" value={openPeople} detail="Unique people still accountable" />
      </div>
      <DataTable
        cols={["Category", sentLabel, "Persons replied", "Persons not replied"]}
        rows={groups.map((group) => ({
          key: group.key,
          onClick: onPick ? () => onPick(group.key) : undefined,
          cells: [
            catBadge(group.key),
            <div key="sent">
              <div className="metric-n">{group.sent}</div>
              <div className="metric-sub">{group.replied} answered · {group.notReplied} still open</div>
            </div>,
            <div key="replied">
              <div className="metric-n">{group.personsReplied.length}</div>
              {personChips(group.personsReplied, "done")}
            </div>,
            <div key="open">
              <div className="metric-n">{group.personsOpen.length}</div>
              {personChips(group.personsOpen, "open")}
            </div>,
          ],
        }))}
      />
    </>
  );
}

function ResponsibilityBoard({
  title,
  groups,
}: {
  title: string;
  groups: LevelResponsibility[];
}) {
  const rows = groups.flatMap((group) => {
    const counts = () => [
      priBadge(group.level),
      <span className="mono" key="s">{group.sent}</span>,
      <span className="mono" key="r">{group.replied}</span>,
      <span className="mono" key="n">{group.notReplied}</span>,
    ];
    if (!group.people.length) {
      return [{
        key: group.level,
        cells: [...counts(), "—", "0", "0"],
      }];
    }
    return group.people.map((person) => ({
      key: `${group.level}-${person.name}`,
      cells: [
        ...counts(),
        personCell(person.name, person.open > 0),
        <span className={person.open ? "strong-bad mono" : "mono"} key="own">{person.open}</span>,
        <span className="mono" key="did">{person.replied}</span>,
      ],
    }));
  });
  return (
    <>
      <h2 className="sec">{title}</h2>
      <DataTable
        cols={["Criticality", "Sent", "Replied", "Not replied", "Responsible", "Still open", "Replied by them"]}
        rows={rows}
      />
    </>
  );
}

function categoryExport(groups: ReplyGroup[]) {
  return groups.map((group) => [
    group.key,
    String(group.sent),
    String(group.replied),
    String(group.notReplied),
    String(group.personsReplied.length),
    namesOf(group.personsReplied),
    String(group.personsOpen.length),
    namesOf(group.personsOpen),
  ]);
}

function keepFact(fact: AuditFact, category: string, status: string, criticality = "All") {
  const statusOk = status === "All" || (status === "Open" ? !fact.closed : fact.closed);
  return statusOk
    && (category === "All" || fact.group === category)
    && (criticality === "All" || fact.level === criticality);
}

function responsibilityExport(groups: LevelResponsibility[]) {
  const blank: PersonLoad = { name: "", sent: 0, replied: 0, open: 0 };
  return groups.flatMap((group) => (group.people.length ? group.people : [blank]).map((person) => [
    group.level,
    String(group.sent),
    String(group.replied),
    String(group.notReplied),
    person.name || "—",
    String(person.open),
    String(person.replied),
  ]));
}

export function ReportScreen({
  comms,
  audits,
  threads,
  docs,
  notices,
  renewals,
  parties,
}: {
  comms: Communication[];
  audits: AuditRow[];
  threads: Record<string, ThreadEmail[]>;
  docs: License[];
  notices: Notice[];
  renewals: Renewal[];
  parties: Party[];
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [criticality, setCriticality] = useState("All");
  const [area, setArea] = useState<(typeof AREAS)[number]>("Communications");

  const commRows = useMemo(() => {
    return comms
      .map((comm) => commAuditRow(comm, audits, threads, parties))
      .filter((row) => inDateRange(row.receivedAt, from, to));
  }, [comms, audits, threads, parties, from, to]);

  const commFacts = useMemo(() => {
    const facts: AuditFact[] = [];
    for (const row of commRows) {
      const fact: AuditFact = {
        group: row.category,
        level: row.category,
        replied: !!row.responseAt,
        closed: row.closed,
        owner: row.owner || "Unassigned",
        mustReply: row.mustReply || row.owner || "Unassigned",
        respondedBy: row.respondedBy || row.mustReply || row.owner || "",
      };
      if (keepFact(fact, category, status)) facts.push(fact);
    }
    return facts;
  }, [commRows, category, status]);

  const filteredCommRows = useMemo(() => commRows.filter((row) => {
    const statusOk = status === "All" || (status === "Open" ? !row.closed : row.closed);
    return statusOk && (category === "All" || row.category === category);
  }), [commRows, category, status]);

  const noticeFacts = useMemo(() => {
    const facts: AuditFact[] = [];
    for (const notice of notices) {
      if (!noticeBelongsToLicense(notice, docs)) continue;
      if (!inDateRange(notice.sentOn, from, to)) continue;
      const duty = noticeDuty(notice, docs, renewals);
      const subject = noticeSubject(notice, docs, parties);
      const fact: AuditFact = {
        group: subject.category,
        level: subject.criticality,
        replied: duty.responded,
        closed: duty.responded,
        owner: duty.owner || duty.responsible || "Unassigned",
        mustReply: duty.mustReply || duty.responsible || "Unassigned",
        respondedBy: duty.respondedBy || duty.responsible || "",
      };
      if (keepFact(fact, category, status, criticality)) facts.push(fact);
    }
    return facts;
  }, [notices, docs, renewals, parties, from, to, category, status, criticality]);

  const showComms = area === "Communications";
  const showNotices = area === "Licenses and contracts";
  const categoryOrder = category === "All" ? CATS : [category];
  const levelOrder = criticality === "All" ? PRIORITY_BANDS : [criticality];
  const commByCategory = useMemo(() => groupReplies(commFacts, categoryOrder), [commFacts, categoryOrder]);
  const noticeByCategory = useMemo(() => groupReplies(noticeFacts, categoryOrder), [noticeFacts, categoryOrder]);
  const noticeByLevel = useMemo(() => responsibilityByLevel(noticeFacts, levelOrder), [noticeFacts, levelOrder]);
  const volume = useMemo(() => openClosedCounts(filteredCommRows), [filteredCommRows]);
  const scope = rangeText(from, to);

  function exportExcel() {
    const sections: { name: string; cols: string[]; rows: string[][] }[] = [
      {
        name: "Filters",
        cols: ["From", "To", "Category", "Status", "Records", "Open", "Closed", "Not replied"],
        rows: [[from || "All dates", to || "All dates", category, status, area, String(volume.open), String(volume.closed), String(volume.unreplied)]],
      },
    ];
    if (showComms) {
      sections.push(
        {
          name: "Communications",
          cols: ["CommID", "Party", "Category", "Owner", "Must reply", "Replied by", "Not replied", "Status", "Received"],
          rows: filteredCommRows.map((row) => [
            row.commId, row.party, row.category, row.owner, row.mustReply,
            row.respondedBy || "No response", row.accountable || "", row.status,
            formatAuditStamp(row.receivedAt),
          ]),
        },
        {
          name: "By category",
          cols: ["Category", "Communications sent", "Answered", "Still open", "Persons replied", "Who replied", "Persons not replied", "Who has not replied"],
          rows: categoryExport(commByCategory),
        },
      );
    }
    if (showNotices) {
      sections.push(
        {
          name: "License notifications",
          cols: ["Category", "Notifications sent", "Answered", "Still open", "Persons replied", "Who replied", "Persons not replied", "Who has not replied"],
          rows: categoryExport(noticeByCategory),
        },
        {
          name: "License criticality",
          cols: ["Criticality", "Sent", "Replied", "Not replied", "Responsible", "Still open", "Replied by them"],
          rows: responsibilityExport(noticeByLevel),
        },
      );
    }
    downloadExcel(exportFileName("report", from, to), sections);
  }

  return (
    <>
      <PageHead title="Report" sub={`Counts follow the filters · ${scope}`}>
        <button className="btn btn-outline" type="button" onClick={exportExcel}>{exportLabel(from, to)}</button>
      </PageHead>
      <div className="callout">
        Communications and licenses are separate. Choose <b>Communications</b> or <b>Licenses and contracts</b>, then a type such as Insurance and a date range. Export Excel uses the same filters.
      </div>
      <div className="filters">
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
        <FilterField label="Records">
          <select value={area} onChange={(e) => setArea(e.target.value as (typeof AREAS)[number])}>
            {AREAS.map((name) => <option key={name}>{name}</option>)}
          </select>
        </FilterField>
        {showNotices ? (
          <FilterField label="License criticality">
            <select value={criticality} onChange={(e) => setCriticality(e.target.value)}>
              <option>All</option>
              {PRIORITY_BANDS.map((level) => <option key={level}>{level}</option>)}
            </select>
          </FilterField>
        ) : null}
        <span className="fnote">
          {showComms ? `${filteredCommRows.length} communications` : ""}
          {showComms && showNotices ? " · " : ""}
          {showNotices ? `${noticeFacts.length} notifications` : ""}
          {" · "}{scope}
        </span>
      </div>
      {showComms && (
        <>
          <div className="kpis">
            <Kpi acc="var(--info)" label={`${category === "All" ? "All types" : category} open`} value={volume.open} detail="Not closed" onClick={() => setStatus("Open")} />
            <Kpi acc="var(--ok)" label="Closed" value={volume.closed} detail="Closed in this filter" onClick={() => setStatus("Closed")} />
            <Kpi acc="var(--bad)" label="Not replied" value={volume.unreplied} detail={`${volume.openUnreplied} open with no reply`} />
          </div>
          <ReplyDashboard
            title={`Communications by category · ${scope}`}
            sentLabel="Communications sent"
            groups={commByCategory}
            onPick={(key) => { if ((CATS as readonly string[]).includes(key)) setCategory(key); }}
          />
        </>
      )}
      {showNotices && (
        <>
          <ReplyDashboard
            title={`License and contract notifications by category · ${scope}`}
            sentLabel="Notifications sent"
            groups={noticeByCategory}
            onPick={(key) => { if ((CATS as readonly string[]).includes(key)) setCategory(key); }}
          />
          <ResponsibilityBoard
            title={`License and contract criticality · ${scope}`}
            groups={noticeByLevel}
          />
        </>
      )}
    </>
  );
}
