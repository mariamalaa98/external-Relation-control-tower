import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  BUS,
  CATS,
  COMM_STATUSES,
  CENTRAL_MAILBOX_ADDRESSES,
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
  addDoc,
  addEvidence,
  addParty,
  closeComm,
  commLocked,
  completeCycle,
  daysBetween,
  docLocked,
  docState,
  escalateManually,
  escalateLicense,
  canManualEscalate,
  formatDateTime,
  refresh,
  reopenComm,
  reopenDoc,
  renewDoc,
  respondToComm,
  routeEmail,
  runAutomaticEscalation,
  runLicenseMonitor,
  tickFormulas,
  sendRenewalNotice,
  simulateInboundEmail,
  slaState,
  summarizeMonitor,
  unreadNotices,
  useStore,
  DEFAULT_REMINDER_THRESHOLD,
  linkCommToParty,
  assignCommCategory,
  resolveUnmatchedEmail,
  unmatchedComms,
  unmatchedIntake,
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
import { LicenseEscalationPanel, NotificationCenter, RenewalTaskTable } from "./ui/license";
import { ResolveUnmatchedForm, UnmatchedSendersPage } from "./ui/unmatched";

const NAV = [
  { area: "ops", group: "COMMAND CENTER", items: [
    { id: "dashboard", ico: "▦", text: "Executive Dashboard" },
    { id: "pending", ico: "☑", text: "My Pending Actions" },
  ]},
  { area: "ops", group: "COMMUNICATIONS", items: [
    { id: "intake", ico: "✉", text: "Central Mailbox" },
    { id: "unmatched", ico: "?", text: "Unmatched Senders" },
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

const AREAS = [
  { id: "ops", label: "Communications" },
  { id: "comp", label: "Licenses & Contracts" },
  { id: "gov", label: "Governance & Audit" },
] as const;

type ScreenId = (typeof NAV)[number]["items"][number]["id"];
type AreaId = (typeof AREAS)[number]["id"];
const LATER: ScreenId[] = ["archive", "reports", "auditComm", "auditNotif"];

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
  | { kind: "simulate" }
  | { kind: "process"; mail: IntakeEmail }
  | { kind: "respond"; comm: Communication }
  | { kind: "close"; comm: Communication }
  | { kind: "reopen"; comm: Communication }
  | { kind: "evidence"; comm: Communication }
  | { kind: "escalate"; comm: Communication }
  | { kind: "escalateDoc"; doc: License }
  | { kind: "resolveUnmatched"; target: { type: "comm"; comm: Communication } | { type: "mail"; mail: IntakeEmail } }
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
  const [calMonth, setCalMonth] = useState("2026-09");
  const [calView, setCalView] = useState<"cal" | "list" | "risk">("cal");
  const [docType, setDocType] = useState("All");
  const [docStatus, setDocStatus] = useState("All");
  const [orgBu, setOrgBu] = useState("All");
  const [orgDept, setOrgDept] = useState("All");
  const [escTab, setEscTab] = useState<"comms" | "licenses">("comms");
  const lastDeepLink = useRef("");

  useEffect(() => {
    const id = window.setInterval(() => {
      void tickFormulas();
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

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

  const orgOpts = useMemo(() => partyOrgOptions(db.parties, orgBu, db.businessUnits), [db.parties, db.businessUnits, orgBu]);
  const scopedParties = useMemo(
    () => db.parties.filter((p) => partyMatchesOrg(p, orgBu, orgDept, db.businessUnits)),
    [db.parties, db.businessUnits, orgBu, orgDept],
  );
  const scopedComms = useMemo(
    () => db.comms.filter((c) => commMatchesOrg(c, orgBu, orgDept, db.parties, db.businessUnits)),
    [db.comms, db.parties, db.businessUnits, orgBu, orgDept],
  );
  const scopedDocs = useMemo(
    () => db.docs.filter((d) => docMatchesOrg(d, orgBu, orgDept, db.parties, db.businessUnits)),
    [db.docs, db.parties, db.businessUnits, orgBu, orgDept],
  );

  const openComms = scopedComms.filter((c) => c.status !== "Closed");
  const mine = openComms.filter((c) => !c.owner || c.owner === ME || db.source === "local");
  const breached = openComms.filter((c) => c.isOverdue || slaState(c) === "Breached");
  const expiring = scopedDocs.filter((d) => {
    const s = docState(d);
    return s === "Expiring" || s === "Expired";
  });
  const closed = scopedComms.filter((c) => c.status === "Closed");
  const compliance = closed.length
    ? Math.round((closed.filter((c) => slaState(c) === "Within").length / closed.length) * 100)
    : 0;
  const catCounts = CATS.map((cat) => ({ cat, n: scopedComms.filter((c) => c.cat === cat).length }));
  const maxCat = Math.max(...catCounts.map((x) => x.n), 1);
  const unprocessed = db.intake.filter((x) => x.status !== "Routed");
  const unmatchedCount = unmatchedComms().length + unmatchedIntake().length;
  const unreadNoticeCount = unreadNotices(db.notices || []).length;
  const overdueDocs = scopedDocs.filter((d) => d.isOverdue && !d.done);
  const liveDrawer = drawer ? db.comms.find((c) => c.id === drawer.id || c.recordId === drawer.recordId) || drawer : null;

  return (
    <>
      <header>
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
      <div className="shell">
        <aside>
          <div className="profile">
            <div className="ini">ER</div>
            <div>
              <div className="t">External Relations</div>
              <div className="r">Control Tower</div>
            </div>
          </div>
          {NAV.filter((g) => g.area === area).map((g) => (
            <div key={g.group}>
              <div className="grouplabel">{g.group}</div>
              {g.items.map((i) => (
                <button key={i.id} className={`nav${screen === i.id ? " active" : ""}`} onClick={() => go(i.id)}>
                  <span className="ico">{i.ico}</span>
                  <span>{i.text}</span>
                  {i.id === "intake" && unprocessed.length > 0 ? <span className="dot" /> : null}
                  {i.id === "unmatched" && unmatchedCount > 0 ? <span className="dot" /> : null}
                  {i.id === "notifications" && unreadNoticeCount > 0 ? <span className="dot" /> : null}
                  {i.id === "escalation" && overdueDocs.length > 0 ? <span className="dot" /> : null}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <main>
          <div className={`banner ${db.source === "dataverse" ? "" : "warn"}`}>
            {db.source === "dataverse"
              ? <>Connected to Dataverse · central mailboxes <b>{MAILBOX_MAHA}</b> · <b>{MAILBOX_TEST}</b> · production <b>{MAILBOX_PROD}</b> · Power Automate owns create, auto-escalate, and close stamps</>
              : <>Running on prototype data{db.error ? ` (${db.error})` : ""}. Use <b>pa app run</b> to load live <b>erc_</b> records.</>}
          </div>

          {!LATER.includes(screen) && screen !== "admin" ? (
            <div className="filters org-filters">
              <OrgFilterFields
                businessUnits={orgOpts.businessUnits}
                departments={orgOpts.departments}
                bu={orgBu}
                dept={orgDept}
                onBu={(next) => {
                  setOrgBu(next);
                  const depts = partyOrgOptions(db.parties, next, db.businessUnits).departments;
                  if (orgDept !== "All" && !depts.includes(orgDept)) setOrgDept("All");
                }}
                onDept={setOrgDept}
              />
            </div>
          ) : null}

          {screen === "dashboard" && (
            <>
              <PageHead title="Executive Dashboard" sub={`${scopedComms.length} communications · ${scopedDocs.length} documents`}>
                <button className="btn btn-outline" type="button" disabled={busy} onClick={() => run("Register refreshed", refresh)}>Refresh</button>
              </PageHead>
              <div className="callout">
                <b>Communications:</b> Email activity → Create communication → Is OverDue → Auto or manual escalate once → Close.
                <b> Licenses:</b> Create document → Days remaining → Risk → Reminder threshold → Renewal task → Owner → Log notification → Renewed or Expiry → Critical → Overdue → Escalation Center.
              </div>
              <div className="kpis">
                <Kpi acc="var(--bronze)" label="Total Communications" value={scopedComms.length} detail="All categories" onClick={() => go("tracker")} />
                <Kpi acc="var(--info)" label="In Progress" value={openComms.length} detail="Not closed" onClick={() => go("pending")} />
                <Kpi acc="var(--bad)" label="Overdue" value={breached.length} detail="Is OverDue formula column" onClick={() => go("escalation")} />
                <Kpi acc="var(--ok)" label="SLA Compliance" value={`${compliance}%`} detail="Closed records" />
                <Kpi acc="var(--warn)" label="Unmatched Senders" value={unmatchedCount} detail="No External Party" onClick={() => go("unmatched")} />
                <Kpi acc="var(--warn)" label="Renewals Due" value={expiring.length} detail="Within 90 days / expired" onClick={() => go("renewals")} />
                <Kpi acc="var(--bad)" label="Expired licenses" value={overdueDocs.length} detail="Expiry reached, not renewed" onClick={() => go("escalation")} />
                <Kpi acc="var(--info)" label="Unread notices" value={unreadNoticeCount} detail="Reminder / expiry / escalation" onClick={() => go("notifications")} />
              </div>
              <div className="two">
                <div className="card chartcard">
                  <h3>Communications by Category</h3>
                  <div className="cs">Volume across the register</div>
                  <div className="bars">
                    {catCounts.map((x) => (
                      <div className="bar" key={x.cat} onClick={() => go("tracker")}>
                        <b>{x.n}</b>
                        <i style={{ height: `${(x.n / maxCat) * 70 + 8}%`, background: "var(--bronze)" }} />
                        <span>{x.cat.slice(0, 3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card chartcard">
                  <h3>SLA mix</h3>
                  <div className="cs">Closed-item compliance {compliance}%</div>
                  <div className="donutwrap">
                    <div className="donut" data-pct={`${compliance}%`} style={{ background: `conic-gradient(var(--ok) 0 ${compliance}%, var(--gold) ${compliance}% ${Math.min(100, compliance + 10)}%, var(--bad) ${Math.min(100, compliance + 10)}% 100%)` }} />
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
              <PageHead title="My Pending Actions" sub={`${mine.length} open items`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal({ kind: "comm" })}>New Communication</button>
              </PageHead>
              <CommTable rows={mine} q={q} setQ={setQ} onOpen={setDrawer} />
            </>
          )}

          {screen === "intake" && (
            <IntakeScreen
              q={q}
              setQ={setQ}
              busy={busy}
              onSimulate={() => setModal({ kind: "simulate" })}
              onProcess={(mail) => setModal({ kind: "process", mail })}
              onRefresh={() => run("Register refreshed", refresh)}
            />
          )}

          {screen === "unmatched" && (
            <UnmatchedSendersPage
              q={q}
              setQ={setQ}
              busy={busy}
              onRefresh={() => run("Register refreshed", refresh)}
              onOpenComm={setDrawer}
              onResolveComm={(comm) => setModal({ kind: "resolveUnmatched", target: { type: "comm", comm } })}
              onResolveMail={(mail) => setModal({ kind: "resolveUnmatched", target: { type: "mail", mail } })}
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
                <FilterField label="Search">
                  <input placeholder="Search party, domain, email" value={q} onChange={(e) => setQ(e.target.value)} />
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
              <DocTable
                rows={scopedDocs}
                q={q}
                setQ={setQ}
                typeFilter={docType}
                statusFilter={docStatus}
                onType={setDocType}
                onStatus={setDocStatus}
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

          {LATER.includes(screen) && (
            <>
              <PageHead
                title={NAV.flatMap((g) => [...g.items]).find((i) => i.id === screen)?.text || ""}
                sub="Next phase — mailbox archive, notification tables, and Power BI"
              />
              <div className="ph">This screen is not part of the current cycle. Use Mailbox Intake, Communication Tracker, and License & Contract Tracker.</div>
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
        <FilterField label="Search">
          <input placeholder="Search ID, party, subject, owner" value={q} onChange={(e) => setQ(e.target.value)} />
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
  q, setQ, busy, onSimulate, onProcess, onRefresh,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  onSimulate: () => void;
  onProcess: (mail: IntakeEmail) => void;
  onRefresh: () => void;
}) {
  const db = useStore();
  const [status, setStatus] = useState("All");
  const rows = db.intake.filter((x) =>
    matchesSearch(q, x.from, x.to, x.subj, x.match, x.recv, x.status, x.owner, x.commId, x.threadAction, x.match ? "" : "unmatched")
    && (status === "All" || x.status === status)
  );
  return (
    <>
      <PageHead title="Central Mailbox" sub={`${db.intake.length} emails to ${MAILBOX_MAHA}, ${MAILBOX_TEST}, ${MAILBOX_PROD}`}>
        <button className="btn btn-outline" type="button" disabled={busy} onClick={onRefresh}>Refresh</button>
        <button className="btn btn-primary" type="button" onClick={onSimulate}>Simulate Dataverse email</button>
      </PageHead>
      <div className="callout">
        Native <b>email</b> activities addressed to a central mailbox are listed here:
        <b>{MAILBOX_MAHA}</b>, <b>{MAILBOX_TEST}</b>, or production <b>{MAILBOX_PROD}</b>.
        The <b>Create new communication</b> flow still only auto-creates a record when Regarding is set and the To recipient is a mailbox.
      </div>
      <div className="filters">
        <FilterField label="Search">
          <input placeholder="Search sender or subject" value={q} onChange={(e) => setQ(e.target.value)} />
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

function DocTable({
  rows, q, setQ, typeFilter, statusFilter, onType, onStatus, onOpen, onRenew,
}: {
  rows: License[];
  q: string;
  setQ: (v: string) => void;
  typeFilter: string;
  statusFilter: string;
  onType: (v: string) => void;
  onStatus: (v: string) => void;
  onOpen: (row: License) => void;
  onRenew: (row: License) => void;
}) {
  const filtered = useMemo(() => rows.filter((r) => {
    const st = docState(r);
    return `${r.id} ${r.name} ${r.party}`.toLowerCase().includes(q.toLowerCase())
      && (typeFilter === "All" || r.type === typeFilter)
      && (statusFilter === "All" || st === statusFilter);
  }), [rows, q, typeFilter, statusFilter]);
  return (
    <>
      <div className="filters">
        <FilterField label="Search">
          <input placeholder="Search document, party" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="Type">
          <select value={typeFilter} onChange={(e) => onType(e.target.value)}><option>All</option><option>License</option><option>Contract</option><option>Permit</option></select>
        </FilterField>
        <FilterField label="Status">
          <select value={statusFilter} onChange={(e) => onStatus(e.target.value)}><option>All</option><option>Active</option><option>Expiring</option><option>Expired</option><option>Renewed</option></select>
        </FilterField>
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["ID", "Type", "Document", "External Party", "Expiry", "Days left", "Risk", "Status", "Owner", "Action"]}
        rows={filtered.map((r) => ({
          key: r.recordId || r.id,
          onClick: () => onOpen(r),
          cells: [
            r.id,
            statusBadge(r.type),
            r.name,
            r.party,
            <span className="mono" key="exp">{r.expiry}</span>,
            r.daysRemaining ?? daysBetween(TODAY, r.expiry),
            priBadge(r.risk),
            statusBadge(docState(r)),
            r.owner,
            docLocked(r)
              ? <>{statusBadge("Closed")} 🔒</>
              : <button className="btn btn-outline btn-mini" type="button" onClick={(e) => { e.stopPropagation(); onRenew(r); }}>Renew</button>,
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
  const [Y, M] = month.split("-").map(Number);
  const first = new Date(Y, M - 1, 1);
  const lead = first.getDay();
  const len = new Date(Y, M, 0).getDate();
  const label = first.toLocaleString("en-GB", { month: "long", year: "numeric" });
  const inMonth = docs.filter((x) => x.expiry.startsWith(month));
  const expiring = docs.filter((x) => docState(x) === "Expiring");
  const shift = (n: number) => {
    const d = new Date(Y, M - 1 + n, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const cells: ReactNode[] = [];
  for (let i = 0; i < lead; i++) cells.push(<div className="day empty" key={`e${i}`} />);
  for (let day = 1; day <= len; day++) {
    const iso = `${month}-${String(day).padStart(2, "0")}`;
    const ev = inMonth.filter((x) => x.expiry === iso);
    cells.push(
      <div className={`day${ev.length ? " has" : ""}`} key={iso}>
        <div className="num">{day}</div>
        {ev.map((x) => {
          const t = daysBetween(TODAY, x.expiry);
          const k = t < 30 ? "bad" : t <= 90 ? "warn" : "ok";
          return (
            <div className="ev" key={x.id} onClick={() => onOpen(x)}>
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
      <PageHead title="Renewal Calendar" sub={`${inMonth.length} renewals in ${label} · ${expiring.length} due within 90 days`}>
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
        <DocTable
          rows={[...docs].sort((a, b) => a.expiry.localeCompare(b.expiry))}
          q={q}
          setQ={setQ}
          typeFilter="All"
          statusFilter="All"
          onType={() => undefined}
          onStatus={() => undefined}
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
    return (
      <Overlay kind="modal" title="New Document" sub="License, contract or permit" onClose={onClose} footer={null}>
        <DocForm onCancel={onClose} onSave={() => onDone("Document created")} />
      </Overlay>
    );
  }
  if (modal.kind === "simulate") {
    return (
      <Overlay kind="modal" title="Simulate Dataverse email" sub={`Filtered to a central mailbox`} onClose={onClose} footer={null}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const replyTo = String(f.get("replyTo") || "");
          void go("Email ingested from native email activity", () => simulateInboundEmail(String(f.get("from")), String(f.get("subj")), {
            to: String(f.get("to") || MAILBOX_MAHA),
            inReplyTo: replyTo || undefined,
          }));
        }}>
          <div className="form">
            <div className="wide"><label>From *</label><input name="from" type="email" required placeholder="licensing@mohp.gov.eg" /></div>
            <div className="wide"><label>To (mailbox)</label>
              <select name="to" defaultValue={MAILBOX_MAHA}>
                {CENTRAL_MAILBOX_ADDRESSES.map((box) => <option key={box}>{box}</option>)}
              </select>
            </div>
            <div className="wide"><label>Subject *</label><input name="subj" required placeholder="Facility licence follow-up" /></div>
            <div className="wide"><label>Reply to existing thread</label>
              <select name="replyTo">
                <option value="">New thread — create Communication</option>
                {db.comms.filter((c) => c.status !== "Closed").map((c) => (
                  <option key={c.id} value={c.id}>{c.id} — {c.subj}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="note">If this is a new conversation index, the Create communication flow opens the transaction. Due Date and Is OverDue stay as formula columns on that record.</div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>Ingest email</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Overlay>
    );
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
  if (modal.kind === "resolveUnmatched") {
    const target = modal.target;
    if (target.type === "comm") {
      const r = db.comms.find((c) => c.id === target.comm.id) || target.comm;
      return (
        <ResolveUnmatchedForm
          title={`Resolve unmatched — ${r.id}`}
          sub="Link an External Party or assign a category"
          sender={r.owner}
          subject={r.emailSubject || r.subj}
          received={formatDateTime(r.createdOn || r.rec)}
          busy={busy}
          defaultCat={r.categoryAssigned ? r.cat : undefined}
          onCancel={onClose}
          onSubmit={(opts) => {
            if (opts.partyId) void go(`${r.id} linked to party`, () => linkCommToParty(r.id, opts.partyId!));
            else if (opts.cat) void go(`${r.id} classified as ${opts.cat}`, () => assignCommCategory(r.id, opts.cat!));
          }}
        />
      );
    }
    const m = db.intake.find((x) => x.id === target.mail.id) || target.mail;
    return (
      <ResolveUnmatchedForm
        title="Resolve unmatched sender"
        sub={m.from}
        sender={m.from}
        subject={m.subj}
        received={m.recv}
        busy={busy}
        defaultCat={m.cat}
        onCancel={onClose}
        onSubmit={(opts) => {
          void go(
            opts.partyId ? "Email linked to External Party" : `Email classified as ${opts.cat}`,
            async () => {
              const row = await resolveUnmatchedEmail(m, opts);
              openComm(row);
            },
          );
        }}
      />
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
      <Overlay kind="modal" title="Upload evidence" sub={r.id} onClose={onClose} footer={null}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("name") || "").trim();
          if (!name) return onFail("File name is required");
          addEvidence(r.id, name, ME);
          onDone(`${name} archived against ${r.id}`);
        }}>
          <div className="form">
            <div className="wide"><label>File name *</label><input name="name" required defaultValue="evidence.pdf" /></div>
          </div>
          <div className="note">This session stores the evidence name on the record. Attach the real file in Dataverse when the file column is added to Communication.</div>
          <div className="df" style={{ margin: "16px -20px -20px" }}>
            <button className="btn btn-primary" type="submit">Attach</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Overlay>
    );
  }
  const x = db.docs.find((d) => d.id === modal.doc.id || d.recordId === modal.doc.recordId) || modal.doc;
  const left = daysBetween(TODAY, x.expiry);
  const locked = docLocked(x);
  return (
    <Overlay
      kind="modal"
      title={x.name}
      sub={`${x.id} · ${x.party}`}
      onClose={onClose}
      footer={locked ? (
        <>
          <button className="btn btn-outline" type="button" disabled={busy} onClick={() => void go("Renewal cycle reopened", () => reopenDoc(x.id))}>Reopen Renewal Cycle</button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close</button>
        </>
      ) : (
        <>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void go(`${x.name} renewed`, () => renewDoc(x.id))}>Renew (+12 months)</button>
          <button className="btn btn-outline" type="button" disabled={busy} onClick={() => void go("Notification sent", () => sendRenewalNotice(x.id))}>Send Notification</button>
          <button className="btn btn-outline" type="button" disabled={busy} onClick={() => void go("Completion recorded", () => completeCycle(x.id))}>Record Completion</button>
          {!x.isEscalated && x.isOverdue ? (
            <button className="btn btn-outline" type="button" disabled={busy} onClick={() => void go(`${x.id} escalated`, () => escalateLicense(x.id, "Manual escalation from document record", ME))}>Escalate</button>
          ) : null}
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close</button>
        </>
      )}
    >
      <dl className="kv">
        <dt>Document type</dt><dd>{statusBadge(x.type)}</dd>
        <dt>Issuing authority</dt><dd>{x.auth || "—"}</dd>
        <dt>Issue date</dt><dd className="mono">{x.issue}</dd>
        <dt>Expiry date</dt><dd className="mono">{x.expiry}</dd>
        <dt>Days to expiry</dt><dd>{x.daysRemaining ?? left}</dd>
        <dt>Risk grade</dt><dd>{priBadge(x.risk)}</dd>
        <dt>Status</dt><dd>{statusBadge(docState(x))}</dd>
        <dt>Reminder threshold</dt><dd>{x.reminderThreshold || DEFAULT_REMINDER_THRESHOLD} days</dd>
        <dt>Reminder sent</dt><dd>{flagBadge(!!x.reminderSent || !!x.notified, "Sent", "Not sent")}</dd>
        <dt>Overdue</dt><dd>{flagBadge(!!x.isOverdue, "Overdue", "On Track")}</dd>
        <dt>Escalated</dt><dd>{flagBadge(!!x.isEscalated, "Escalated", "Not Escalated")}</dd>
        <dt>Owner</dt><dd>{x.owner || "—"}</dd>
        <dt>Business unit</dt><dd>{x.bu || "—"}</dd>
        <dt>Current renewal</dt><dd>{x.currentRenewalName || x.currentRenewalId || "—"}</dd>
        <dt>Notification sent</dt><dd>{x.notified ? formatDateTime(x.notified) : <span className="badge b-warn">Not sent</span>}</dd>
        <dt>Renewal completion</dt><dd>{x.done || "—"}</dd>
      </dl>
      {locked ? <div className="note"><b>This renewal cycle is closed and read only.</b> Completion recorded {x.done}.</div> : null}
      <div className="note">Risk is calculated from days remaining. The reminder window is the threshold on the record (default {DEFAULT_REMINDER_THRESHOLD} days). <b>Renew</b> extends expiry by twelve months and closes the open renewal task.</div>
    </Overlay>
  );
}

function PartyForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const buId = String(f.get("bu") || "");
    const unit = db.businessUnits.find((u) => u.id === buId);
    setBusy(true);
    try {
      await addParty({
        name: String(f.get("name")),
        category: String(f.get("category")) as Category,
        email: String(f.get("email")),
        domain: String(f.get("domain")),
        bu: unit?.name || String(f.get("bu") || ""),
        buId: unit?.id || buId || undefined,
        owner: ME,
        criticality: String(f.get("crit")) as "High" | "Medium" | "Low",
      });
      onSave();
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
        <div><label>Sender domain *</label><input name="domain" required placeholder="mohp.gov.eg" /></div>
        <div><label>Business unit *</label>
          <select name="bu" required>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
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

function DocForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await addDoc({
        type: String(f.get("type")) as License["type"],
        name: String(f.get("name")),
        party: String(f.get("party")),
        auth: String(f.get("auth")),
        issue: String(f.get("issue")),
        expiry: String(f.get("expiry")),
        risk: "Medium",
        reminderThreshold: Number(f.get("threshold")) || DEFAULT_REMINDER_THRESHOLD,
        owner: String(f.get("owner")),
        bu: db.businessUnits.find((u) => u.id === String(f.get("bu")))?.name || String(f.get("bu") || ""),
        buId: String(f.get("bu") || "") || undefined,
      });
      onSave();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="form">
        <div className="wide"><label>Document name *</label><input name="name" required /></div>
        <div><label>Type *</label><select name="type"><option>License</option><option>Contract</option><option>Permit</option></select></div>
        <div><label>Reminder threshold (days)</label><input name="threshold" type="number" min={1} defaultValue={DEFAULT_REMINDER_THRESHOLD} /></div>
        <div><label>External party *</label><select name="party">{db.parties.map((p) => <option key={p.id}>{p.name}</option>)}</select></div>
        <div><label>Issuing authority</label><input name="auth" /></div>
        <div><label>Issue date *</label><input name="issue" type="date" defaultValue={TODAY} required /></div>
        <div><label>Expiry date *</label><input name="expiry" type="date" required /></div>
        <div><label>Owner</label><input name="owner" defaultValue={ME} /></div>
        <div><label>Business unit</label>
          <select name="bu">
            {(db.businessUnits.length ? db.businessUnits : BUS.map((name) => ({ id: name, name }))).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="note">Days remaining and risk are calculated from the expiry date. If the document is already inside the reminder threshold, a renewal task and notification are created immediately.</div>
      <div className="df" style={{ margin: "16px -20px -20px" }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>Create Document</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
