import { useMemo, useState } from "react";
import {
  PRIORITY_BANDS,
  commAuditRow,
  groupReplies,
  inDateRange,
  noticeDuty,
  noticeSubject,
  priorityBand,
  responsibilityByLevel,
  type AuditFact,
  type LevelResponsibility,
  type PersonLoad,
  type ReplyGroup,
} from "../data/auditLogic";
import { CATS, type AuditRow, type Communication, type License, type Notice, type Party, type Renewal, type ThreadEmail } from "../data/types";
import { DataTable, FilterField, Kpi, PageHead, catBadge, priBadge } from "./widgets";

const AREAS = ["All", "Communications", "License notifications"] as const;

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

function rangeText(from: string, to: string) {
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `through ${to}`;
  return "all dates";
}

function exportName(from: string, to: string) {
  if (!from && !to) return "report-all-dates.csv";
  return `report-${from || "start"}_to_${to || "end"}.csv`;
}

function exportLabel(from: string, to: string) {
  if (from && to) return `Export ${from} → ${to}`;
  if (from) return `Export from ${from}`;
  if (to) return `Export through ${to}`;
  return "Export all dates";
}

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
  onPick,
}: {
  title: string;
  groups: LevelResponsibility[];
  onPick?: (level: string) => void;
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
        onClick: onPick ? () => onPick(group.level) : undefined,
        cells: [...counts(), "—", "0", "0"],
      }];
    }
    return group.people.map((person) => ({
      key: `${group.level}-${person.name}`,
      onClick: onPick ? () => onPick(group.level) : undefined,
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

function keepFact(fact: AuditFact, category: string, criticality: string) {
  return (category === "All" || fact.group === category)
    && (criticality === "All" || fact.level === criticality);
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
  const [criticality, setCriticality] = useState("All");
  const [area, setArea] = useState<(typeof AREAS)[number]>("All");

  const commFacts = useMemo(() => {
    const facts: AuditFact[] = [];
    for (const comm of comms) {
      const row = commAuditRow(comm, audits, threads);
      if (!inDateRange(row.receivedAt, from, to)) continue;
      const fact: AuditFact = {
        group: row.category,
        level: priorityBand(row.source.pri),
        replied: !!row.responseAt,
        owner: row.owner || "Unassigned",
        respondedBy: row.respondedBy || row.owner || "",
      };
      if (keepFact(fact, category, criticality)) facts.push(fact);
    }
    return facts;
  }, [comms, audits, threads, from, to, category, criticality]);

  const noticeFacts = useMemo(() => {
    const facts: AuditFact[] = [];
    for (const notice of notices) {
      if (!inDateRange(notice.sentOn, from, to)) continue;
      const duty = noticeDuty(notice, docs, renewals);
      const subject = noticeSubject(notice, docs, parties);
      const fact: AuditFact = {
        group: subject.category,
        level: subject.criticality,
        replied: duty.responded,
        owner: duty.responsible || "Unassigned",
        respondedBy: duty.respondedBy || duty.responsible || "",
      };
      if (keepFact(fact, category, criticality)) facts.push(fact);
    }
    return facts;
  }, [notices, docs, renewals, parties, from, to, category, criticality]);

  const showComms = area !== "License notifications";
  const showNotices = area !== "Communications";
  const categoryOrder = category === "All" ? CATS : [category];
  const levelOrder = criticality === "All" ? PRIORITY_BANDS : [criticality];
  const commByCategory = useMemo(() => groupReplies(commFacts, categoryOrder), [commFacts, categoryOrder]);
  const commByLevel = useMemo(() => responsibilityByLevel(commFacts, levelOrder), [commFacts, levelOrder]);
  const noticeByCategory = useMemo(() => groupReplies(noticeFacts, categoryOrder), [noticeFacts, categoryOrder]);
  const noticeByLevel = useMemo(() => responsibilityByLevel(noticeFacts, levelOrder), [noticeFacts, levelOrder]);
  const scope = rangeText(from, to);

  function exportCsv() {
    const sections: { name: string; cols: string[]; rows: string[][] }[] = [
      {
        name: `Report filters — ${scope}`,
        cols: ["From", "To", "Category", "Criticality", "Records"],
        rows: [[from || "All dates", to || "All dates", category, criticality, area]],
      },
    ];
    if (showComms) {
      sections.push(
        {
          name: `Communications by category — ${scope}`,
          cols: ["Category", "Communications sent", "Answered", "Still open", "Persons replied", "Who replied", "Persons not replied", "Who has not replied"],
          rows: categoryExport(commByCategory),
        },
        {
          name: `Communication criticality — ${scope}`,
          cols: ["Criticality", "Sent", "Replied", "Not replied", "Responsible", "Still open", "Replied by them"],
          rows: responsibilityExport(commByLevel),
        },
      );
    }
    if (showNotices) {
      sections.push(
        {
          name: `License notifications by category — ${scope}`,
          cols: ["Category", "Notifications sent", "Answered", "Still open", "Persons replied", "Who replied", "Persons not replied", "Who has not replied"],
          rows: categoryExport(noticeByCategory),
        },
        {
          name: `License criticality — ${scope}`,
          cols: ["Criticality", "Sent", "Replied", "Not replied", "Responsible", "Still open", "Replied by them"],
          rows: responsibilityExport(noticeByLevel),
        },
      );
    }
    downloadCsv(exportName(from, to), sections);
  }

  return (
    <>
      <PageHead title="Report" sub={`Counts follow the filters · ${scope}`}>
        <button className="btn btn-outline" type="button" onClick={exportCsv}>{exportLabel(from, to)}</button>
      </PageHead>
      <div className="callout">
        Choose the dates, category, criticality, and which records to include. Every total on this page, and the export, uses that same filter. Click a category or a criticality to narrow the report.
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
        <FilterField label="Criticality">
          <select value={criticality} onChange={(e) => setCriticality(e.target.value)}>
            <option>All</option>
            {PRIORITY_BANDS.map((level) => <option key={level}>{level}</option>)}
          </select>
        </FilterField>
        <FilterField label="Records">
          <select value={area} onChange={(e) => setArea(e.target.value as (typeof AREAS)[number])}>
            {AREAS.map((name) => <option key={name}>{name}</option>)}
          </select>
        </FilterField>
        <span className="fnote">
          {showComms ? `${commFacts.length} communications` : ""}
          {showComms && showNotices ? " · " : ""}
          {showNotices ? `${noticeFacts.length} notifications` : ""}
          {" · "}{scope}
        </span>
      </div>
      {showComms && (
        <>
          <ReplyDashboard
            title={`Communications by category · ${scope}`}
            sentLabel="Communications sent"
            groups={commByCategory}
            onPick={(key) => { if ((CATS as readonly string[]).includes(key)) setCategory(key); }}
          />
          <ResponsibilityBoard
            title={`Communication criticality and who is responsible · ${scope}`}
            groups={commByLevel}
            onPick={(level) => { if ((PRIORITY_BANDS as readonly string[]).includes(level)) setCriticality(level); }}
          />
        </>
      )}
      {showNotices && (
        <>
          <ReplyDashboard
            title={`License notifications by category · ${scope}`}
            sentLabel="Notifications sent"
            groups={noticeByCategory}
            onPick={(key) => { if ((CATS as readonly string[]).includes(key)) setCategory(key); }}
          />
          <ResponsibilityBoard
            title={`License criticality and who is responsible · ${scope}`}
            groups={noticeByLevel}
            onPick={(level) => { if ((PRIORITY_BANDS as readonly string[]).includes(level)) setCriticality(level); }}
          />
        </>
      )}
    </>
  );
}
