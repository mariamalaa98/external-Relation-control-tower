import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  BUS,
  CATS,
  COMM_STATUSES,
  MAILBOX_MAHA,
  MAILBOX_PROD,
  MAILBOX_TEST,
  OWNERS,
  PRIS,
  SUPS,
  type Category,
  type Communication,
  type IntakeEmail,
  type License,
  type Priority,
} from "./data/types";
import {
  ME,
  TODAY,
  addComm,
  addParty,
  closeComm,
  commLocked,
  daysBetween,
  dateOnly,
  docState,
  escalateManually,
  escalateLicense,
  canManualEscalate,
  formatDateTime,
  refresh,
  reopenComm,
  renewDoc,
  respondToComm,
  routeEmail,
  runAutomaticEscalation,
  runLicenseMonitor,
  tickFormulas,
  slaState,
  summarizeMonitor,
  unreadNotices,
  useStore,
  matchesSearch,
  partyOrgOptions,
  partyMatchesOrg,
  commMatchesOrg,
  docMatchesOrg,
  loadCommunicationById,
  parseCommunicationDeepLink,
} from "./data/store";
import { DataTable, FilterField, Kpi, Overlay, OrgFilterFields, PageHead, catBadge, flagBadge, priBadge, statusBadge } from "./ui/widgets";
import { CloseCommForm, CommRecordForm, EscalationCenter } from "./ui/communication";
import { LicenseCreateForm, LicenseEscalationPanel, LicenseRecordForm, LicenseTracker, NotificationCenter, RenewalTaskTable } from "./ui/license";
import { ArchiveUploadForm, DocumentArchiveScreen } from "./ui/archive";
import { CommunicationAuditScreen, NotificationAuditScreen } from "./ui/audit";

const NAV = [
  { area: "ops", group: "COMMAND CENTER", items: [
    { id: "dashboard", ico: "▦", text: "Executive Dashboard" },
    { id: "pending", ico: "☑", text: "My Pending Actions" },
  ]},
  { area: "ops", group: "COMMUNICATIONS", items: [
    { id: "intake", ico: "✉", text: "Central Mailbox" },
    { id: "tracker", ico: "☰", text: "Communication Tracker" },
    { id: "legal", ico: "⚖", text: "Legal Cases Notification" },
  ]},
  { area: "comp", group: "LICENSES & CONTRACTS", items: [
    { id: "licenses", ico: "📄", text: "License & Contract Tracker" },
    { id: "renewals", ico: "▦", text: "Renewal Calendar" },
  ]},
  { area: "comp", group: "REFERENCE DATA", items: [
    { id: "parties", ico: "🏛", text: "External Party Master" },
    { id: "archive", ico: "🗂", text: "Document Archive" },
  ]},
  { area: "gov", group: "ESCALATION & NOTIFICATIONS", items: [
    { id: "escalation", ico: "▲", text: "Escalation Center" },
    { id: "notifications", ico: "🔔", text: "Notification Center" },
  ]},
  { area: "gov", group: "ADMIN", items: [
    { id: "admin", ico: "⚙", text: "Admin Configuration" },
  ]},
  { area: "gov", group: "REPORTS", items: [
    { id: "reports", ico: "📊", text: "Power BI Reports" },
  ]},
  { area: "gov", group: "AUDIT", items: [
    { id: "auditComm", ico: "🔍", text: "Communication Audit" },
    { id: "auditNotif", ico: "🔍", text: "Notification Audit" },
  ]},
] as const;

function padCal(n: number) {
  return String(n).padStart(2, "0");
}

const AREAS = [
  { id: "ops", label: "Communications" },
  { id: "comp", label: "Licenses & Contracts" },
  { id: "gov", label: "Governance & Audit" },
] as const;

type ScreenId = (typeof NAV)[number]["items"][number]["id"];
type AreaId = (typeof AREAS)[number]["id"];
const LATER: ScreenId[] = [];

function dashboardMissing(opts: {
  live: boolean;
  ready: boolean;
  error?: string;
  warnings?: string[];
  comms: Communication[];
  docs: License[];
  parties: { email?: string; domain?: string }[];
}) {
  if (!opts.ready) return ["Still loading Dataverse. Dashboard numbers are not ready yet."];
  if (!opts.live) {
    return [opts.error
      ? `Not connected to live Dataverse (${opts.error}). Refresh after opening the app with pa app run.`
      : "Not connected to live Dataverse. Open this app with pa app run so the dashboard can read the erc_ tables."];
  }
  const gaps = [...(opts.warnings || [])];
  const noOwner = opts.comms.filter((c) => !c.owner?.trim()).length;
  const noParty = opts.comms.filter((c) => !c.partyId && !c.party?.trim()).length;
  const noCat = opts.comms.filter((c) => !c.categoryAssigned).length;
  const noDue = opts.comms.filter((c) => !c.due?.trim()).length;
  const noSla = opts.comms.filter((c) => !c.slaId && !c.slaName?.trim()).length;
  const docOwner = opts.docs.filter((d) => !d.owner?.trim()).length;
  const docExpiry = opts.docs.filter((d) => !d.expiry?.trim()).length;
  const docParty = opts.docs.filter((d) => !d.partyId && !d.party?.trim()).length;
  const partyContact = opts.parties.filter((p) => !p.email?.trim() && !p.domain?.trim()).length;
  if (noOwner) gaps.push(`${noOwner} communication${noOwner === 1 ? "" : "s"} missing Owner.`);
  if (noParty) gaps.push(`${noParty} communication${noParty === 1 ? "" : "s"} missing External Party.`);
  if (noCat) gaps.push(`${noCat} communication${noCat === 1 ? "" : "s"} missing Category.`);
  if (noDue) gaps.push(`${noDue} communication${noDue === 1 ? "" : "s"} missing Due Date.`);
  if (noSla) gaps.push(`${noSla} communication${noSla === 1 ? "" : "s"} missing SLA.`);
  if (docOwner) gaps.push(`${docOwner} license/contract${docOwner === 1 ? "" : "s"} missing Owner.`);
  if (docExpiry) gaps.push(`${docExpiry} license/contract${docExpiry === 1 ? "" : "s"} missing Expiry Date.`);
  if (docParty) gaps.push(`${docParty} license/contract${docParty === 1 ? "" : "s"} missing External Party.`);
  if (partyContact) gaps.push(`${partyContact} external part${partyContact === 1 ? "y" : "ies"} missing email and domain.`);
  return gaps;
}

class OverlayError extends Component<{ children: ReactNode; onReset: () => void }, { message: string }> {
  state = { message: "" };
  static getDerivedStateFromError(err: Error) {
    return { message: err.message || String(err) };
  }
  render() {
    if (this.state.message) {
      return (
        <>
          <div className="scrim open" onClick={this.props.onReset} />
          <div className="banner warn" style={{ position: "fixed", zIndex: 70, left: 16, right: 16, top: 56 }}>
            Communication overlay failed: {this.state.message}{" "}
            <button className="btn btn-outline" type="button" onClick={this.props.onReset}>Close</button>
          </div>
        </>
      );
    }
    return this.props.children;
  }
}

type Modal =
  | { kind: "party" }
  | { kind: "comm" }
  | { kind: "doc" }
  | { kind: "process"; mail: IntakeEmail }
  | { kind: "respond"; comm: Communication }
  | { kind: "close"; comm: Communication }
  | { kind: "reopen"; comm: Communication }
  | { kind: "evidence"; comm: Communication }
  | { kind: "escalate"; comm: Communication }
  | { kind: "escalateDoc"; doc: License }
  | { kind: "docDetail"; doc: License }
  | null;

export default function App() {
  const db = useStore();
  const [area, setArea] = useState<AreaId>("ops");
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [drawer, setDrawer] = useState<Communication | null>(null);
  const [calMonth, setCalMonth] = useState(() => TODAY.slice(0, 7));
  const [calView, setCalView] = useState<"cal" | "list" | "risk">("cal");
  const [orgBu, setOrgBu] = useState("All");
  const [orgDept, setOrgDept] = useState("All");
  const [escTab, setEscTab] = useState<"comms" | "licenses">("comms");
  const [navOpen, setNavOpen] = useState(false);
  const lastDeepLink = useRef("");

  useEffect(() => {
    const id = window.setInterval(() => {
      void tickFormulas();
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [navOpen]);

  async function openFromDeepLink(guid: string) {
    const clean = guid.replace(/[{}]/g, "").toLowerCase();
    if (!clean || lastDeepLink.current === clean) return;
    lastDeepLink.current = clean;
    setBusy(true);
    try {
      const row = await loadCommunicationById(guid);
      if (!row) {
        ping("This deeplink did not match a communication GUID");
        lastDeepLink.current = "";
        return;
      }
      setArea("ops");
      setScreen("tracker");
      setDrawer({ ...row, log: row.log || [] });
    } catch (err) {
      lastDeepLink.current = "";
      ping(err instanceof Error ? err.message : "Deeplink failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!db.ready) return;
    const guid = parseCommunicationDeepLink();
    if (guid) void openFromDeepLink(guid);
  }, [db.ready]);

  function go(id: ScreenId) {
    const found = NAV.find((g) => g.items.some((i) => i.id === id));
    if (found) setArea(found.area);
    setScreen(id);
    setQ("");
    setNavOpen(false);
  }
  function ping(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2400);
  }
  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      ping(label);
    } catch (err) {
      ping(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const orgOpts = useMemo(
    () => partyOrgOptions(db.parties, orgBu, db.businessUnits, { comms: db.comms, docs: db.docs, departments: db.departments }),
    [db.parties, db.comms, db.docs, db.businessUnits, db.departments, orgBu],
  );
  const scopedParties = useMemo(
    () => db.parties.filter((p) => partyMatchesOrg(p, orgBu, orgDept, db.businessUnits, db.departments)),
    [db.parties, db.businessUnits, db.departments, orgBu, orgDept],
  );
  const scopedComms = useMemo(
    () => db.comms.filter((c) => commMatchesOrg(c, orgBu, orgDept, db.parties, db.businessUnits, db.departments)),
    [db.comms, db.parties, db.businessUnits, db.departments, orgBu, orgDept],
  );
  const scopedDocs = useMemo(
    () => db.docs.filter((d) => docMatchesOrg(d, orgBu, orgDept, db.parties, db.businessUnits, db.departments)),
    [db.docs, db.parties, db.businessUnits, db.departments, orgBu, orgDept],
  );
  const scopedIntake = useMemo(
    () => db.intake.filter((x) => {
      if (orgBu === "All" && orgDept === "All") return true;
      const party = db.parties.find((p) => p.name === x.match);
      return !!party && partyMatchesOrg(party, orgBu, orgDept, db.businessUnits, db.departments);
    }),
    [db.intake, db.parties, db.businessUnits, db.departments, orgBu, orgDept],
  );

  const openComms = scopedComms.filter((c) => c.status !== "Closed");
  const pending = scopedComms.filter((c) => c.status !== "Closed" && (c.status === "In Progress" || !c.isEscalated));
  const breached = openComms.filter((c) => c.isOverdue || slaState(c) === "Breached");
  const expiring = scopedDocs.filter((d) => {
    const s = docState(d);
    return s === "Expiring" || s === "Expired";
  });
  const closed = scopedComms.filter((c) => c.status === "Closed");
  const compliance = closed.length
    ? Math.round((closed.filter((c) => slaState(c) === "Within").length / closed.length) * 100)
    : 0;
  const live = db.source === "dataverse";
  const kpi = (n: number) => (db.ready && live ? n : "—");
  const missing = dashboardMissing({
    live,
    ready: db.ready,
    error: db.error,
    warnings: db.warnings,
    comms: scopedComms,
    docs: scopedDocs,
    parties: scopedParties,
  });
  const assignedCats = CATS.map((cat) => ({ cat, n: scopedComms.filter((c) => c.categoryAssigned && c.cat === cat).length }));
  const unassignedCat = scopedComms.filter((c) => !c.categoryAssigned).length;
  const catCounts = live ? [...assignedCats, ...(unassignedCat ? [{ cat: "Unassigned" as const, n: unassignedCat }] : [])] : assignedCats;
  const maxCat = Math.max(...catCounts.map((x) => x.n), 1);
  const unprocessed = db.intake.filter((x) => x.status !== "Routed");
  const unreadNoticeCount = unreadNotices(db.notices || []).length;
  const overdueDocs = scopedDocs.filter((d) => d.isOverdue && !d.done);
  const liveDrawer = drawer ? db.comms.find((c) => c.id === drawer.id || c.recordId === drawer.recordId) || drawer : null;

  return (
    <>
      <header>
        <button type="button" className="nav-toggle" aria-label="Open menu" onClick={() => setNavOpen(true)}>☰</button>
        <span className="brand">Andalusia Pulse</span>
        <div className="toptabs">
          {AREAS.map((a) => (
            <button
              key={a.id}
              className={`toptab${area === a.id ? " on" : ""}`}
              onClick={() => {
                setArea(a.id);
                setScreen(NAV.find((g) => g.area === a.id)!.items[0].id);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="hdr-right">
          <span className="hdr-icon" title="New communication" onClick={() => setModal({ kind: "comm" })}>+</span>
          <div className="avatar">MA</div>
        </div>
      </header>
      <div className={`nav-scrim${navOpen ? " open" : ""}`} onClick={() => setNavOpen(false)} />
      <div className="shell">
        <aside className={navOpen ? "open" : ""}>
          <div className="profile">
            <div className="ini">ER</div>
            <div>
              <div className="t">External Relations</div>
              <div className="r">Control Tower</div>
            </div>
            <button type="button" className="nav-close" aria-label="Close menu" onClick={() => setNavOpen(false)}>×</button>
          </div>
          {NAV.filter((g) => g.area === area).map((g) => (
            <div key={g.group}>
              <div className="grouplabel">{g.group}</div>
              {g.items.map((i) => (
                <button key={i.id} className={`nav${screen === i.id ? " active" : ""}`} onClick={() => go(i.id)}>
                  <span className="ico">{i.ico}</span>
                  <span>{i.text}</span>
                  {i.id === "intake" && unprocessed.length > 0 ? <span className="dot" /> : null}
                  {i.id === "notifications" && unreadNoticeCount > 0 ? <span className="dot" /> : null}
                  {i.id === "escalation" && overdueDocs.length > 0 ? <span className="dot" /> : null}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <main>
          {!LATER.includes(screen) && screen !== "admin" ? (
            <div className="filters org-filters">
              <OrgFilterFields
                businessUnits={orgOpts.businessUnits}
                departments={orgOpts.departments}
                bu={orgBu}
                dept={orgDept}
                onBu={(next) => {
                  setOrgBu(next);
                  const depts = partyOrgOptions(db.parties, next, db.businessUnits, { comms: db.comms, docs: db.docs, departments: db.departments }).departments;
                  if (orgDept !== "All" && !depts.some((name) => name.toLowerCase() === orgDept.toLowerCase())) setOrgDept("All");
                }}
                onDept={setOrgDept}
              />
            </div>
          ) : null}

          {screen === "dashboard" && (
            <>
              <PageHead
                title="Executive Dashboard"
                sub={db.ready
                  ? (live
                    ? `${scopedComms.length} communications · ${scopedDocs.length} documents · live Dataverse`
                    : "Live Dataverse is not connected")
                  : "Loading Dataverse…"}
              >
                <button className="btn btn-outline" type="button" disabled={busy} onClick={() => run("Register refreshed", refresh)}>Refresh</button>
              </PageHead>
              {missing.length ? (
                <div className={`banner ${live && db.ready ? "warn" : "warn"}`}>
                  {live && db.ready
                    ? <>Some live data is incomplete:</>
                    : <>Dashboard is waiting on real Dataverse data:</>}
                  <ul className="gaps">
                    {missing.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="callout">Figures below are counted from live Dataverse communications, licenses, renewals, and notifications.</div>
              )}
              <div className="kpis">
                <Kpi acc="var(--bronze)" label="Total Communications" value={kpi(scopedComms.length)} detail={live ? "erc_communications" : "Waiting for Dataverse"} onClick={() => go("tracker")} />
                <Kpi acc="var(--info)" label="In Progress" value={kpi(openComms.length)} detail="Not closed" onClick={() => go("pending")} />
                <Kpi acc="var(--bad)" label="Overdue" value={kpi(breached.length)} detail="Is OverDue column" onClick={() => go("escalation")} />
                <Kpi acc="var(--ok)" label="SLA Compliance" value={db.ready && live ? `${compliance}%` : "—"} detail={closed.length ? "Closed records" : "No closed records yet"} />
                <Kpi acc="var(--warn)" label="Renewals Due" value={kpi(expiring.length)} detail="Within 90 days / expired" onClick={() => go("renewals")} />
                <Kpi acc="var(--bad)" label="Expired licenses" value={kpi(overdueDocs.length)} detail="Expiry reached, not renewed" onClick={() => go("escalation")} />
                <Kpi acc="var(--info)" label="Unread notices" value={kpi(unreadNoticeCount)} detail="Reminder / expiry / escalation" onClick={() => go("notifications")} />
              </div>
              <div className="two">
                <div className="card chartcard">
                  <h3>Communications by Category</h3>
                  <div className="cs">{live ? "From erc_CategoryF on live records" : "Unavailable until Dataverse is connected"}</div>
                  <div className="bars">
                    {catCounts.map((x) => (
                      <div className="bar" key={x.cat} onClick={() => go("tracker")}>
                        <b>{live ? x.n : "—"}</b>
                        <i style={{ height: `${live ? (x.n / maxCat) * 70 + 8 : 8}%`, background: x.cat === "Unassigned" ? "var(--warn)" : "var(--bronze)" }} />
                        <span>{x.cat.slice(0, 3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card chartcard">
                  <h3>SLA mix</h3>
                  <div className="cs">{live ? `Closed-item compliance ${compliance}%` : "Unavailable until Dataverse is connected"}</div>
                  <div className="donutwrap">
                    <div className="donut" data-pct={live ? `${compliance}%` : "—"} style={{ background: live
                      ? `conic-gradient(var(--ok) 0 ${compliance}%, var(--gold) ${compliance}% ${Math.min(100, compliance + 10)}%, var(--bad) ${Math.min(100, compliance + 10)}% 100%)`
                      : "var(--line)" }} />
                    <div className="legend">
                      <div><i style={{ background: "var(--ok)" }} /> Within SLA</div>
                      <div><i style={{ background: "var(--gold)" }} /> At risk</div>
                      <div><i style={{ background: "var(--bad)" }} /> Breached</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {screen === "pending" && (
            <>
              <PageHead title="My Pending Actions" sub={`${pending.length} in progress or not escalated`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal({ kind: "comm" })}>New Communication</button>
              </PageHead>
              <CommTable rows={pending} q={q} setQ={setQ} onOpen={setDrawer} />
            </>
          )}

          {screen === "intake" && (
            <IntakeScreen
              q={q}
              setQ={setQ}
              busy={busy}
              mails={scopedIntake}
              onProcess={(mail) => setModal({ kind: "process", mail })}
              onRefresh={() => run("Mailbox refreshed", refresh)}
            />
          )}

          {screen === "tracker" && (
            <>
              <PageHead title="Communication Tracker" sub={`${scopedComms.length} records`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal({ kind: "comm" })}>New Communication</button>
              </PageHead>
              <CommTable rows={scopedComms} q={q} setQ={setQ} onOpen={setDrawer} />
            </>
          )}

          {screen === "legal" && (
            <>
              <PageHead title="Legal Cases Notification" sub="Communications where Category = Legal" />
              <CommTable
                rows={scopedComms.filter((c) => c.cat === "Legal")}
                q={q}
                setQ={setQ}
                onOpen={setDrawer}
                legal
              />
            </>
          )}

          {screen === "escalation" && (
            <>
              <PageHead title="Escalation Center" sub="Communications overdue flags · License expiry monitor">
                <div className="toggle">
                  <button className={escTab === "comms" ? "on" : ""} type="button" onClick={() => setEscTab("comms")}>Communications</button>
                  <button className={escTab === "licenses" ? "on" : ""} type="button" onClick={() => setEscTab("licenses")}>Licenses &amp; renewals</button>
                </div>
                {escTab === "comms" ? (
                  <button
                    className="btn btn-outline"
                    type="button"
                    disabled={busy}
                    onClick={() => run(
                      db.source === "dataverse" ? "Refreshed from Dataverse (auto flow runs every 10 minutes)" : "Automatic escalation ran",
                      runAutomaticEscalation,
                    )}
                  >
                    {db.source === "dataverse" ? "Refresh from auto flow" : "Run automatic escalation"}
                  </button>
                ) : (
                  <button
                    className="btn btn-outline"
                    type="button"
                    disabled={busy}
                    onClick={() => run("Expiry monitor ran", async () => summarizeMonitor(await runLicenseMonitor()))}
                  >
                    Run expiry monitor
                  </button>
                )}
              </PageHead>
              {escTab === "comms" ? (
                <EscalationCenter
                  q={q}
                  setQ={setQ}
                  busy={busy}
                  comms={scopedComms}
                  onOpen={setDrawer}
                  onRunAuto={() => run(
                    db.source === "dataverse" ? "Refreshed from Dataverse (auto flow runs every 10 minutes)" : "Automatic escalation ran",
                    runAutomaticEscalation,
                  )}
                  onEscalate={(row) => {
                    if (canManualEscalate(row)) setModal({ kind: "escalate", comm: row });
                  }}
                />
              ) : (
                <LicenseEscalationPanel
                  q={q}
                  busy={busy}
                  docs={scopedDocs}
                  onOpen={(doc) => setModal({ kind: "docDetail", doc })}
                  onEscalate={(doc) => setModal({ kind: "escalateDoc", doc })}
                />
              )}
            </>
          )}

          {screen === "parties" && (
            <>
              <PageHead title="External Party Master" sub={`${scopedParties.length} parties`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal({ kind: "party" })}>New Party</button>
              </PageHead>
              <div className="filters">
                <FilterField label="Search" className="ffld-search">
                  <input type="search" placeholder="Search party, domain, email" value={q} onChange={(e) => setQ(e.target.value)} />
                </FilterField>
              </div>
              <DataTable
                cols={["Party", "Category", "Email", "Domain", "Business Unit", "Department", "Criticality", "Status", "Comms"]}
                rows={scopedParties
                  .filter((p) => `${p.name} ${p.domain} ${p.email}`.toLowerCase().includes(q.toLowerCase()))
                  .map((p) => ({
                    key: p.id,
                    cells: [
                      p.name,
                      catBadge(p.category),
                      p.email,
                      p.domain,
                      p.bu || "—",
                      p.department || "—",
                      priBadge(p.criticality),
                      statusBadge(p.status),
                      scopedComms.filter((c) => c.party === p.name || c.partyId === p.id).length,
                    ],
                  }))}
              />
            </>
          )}

          {screen === "licenses" && (
            <>
              <PageHead title="License & Contract Tracker" sub={`${scopedDocs.length} documents`}>
                <button className="btn btn-outline" type="button" disabled={busy} onClick={() => run("Expiry monitor ran", async () => summarizeMonitor(await runLicenseMonitor()))}>Run expiry monitor</button>
                <button className="btn btn-primary" type="button" onClick={() => setModal({ kind: "doc" })}>New Document</button>
              </PageHead>
              <LicenseTracker
                rows={scopedDocs}
                q={q}
                setQ={setQ}
                busy={busy}
                onOpen={(doc) => setModal({ kind: "docDetail", doc })}
                onRenew={(doc) => run(`${doc.name} renewed`, () => renewDoc(doc.id))}
              />
            </>
          )}

          {screen === "renewals" && (
            <RenewalCalendar
              month={calMonth}
              view={calView}
              q={q}
              setQ={setQ}
              docs={scopedDocs}
              onMonth={setCalMonth}
              onView={setCalView}
              onOpen={(doc) => setModal({ kind: "docDetail", doc })}
              onRenew={(doc) => run(`${doc.name} renewed`, () => renewDoc(doc.id))}
              onNew={() => setModal({ kind: "doc" })}
            />
          )}

          {screen === "notifications" && (
            <>
              <PageHead title="Notification Center" sub={`${db.notices.length} logged events · ${unreadNoticeCount} unread`}>
                <button className="btn btn-outline" type="button" disabled={busy} onClick={() => run("Expiry monitor ran", async () => summarizeMonitor(await runLicenseMonitor()))}>Run expiry monitor</button>
              </PageHead>
              <NotificationCenter
                q={q}
                setQ={setQ}
                busy={busy}
                onOpenDoc={(doc) => setModal({ kind: "docDetail", doc })}
              />
            </>
          )}

          {screen === "admin" && (
            <>
              <PageHead title="Admin Configuration" sub="SLA matrix is for category/priority matching. Is OverDue and Due Date on Communication are Dataverse formula columns." />
              <DataTable
                cols={["Name", "Category", "Priority", "Ack (hours)", "Resolve (days)", "Basis", "Active"]}
                rows={db.sla.map((r) => ({
                  key: r.id,
                  cells: [r.name, catBadge(r.category), priBadge(r.priority), r.ackHours, r.resolveDays, r.basis, statusBadge(r.active ? "Active" : "Inactive")],
                }))}
              />
            </>
          )}

          {screen === "archive" && (
            <>
              <PageHead title="Document Archive" sub={`${db.archives.length} files on erc_documentarchive`} />
              <DocumentArchiveScreen q={q} setQ={setQ} busy={busy} onToast={ping} onFail={ping} />
            </>
          )}

          {screen === "auditComm" && (
            <CommunicationAuditScreen
              q={q}
              setQ={setQ}
              comms={scopedComms}
              audits={db.audits}
              threads={db.threadByComm}
              busy={busy}
              onOpen={setDrawer}
              onRefresh={() => void run("Refreshed", () => refresh())}
            />
          )}

          {screen === "auditNotif" && (
            <NotificationAuditScreen
              q={q}
              setQ={setQ}
              docs={scopedDocs}
              notices={db.notices}
              renewals={db.renewals}
              parties={db.parties}
              busy={busy}
              onOpen={(doc) => setModal({ kind: "docDetail", doc })}
              onRefresh={() => void run("Refreshed", () => refresh())}
              onDone={ping}
              onFail={ping}
            />
          )}

          {screen === "reports" && (
            <>
              <PageHead title="Power BI Reports" sub="Operational counts from the same Dataverse tables. Embed a Power BI report here when the workspace is ready." />
              <div className="kpis">
                <Kpi acc="var(--bronze)" label="Communications" value={kpi(scopedComms.length)} detail="erc_communication" onClick={() => go("tracker")} />
                <Kpi acc="var(--info)" label="Licenses" value={kpi(scopedDocs.length)} detail="erc_licenseandcontract" onClick={() => go("licenses")} />
                <Kpi acc="var(--warn)" label="Archive files" value={kpi(db.archives.length)} detail="erc_documentarchive" onClick={() => go("archive")} />
                <Kpi acc="var(--ok)" label="Audit events" value={kpi(db.audits.length)} detail="erc_communicationaudit" onClick={() => go("auditComm")} />
                <Kpi acc="var(--info)" label="Notices" value={kpi(db.notices.length)} detail="erc_notification" onClick={() => go("auditNotif")} />
                <Kpi acc="var(--bad)" label="Overdue" value={kpi(breached.length)} detail="Is OverDue" onClick={() => go("escalation")} />
              </div>
              <div className="callout">These figures are live from Dataverse. A published Power BI report can replace this page later without adding a table.</div>
            </>
          )}
        </main>
      </div>

      {liveDrawer && (
        <OverlayError key={liveDrawer.recordId || liveDrawer.id} onReset={() => setDrawer(null)}>
          <CommRecordForm
            row={liveDrawer}
            busy={busy}
            onClose={() => setDrawer(null)}
            onCloseRec={() => setModal({ kind: "close", comm: liveDrawer })}
            onReopen={() => setModal({ kind: "reopen", comm: liveDrawer })}
            onEscalate={() => {
              if (canManualEscalate(liveDrawer)) setModal({ kind: "escalate", comm: liveDrawer });
            }}
            onEvidence={() => setModal({ kind: "evidence", comm: liveDrawer })}
            onSaved={ping}
          />
        </OverlayError>
      )}

      {modal && (
        <Modals
          modal={modal}
          busy={busy}
          onClose={() => setModal(null)}
          onDone={(msg) => { setModal(null); ping(msg); }}
          onFail={ping}
          setBusy={setBusy}
          openComm={(row) => { setModal(null); setDrawer(row); }}
        />
      )}
      <div id="toast" className={toast ? "on" : ""}>{toast}</div>
    </>
  );
}

function CommTable({
  rows, q, setQ, onOpen, legal,
}: {
  rows: Communication[];
  q: string;
  setQ: (v: string) => void;
  onOpen: (row: Communication) => void;
  legal?: boolean;
}) {
  const [cat, setCat] = useState("All");
  const [status, setStatus] = useState("All");
  const [sla, setSla] = useState("All");
  const filtered = useMemo(() => rows.filter((r) => {
    const hit = `${r.id} ${r.party} ${r.subj} ${r.owner} ${r.caseRef || ""}`.toLowerCase().includes(q.toLowerCase());
    return hit && (cat === "All" || r.cat === cat) && (status === "All" || r.status === status) && (sla === "All" || slaState(r) === sla);
  }), [rows, q, cat, status, sla]);
  return (
    <>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search ID, party, subject, owner" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        {!legal && (
          <FilterField label="Category">
            <select value={cat} onChange={(e) => setCat(e.target.value)}><option>All</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          </FilterField>
        )}
        <FilterField label="Lifecycle Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>All</option>
            {COMM_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </FilterField>
        <FilterField label="SLA">
          <select value={sla} onChange={(e) => setSla(e.target.value)}><option>All</option><option>Within</option><option>At Risk</option><option>Breached</option></select>
        </FilterField>
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={legal
          ? ["CommID", "Case Reference", "External Party", "Subject", "Owner", "Priority", "Received", "Due", "Status", "Overdue", "Escalated"]
          : ["CommID", "External Party", "Category", "Subject", "Owner", "Priority", "Due", "Status", "Overdue", "Escalated"]}
        rows={filtered.map((r) => ({
          key: r.recordId || r.id,
          legal: r.cat === "Legal",
          onClick: () => onOpen(r),
          cells: legal
            ? [
                <span className="link" key="id">{r.id}</span>,
                r.caseRef || "—",
                r.party || (r.partyId ? "Linked party" : "—"),
                r.subj,
                r.owner || "—",
                priBadge(r.pri),
                <span className="mono" key="rec">{r.rec}</span>,
                <span className="mono" key="due">{formatDateTime(r.due)}</span>,
                <>{statusBadge(r.status)}{commLocked(r) ? " 🔒" : ""}</>,
                flagBadge(r.isOverdue, "Overdue", "On Track"),
                flagBadge(r.isEscalated, "Escalated", "Not Escalated"),
              ]
            : [
                <span className="link" key="id">{r.id}</span>,
                r.party || (r.partyId ? "Linked party" : "—"),
                r.categoryAssigned ? catBadge(r.cat) : "—",
                r.subj,
                r.owner || "—",
                priBadge(r.pri),
                <span className="mono" key="due">{formatDateTime(r.due)}</span>,
                <>{statusBadge(r.status)}{commLocked(r) ? " 🔒" : ""}</>,
                flagBadge(r.isOverdue, "Overdue", "On Track"),
                flagBadge(r.isEscalated, "Escalated", "Not Escalated"),
              ],
        }))}
      />
    </>
  );
}

function IntakeScreen({
  q, setQ, busy, mails, onProcess, onRefresh,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  mails: IntakeEmail[];
  onProcess: (mail: IntakeEmail) => void;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState("All");
  const rows = mails.filter((x) =>
    matchesSearch(q, x.from, x.to, x.subj, x.match, x.recv, x.status, x.owner, x.commId, x.threadAction, x.match ? "" : "unmatched")
    && (status === "All" || x.status === status)
  );
  return (
    <>
      <PageHead title="Central Mailbox" sub={`${mails.length} emails to ${MAILBOX_MAHA}, ${MAILBOX_TEST}, ${MAILBOX_PROD}`}>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={onRefresh}>Refresh</button>
      </PageHead>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search sender or subject" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option>All</option><option>New</option><option>In Review</option><option>Routed</option></select>
        </FilterField>
        <span className="fnote">{rows.length} shown</span>
      </div>
      <DataTable
        cols={["Received", "From", "To", "Subject", "Thread", "Matched Party", "Status", ""]}
        rows={rows.map((x) => ({
          key: x.id,
          onClick: x.status === "Routed" ? undefined : () => onProcess(x),
          cells: [
            <span className="mono" key="r">{x.recv}</span>,
            x.from,
            x.to || MAILBOX_MAHA,
            x.subj,
            x.threadAction ? statusBadge(x.threadAction) : "—",
            x.match || <span className="badge b-bad" key="u">Unmatched</span>,
            statusBadge(x.status),
            x.status === "Routed"
              ? statusBadge("Routed")
              : <button key="p" className="btn btn-outline btn-mini" type="button" onClick={(e) => { e.stopPropagation(); onProcess(x); }}>Process</button>,
          ],
        }))}
      />
    </>
  );
}

function RenewalCalendar({
  month, view, q, setQ, docs, onMonth, onView, onOpen, onRenew, onNew,
}: {
  month: string;
  view: "cal" | "list" | "risk";
  q: string;
  setQ: (v: string) => void;
  docs: License[];
  onMonth: (v: string) => void;
  onView: (v: "cal" | "list" | "risk") => void;
  onOpen: (row: License) => void;
  onRenew: (row: License) => void;
  onNew: () => void;
}) {
  const db = useStore();
  const landed = useRef(false);
  const [Y, M] = month.split("-").map(Number);
  const first = new Date(Y, M - 1, 1);
  const lead = first.getDay();
  const len = new Date(Y, M, 0).getDate();
  const label = first.toLocaleString("en-GB", { month: "long", year: "numeric" });
  const withDay = useMemo(() => docs.map((x) => ({ doc: x, day: dateOnly(x.expiry) })).filter((x) => x.day), [docs]);
  const inMonth = withDay.filter((x) => x.day.startsWith(month));
  const missingExpiry = docs.filter((x) => !dateOnly(x.expiry)).length;
  const expiring = docs.filter((x) => docState(x) === "Expiring");
  const months = useMemo(() => [...new Set(withDay.map((x) => x.day.slice(0, 7)))].sort(), [withDay]);
  const nextMonth = months.find((m) => m >= TODAY.slice(0, 7)) || months[months.length - 1] || "";
  const nextLabel = nextMonth
    ? new Date(Number(nextMonth.slice(0, 4)), Number(nextMonth.slice(5, 7)) - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" })
    : "";

  useEffect(() => {
    if (landed.current || !withDay.length) return;
    landed.current = true;
    if (withDay.some((x) => x.day.startsWith(month))) return;
    if (nextMonth && nextMonth !== month) onMonth(nextMonth);
  }, [withDay, month, nextMonth, onMonth]);

  const shift = (n: number) => {
    const d = new Date(Y, M - 1 + n, 1);
    onMonth(`${d.getFullYear()}-${padCal(d.getMonth() + 1)}`);
  };
  const cells: ReactNode[] = [];
  for (let i = 0; i < lead; i++) cells.push(<div className="day empty" key={`e${i}`} />);
  for (let day = 1; day <= len; day++) {
    const iso = `${month}-${padCal(day)}`;
    const ev = inMonth.filter((x) => x.day === iso);
    cells.push(
      <div className={`day${ev.length ? " has" : ""}`} key={iso}>
        <div className="num">{day}</div>
        {ev.map(({ doc: x }) => {
          const t = daysBetween(TODAY, x.expiry);
          const k = t < 30 ? "bad" : t <= 90 ? "warn" : "ok";
          return (
            <div className="ev" key={x.recordId || x.id} onClick={() => onOpen(x)}>
              <i style={{ background: `var(--${k})` }} />
              <span>{x.name}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <>
      <PageHead title="Renewal Calendar" sub={`${inMonth.length} renewals in ${label} · ${expiring.length} due within 90 days · ${docs.length} documents`}>
        <button className="btn btn-primary" type="button" onClick={onNew}>New Document</button>
      </PageHead>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
        <div className="toggle">
          <button className={view === "cal" ? "on" : ""} type="button" onClick={() => onView("cal")}>Calendar</button>
          <button className={view === "list" ? "on" : ""} type="button" onClick={() => onView("list")}>List</button>
          <button className={view === "risk" ? "on" : ""} type="button" onClick={() => onView("risk")}>Risk Matrix</button>
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {statusBadge("Expired")} {priBadge("High")} {statusBadge("Active")}
          <span style={{ marginLeft: 8 }}>&lt; 30 days · 30–90 · &gt; 90</span>
        </span>
      </div>
      {view === "cal" && docs.length === 0 ? (
        <div className="callout">No license or contract records are loaded. Create a document or check that <b>erc_licenseandcontract</b> is returning rows.</div>
      ) : null}
      {view === "cal" && docs.length > 0 && inMonth.length === 0 ? (
        <div className="callout">
          No expiries in <b>{label}</b>. {missingExpiry ? `${missingExpiry} record${missingExpiry === 1 ? "" : "s"} have no expiry date. ` : null}
          {nextMonth && nextMonth !== month ? (
            <button className="btn btn-outline btn-mini" type="button" onClick={() => onMonth(nextMonth)}>Go to {nextLabel}</button>
          ) : null}
          {" "}Use <b>List</b> to see all {docs.length} documents.
        </div>
      ) : null}
      {view === "cal" && (
        <div className="card cal">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <button className="btn btn-ghost" type="button" onClick={() => shift(-1)}>‹</button>
            <strong style={{ fontSize: 15 }}>{label}</strong>
            <button className="btn btn-ghost" type="button" onClick={() => shift(1)}>›</button>
          </div>
          <div className="calgrid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => <div className="dow" key={x}>{x}</div>)}
            {cells}
          </div>
        </div>
      )}
      {view === "list" && (
        <LicenseTracker
          rows={[...docs].sort((a, b) => a.expiry.localeCompare(b.expiry))}
          q={q}
          setQ={setQ}
          busy={false}
          onOpen={onOpen}
          onRenew={onRenew}
        />
      )}
      {view === "risk" && (
        <div className="tablewrap">
          <table>
            <thead><tr><th /><th>Under 30 days</th><th>30 – 90 days</th><th>Over 90 days</th></tr></thead>
            <tbody>
              {(["High", "Medium", "Low"] as const).map((risk) => (
                <tr key={risk}>
                  <td><b>{risk} risk</b></td>
                  {[0, 1, 2].map((band) => {
                    const list = docs.filter((x) => {
                      const t = daysBetween(TODAY, x.expiry);
                      const b = t < 30 ? 0 : t <= 90 ? 1 : 2;
                      return (x.risk === risk || (risk === "High" && x.risk === "Critical")) && b === band;
                    });
                    return (
                      <td key={band}>
                        {list.length ? list.map((x) => (
                          <div key={x.id} style={{ marginBottom: 4 }}>
                            <a className="link" onClick={() => onOpen(x)}>{x.name}</a>
                          </div>
                        )) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {db.renewals.length > 0 && <RenewalTaskTable rows={db.renewals} />}
    </>
  );
}

function Modals({
  modal, busy, onClose, onDone, onFail, setBusy, openComm,
}: {
  modal: Exclude<Modal, null>;
  busy: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  onFail: (msg: string) => void;
  setBusy: (v: boolean) => void;
  openComm: (row: Communication) => void;
}) {
  const db = useStore();
  async function go(ok: string, work: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await work();
      onDone(ok);
      return result;
    } catch (err) {
      onFail(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (modal.kind === "party") {
    return (
      <Overlay kind="modal" title="New External Party" sub="Used to match inbound sender domains" onClose={onClose} footer={null}>
        <PartyForm onCancel={onClose} onSave={() => onDone("Party created")} />
      </Overlay>
    );
  }
  if (modal.kind === "comm") {
    return (
      <Overlay kind="modal" title="New Communication" sub="Due Date and Is OverDue are formula columns on the Communications table. Category and Priority are required." onClose={onClose} footer={null}>
        <CommForm onCancel={onClose} onSave={() => onDone("Communication created")} />
      </Overlay>
    );
  }
  if (modal.kind === "doc") {
    return <LicenseCreateForm onCancel={onClose} onSave={() => onDone("Document created")} />;
  }
  if (modal.kind === "process") {
    const m = db.intake.find((x) => x.id === modal.mail.id) || modal.mail;
    return (
      <Overlay kind="modal" title="Process inbound email" sub={m.from} onClose={onClose} footer={null}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void (async () => {
            setBusy(true);
            try {
              const row = await routeEmail(m, {
                party: String(f.get("party")),
                cat: String(f.get("cat")) as Category,
                pri: String(f.get("pri")) as Priority,
                owner: String(f.get("owner")),
                sup: String(f.get("sup")),
                bu: String(f.get("bu")),
              });
              onDone(`${row.id} created — due ${formatDateTime(row.due)}`);
              openComm(row);
            } catch (err) {
              onFail(err instanceof Error ? err.message : "Routing failed");
            } finally {
              setBusy(false);
            }
          })();
        }}>
          <dl className="kv">
            <dt>Received</dt><dd className="mono">{m.recv}</dd>
            <dt>Subject</dt><dd>{m.subj}</dd>
            <dt>Matched party</dt><dd>{m.match || <span className="badge b-bad">Unmatched — create a party first</span>}</dd>
          </dl>
          <h2 className="sec">Routing proposal</h2>
          <div className="form">
            <div><label>External party *</label><select name="party" defaultValue={m.match} required>{db.parties.map((p) => <option key={p.id}>{p.name}</option>)}</select></div>
            <div><label>Category *</label><select name="cat" defaultValue={m.cat}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Priority *</label><select name="pri" defaultValue={m.pri}>{PRIS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Owner *</label><select name="owner" defaultValue={m.owner}>{OWNERS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Supervisor</label><select name="sup">{SUPS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Business unit</label><select name="bu">{BUS.map((c) => <option key={c}>{c}</option>)}</select></div>
          </div>
          <div className="note">Confirming creates or attaches the Communication. Due Date and Is OverDue are formula columns — this app does not write them.</div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>Confirm & Route</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Overlay>
    );
  }
  if (modal.kind === "respond") {
    const r = db.comms.find((c) => c.id === modal.comm.id) || modal.comm;
    return (
      <Overlay kind="modal" title={`Respond — ${r.id}`} sub={r.party} onClose={onClose} footer={null}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const msg = String(f.get("msg") || "").trim();
          if (!msg) return onFail("Enter a message before sending");
          void go("Response sent", () => respondToComm(r.id, msg, String(f.get("channel"))));
        }}>
          <div className="form">
            <div><label>Channel</label><select name="channel"><option>Email</option><option>Official letter</option><option>Portal submission</option></select></div>
            <div><label>Template</label><select><option>Acknowledgement</option><option>Document submission</option><option>Corrective action plan</option></select></div>
            <div className="wide"><label>Message *</label><textarea name="msg" rows={5} required placeholder={`Type the response to ${r.party}…`} /></div>
          </div>
          <div className="note">Sending stamps the response. Lifecycle Status stays <b>In Progress</b> until you close the record.</div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>Send Response</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Overlay>
    );
  }
  if (modal.kind === "close") {
    const r = db.comms.find((c) => c.id === modal.comm.id) || modal.comm;
    return (
      <Overlay kind="modal" title={`Close — ${r.id}`} sub={r.party} onClose={onClose} footer={null}>
        <CloseCommForm
          row={r}
          busy={busy}
          onCancel={onClose}
          onSubmit={(cmt) => {
            if (!cmt) return onFail("A closure comment is required");
            void go(`${r.id} closed`, () => closeComm(r.id, cmt));
          }}
        />
      </Overlay>
    );
  }
  if (modal.kind === "escalate") {
    const r = db.comms.find((c) => c.id === modal.comm.id) || modal.comm;
    if (!canManualEscalate(r)) {
      return (
        <Overlay kind="modal" title={`Already escalated — ${r.id}`} sub="Manual escalation can run only once" onClose={onClose} footer={null}>
          <dl className="kv">
            <dt>Is Escalated</dt><dd>Yes</dd>
            <dt>Is Manually Escalated</dt><dd>{r.isManuallyEscalated ? "Yes" : "No"}</dd>
            <dt>Escalation reason</dt><dd>{r.escalationReason || "—"}</dd>
            <dt>Escalated by</dt><dd>{r.escalatedBy || "—"}</dd>
          </dl>
          <div className="note">This record is locked. The Communications Manual Escalation flow will not run a second time.</div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Close</button>
          </div>
        </Overlay>
      );
    }
    return (
      <Overlay kind="modal" title={`Manual escalation — ${r.id}`} sub="Runs the Communications Manual Escalation flow once" onClose={onClose} footer={null}>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!canManualEscalate(r)) return onFail("This communication is already escalated");
          const f = new FormData(e.currentTarget);
          const reason = String(f.get("reason") || "").trim();
          if (!reason) return onFail("Escalation reason is required");
          void go(`${r.id} escalated`, () => escalateManually(r.id, reason, ME));
        }}>
          <div className="form">
            <div className="wide">
              <label>Escalation reason *</label>
              <textarea name="reason" rows={3} required minLength={3} placeholder="Why is this being escalated?" />
            </div>
          </div>
          <div className="note">
            This writes <b>Is Escalated = Yes</b> so the manual flow runs once and cannot be sent again. Escalation reason is required.
          </div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>Run manual escalation</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Overlay>
    );
  }
  if (modal.kind === "escalateDoc") {
    const r = db.docs.find((d) => d.id === modal.doc.id || d.recordId === modal.doc.recordId) || modal.doc;
    if (r.isEscalated) {
      return (
        <Overlay kind="modal" title={`Already escalated — ${r.id}`} sub="License escalation runs once" onClose={onClose} footer={null}>
          <dl className="kv">
            <dt>Is Escalated</dt><dd>Yes</dd>
            <dt>Escalation reason</dt><dd>{r.escalationReason || "—"}</dd>
            <dt>Escalated by</dt><dd>{r.escalatedBy || "—"}</dd>
          </dl>
        </Overlay>
      );
    }
    return (
      <Overlay kind="modal" title={`Escalate document — ${r.id}`} sub={r.name} onClose={onClose} footer={null}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get("reason") || "").trim();
          if (!reason) return onFail("Escalation reason is required");
          void go(`${r.id} escalated`, () => escalateLicense(r.id, reason, ME));
        }}>
          <div className="form">
            <div className="wide">
              <label>Escalation reason *</label>
              <textarea name="reason" rows={3} required minLength={3} placeholder="Why is this being escalated?" />
            </div>
          </div>
          <div className="note">Sets <b>Is Escalated = Yes</b> on the license, marks the renewal L1, and logs an Escalation notification.</div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>Escalate</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Overlay>
    );
  }
  if (modal.kind === "reopen") {
    const r = modal.comm;
    return (
      <Overlay kind="modal" title={`Reopen closed record — ${r.id}`} sub="Logged in the activity trail" onClose={onClose} footer={null}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get("reason") || "").trim();
          if (!reason) return onFail("A reason is required to reopen a closed record");
          void go(`${r.id} reopened`, () => reopenComm(r.id, reason));
        }}>
          <div className="form">
            <div className="wide"><label>Reason for reopening *</label><textarea name="reason" rows={3} required /></div>
          </div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>Reopen Record</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Overlay>
    );
  }
  if (modal.kind === "evidence") {
    const r = modal.comm;
    return (
      <ArchiveUploadForm
        busy={busy}
        defaultCommId={r.recordId || r.id}
        defaultType="Communication evidence"
        onClose={onClose}
        onSaved={onDone}
        onFail={onFail}
      />
    );
  }
  const x = db.docs.find((d) => d.id === modal.doc.id || d.recordId === modal.doc.recordId) || modal.doc;
  return (
    <LicenseRecordForm
      row={x}
      busy={busy}
      onClose={onClose}
      onSaved={onFail}
    />
  );
}

function PartyForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const domain = String(f.get("domain") || "").trim();
    if (!domain) {
      setError("Domain is required.");
      return;
    }
    const buId = String(f.get("bu") || "");
    const unit = db.businessUnits.find((u) => u.id === buId);
    setBusy(true);
    setError("");
    try {
      await addParty({
        name: String(f.get("name")),
        category: String(f.get("category")) as Category,
        email: String(f.get("email")),
        domain,
        bu: unit?.name || String(f.get("bu") || ""),
        buId: unit?.id || buId || undefined,
        owner: ME,
        criticality: String(f.get("crit")) as "High" | "Medium" | "Low",
        status: "Draft",
      });
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the party.");
    } finally {
      setBusy(false);
    }
  }
  const units = db.businessUnits.length ? db.businessUnits : BUS.map((name) => ({ id: name, name }));
  return (
    <form onSubmit={submit}>
      <div className="form">
        <div className="wide"><label>Party name *</label><input name="name" required /></div>
        <div><label>Category *</label><select name="category">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label>Priority *</label><select name="crit" defaultValue="High"><option>High</option><option>Medium</option><option>Low</option></select></div>
        <div><label>Official email *</label><input name="email" type="email" required /></div>
        <div>
          <label>Domain *</label>
          <input name="domain" required minLength={3} placeholder="gmail.com" />
        </div>
        <div><label>Business unit *</label>
          <select name="bu" required>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      {error ? <div className="note">{error}</div> : <div className="note">The party is saved as Draft so IT can be notified. Domain is required so inbound senders can be matched.</div>}
      <div className="df" style={{ margin: "16px -20px -20px" }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>Create Party</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function CommForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cat = String(f.get("cat")) as Category;
    const pri = String(f.get("pri")) as Priority;
    const rec = String(f.get("rec"));
    setBusy(true);
    try {
      await addComm({
        party: String(f.get("party")),
        cat,
        subj: String(f.get("subj")),
        owner: String(f.get("owner")),
        sup: String(f.get("sup")),
        pri,
        rec,
        due: "",
        status: "In Progress",
        bu: String(f.get("bu")),
        caseRef: String(f.get("caseRef") || ""),
      });
      onSave();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="form">
        <div className="wide"><label>Subject *</label><input name="subj" required /></div>
        <div><label>External party *</label><select name="party">{db.parties.map((p) => <option key={p.id}>{p.name}</option>)}</select></div>
        <div><label>Category *</label><select name="cat">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label>Priority *</label><select name="pri" defaultValue="High">{PRIS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label>Owner *</label><input name="owner" defaultValue={ME} required /></div>
        <div><label>Supervisor</label><select name="sup">{SUPS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label>Received date *</label><input name="rec" type="date" defaultValue={TODAY} required /></div>
        <div><label>Business unit</label><select name="bu">{BUS.map((b) => <option key={b}>{b}</option>)}</select></div>
        <div className="wide"><label>Case reference (legal)</label><input name="caseRef" /></div>
      </div>
      <div className="note">Due Date and Is OverDue are formula columns (Created On + 2 hours). The automatic flow reads that column; this app does not calculate or write it.</div>
      <div className="df" style={{ margin: "16px -20px -20px" }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>Create Record</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
