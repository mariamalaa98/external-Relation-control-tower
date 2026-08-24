import { useMemo, useState, type FormEvent } from "react";
import { BUS, CATS, PRIS, type Category, type Communication, type License, type Party, type Priority } from "./data/types";
import {
  ME,
  TODAY,
  addComm,
  addDoc,
  addDays,
  addParty,
  daysBetween,
  docState,
  nextCommId,
  nextDocId,
  slaDays,
  slaState,
  useStore,
} from "./data/store";
import { DataTable, PageHead, catBadge, priBadge, slaBadge, statusBadge } from "./ui/widgets";

const NAV = [
  { area: "ops", group: "COMMAND CENTER", items: [
    { id: "dashboard", ico: "â—«", text: "Executive Dashboard" },
    { id: "pending", ico: "â˜‘", text: "My Pending Actions" },
  ]},
  { area: "ops", group: "COMMUNICATIONS", items: [
    { id: "intake", ico: "âœ‰", text: "Mailbox Intake" },
    { id: "tracker", ico: "â˜°", text: "Communication Tracker" },
    { id: "legal", ico: "âš–", text: "Legal Cases Notification" },
  ]},
  { area: "comp", group: "LICENSES & CONTRACTS", items: [
    { id: "licenses", ico: "ðŸ—Ž", text: "License & Contract Tracker" },
    { id: "renewals", ico: "â–¦", text: "Renewal Calendar" },
  ]},
  { area: "comp", group: "REFERENCE DATA", items: [
    { id: "parties", ico: "ðŸ›", text: "External Party Master" },
    { id: "archive", ico: "ðŸ—‚", text: "Document Archive" },
  ]},
  { area: "gov", group: "ESCALATION & NOTIFICATIONS", items: [
    { id: "escalation", ico: "â–²", text: "Escalation Center" },
    { id: "notifications", ico: "ðŸ””", text: "Notification Center" },
  ]},
  { area: "gov", group: "ADMIN", items: [
    { id: "admin", ico: "âš™", text: "Admin Configuration" },
  ]},
  { area: "gov", group: "REPORTS", items: [
    { id: "reports", ico: "ðŸ“ˆ", text: "Power BI Reports" },
  ]},
  { area: "gov", group: "AUDIT", items: [
    { id: "auditComm", ico: "ðŸ”", text: "Communication Audit" },
    { id: "auditNotif", ico: "ðŸ”", text: "Notification Audit" },
  ]},
] as const;

const AREAS = [
  { id: "ops", label: "Communications" },
  { id: "comp", label: "Licenses & Contracts" },
  { id: "gov", label: "Governance & Audit" },
] as const;

type ScreenId = (typeof NAV)[number]["items"][number]["id"];
type AreaId = (typeof AREAS)[number]["id"];
const LATER: ScreenId[] = ["intake", "archive", "escalation", "notifications", "reports", "auditComm", "auditNotif"];

export default function App({ dataverseReady }: { dataverseReady: boolean }) {
  const db = useStore();
  const [area, setArea] = useState<AreaId>("ops");
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"party" | "comm" | "doc" | null>(null);

  function go(id: ScreenId) {
    const found = NAV.find((g) => g.items.some((i) => i.id === id));
    if (found) setArea(found.area);
    setScreen(id);
    setQ("");
  }
  function ping(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }

  const openComms = db.comms.filter((c) => c.status !== "Closed");
  const mine = openComms.filter((c) => c.owner === ME);
  const breached = openComms.filter((c) => slaState(c) === "Breached");
  const expiring = db.docs.filter((d) => {
    const s = docState(d);
    return s === "Expiring" || s === "Expired";
  });
  const closed = db.comms.filter((c) => c.status === "Closed");
  const compliance = closed.length
    ? Math.round((closed.filter((c) => slaState(c) === "Within").length / closed.length) * 100)
    : 0;
  const catCounts = CATS.map((cat) => ({ cat, n: db.comms.filter((c) => c.cat === cat).length }));
  const maxCat = Math.max(...catCounts.map((x) => x.n), 1);

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
          <span className="hdr-icon">âŒ•</span>
          <span className="hdr-icon" onClick={() => setModal("comm")}>ï¼‹</span>
          <span className="hdr-icon">âš™</span>
          <div className="avatar">HG</div>
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
                </button>
              ))}
            </div>
          ))}
        </aside>
        <main>
          {!dataverseReady && (
            <div className="banner warn">
              Running on prototype data. After <b>pa app init</b> and adding Dataverse tables, these screens will use your <b>erc_</b> records.
            </div>
          )}

          {screen === "dashboard" && (
            <>
              <PageHead title="Executive Dashboard" sub={`${db.comms.length} communications · ${db.docs.length} documents`}>
                <button className="btn btn-outline" type="button" onClick={() => ping("Refreshed")}>Refresh</button>
              </PageHead>
              <div className="kpis">
                <Kpi acc="var(--bronze)" label="Total Communications" value={db.comms.length} detail="All categories" onClick={() => go("tracker")} />
                <Kpi acc="var(--info)" label="Open" value={openComms.length} detail="Awaiting action" onClick={() => go("pending")} />
                <Kpi acc="var(--bad)" label="Overdue" value={breached.length} detail="SLA breached" onClick={() => go("tracker")} />
                <Kpi acc="var(--ok)" label="SLA Compliance" value={`${compliance}%`} detail="Closed records" />
                <Kpi acc="var(--warn)" label="Renewals Due" value={expiring.length} detail="Within 90 days / expired" onClick={() => go("renewals")} />
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
                    <div className="donut" />
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
              <PageHead title="My Pending Actions" sub={`${mine.length} open items owned by ${ME}`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal("comm")}>New Communication</button>
              </PageHead>
              <CommTable rows={mine} q={q} setQ={setQ} />
            </>
          )}

          {screen === "tracker" && (
            <>
              <PageHead title="Communication Tracker" sub={`${db.comms.length} records`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal("comm")}>New Communication</button>
              </PageHead>
              <CommTable rows={db.comms} q={q} setQ={setQ} />
            </>
          )}

          {screen === "legal" && (
            <>
              <PageHead title="Legal Cases Notification" sub="Communications where Category = Legal" />
              <CommTable rows={db.comms.filter((c) => c.cat === "Legal")} q={q} setQ={setQ} />
            </>
          )}

          {screen === "parties" && (
            <>
              <PageHead title="External Party Master" sub={`${db.parties.length} parties`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal("party")}>New Party</button>
              </PageHead>
              <div className="filters">
                <input placeholder="Search party, domain, email" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <DataTable
                cols={["Party", "Category", "Email", "Domain", "Business Unit", "Default Owner", "Criticality", "Status", "Comms"]}
                rows={db.parties
                  .filter((p) => `${p.name} ${p.domain} ${p.email}`.toLowerCase().includes(q.toLowerCase()))
                  .map((p) => ({
                    key: p.id,
                    cells: [
                      p.name,
                      catBadge(p.category),
                      p.email,
                      p.domain,
                      p.bu,
                      p.owner,
                      priBadge(p.criticality === "Low" ? "Low" : p.criticality === "Medium" ? "Medium" : "High"),
                      statusBadge(p.status),
                      db.comms.filter((c) => c.party === p.name).length,
                    ],
                  }))}
              />
            </>
          )}

          {screen === "licenses" && (
            <>
              <PageHead title="License & Contract Tracker" sub={`${db.docs.length} documents`}>
                <button className="btn btn-primary" type="button" onClick={() => setModal("doc")}>New Document</button>
              </PageHead>
              <DocTable rows={db.docs} q={q} setQ={setQ} />
            </>
          )}

          {screen === "renewals" && (
            <>
              <PageHead title="Renewal Calendar" sub={`${expiring.length} due within 90 days or expired`} />
              <DocTable rows={[...db.docs].sort((a, b) => a.expiry.localeCompare(b.expiry))} q={q} setQ={setQ} />
            </>
          )}

          {screen === "admin" && (
            <>
              <PageHead title="Admin Configuration" sub="SLA matrix used to calculate due dates" />
              <DataTable
                cols={["Category", "Priority", "Ack (hours)", "Resolve (days)", "Basis"]}
                rows={db.sla.map((r, i) => ({
                  key: String(i),
                  cells: [catBadge(r.category), priBadge(r.priority), r.ackHours, r.resolveDays, r.basis],
                }))}
              />
            </>
          )}

          {LATER.includes(screen) && (
            <>
              <PageHead
                title={NAV.flatMap((g) => [...g.items]).find((i) => i.id === screen)?.text || ""}
                sub="Phase 2 â€” mailbox, archive, escalation and notification tables"
              />
              <div className="ph">Phase 1 uses Communication, External Party, SLA, and License & Contract only.</div>
            </>
          )}
        </main>
      </div>

      {modal && (
        <>
          <div className="scrim open" onClick={() => setModal(null)} />
          <div className="modal open">
            <div className="dh">
              <div>
                <div className="t">{modal === "party" ? "New External Party" : modal === "doc" ? "New Document" : "New Communication"}</div>
                <div className="s">Saved locally until Dataverse is connected</div>
              </div>
              <button className="x" type="button" onClick={() => setModal(null)}>âœ•</button>
            </div>
            {modal === "party" && <PartyForm onCancel={() => setModal(null)} onSave={() => { setModal(null); ping("Party created"); }} />}
            {modal === "comm" && <CommForm onCancel={() => setModal(null)} onSave={() => { setModal(null); ping("Communication created"); }} />}
            {modal === "doc" && <DocForm onCancel={() => setModal(null)} onSave={() => { setModal(null); ping("Document created"); }} />}
          </div>
        </>
      )}
      <div id="toast" className={toast ? "on" : ""}>{toast}</div>
    </>
  );
}

function Kpi({ acc, label, value, detail, onClick }: { acc: string; label: string; value: number | string; detail: string; onClick?: () => void }) {
  return (
    <div className="kpi" style={{ ["--acc" as string]: acc }} onClick={onClick}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
    </div>
  );
}

function CommTable({ rows, q, setQ }: { rows: Communication[]; q: string; setQ: (v: string) => void }) {
  const filtered = useMemo(
    () => rows.filter((r) => `${r.id} ${r.party} ${r.subj} ${r.owner}`.toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  );
  return (
    <>
      <div className="filters">
        <input placeholder="Search ID, party, subject, owner" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["CommID", "External Party", "Category", "Subject", "Owner", "Priority", "Received", "Due", "Status", "SLA"]}
        rows={filtered.map((r) => ({
          key: r.id,
          legal: r.cat === "Legal",
          cells: [
            <span className="link" key="id">{r.id}</span>,
            r.party,
            catBadge(r.cat),
            r.subj,
            r.owner,
            priBadge(r.pri),
            <span className="mono" key="rec">{r.rec}</span>,
            <span className="mono" key="due">{r.due}</span>,
            statusBadge(r.status),
            slaBadge(slaState(r)),
          ],
        }))}
      />
    </>
  );
}

function DocTable({ rows, q, setQ }: { rows: License[]; q: string; setQ: (v: string) => void }) {
  const filtered = useMemo(
    () => rows.filter((r) => `${r.id} ${r.name} ${r.party}`.toLowerCase().includes(q.toLowerCase())),
    [rows, q]
  );
  return (
    <>
      <div className="filters">
        <input placeholder="Search document, party" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["ID", "Type", "Document", "External Party", "Expiry", "Days left", "Risk", "Status", "Owner"]}
        rows={filtered.map((r) => ({
          key: r.id,
          cells: [
            r.id,
            r.type,
            r.name,
            r.party,
            <span className="mono" key="exp">{r.expiry}</span>,
            daysBetween(TODAY, r.expiry),
            priBadge(r.risk === "Low" ? "Low" : r.risk === "Medium" ? "Medium" : "High"),
            statusBadge(docState(r)),
            r.owner,
          ],
        }))}
      />
    </>
  );
}

function PartyForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addParty({
      id: `P${db.parties.length + 11}`,
      name: String(f.get("name")),
      category: String(f.get("category")) as Category,
      email: String(f.get("email")),
      domain: String(f.get("domain")),
      bu: String(f.get("bu")),
      owner: String(f.get("owner")),
      criticality: String(f.get("crit")) as Party["criticality"],
      status: "Active",
    });
    onSave();
  }
  return (
    <form onSubmit={submit}>
      <div className="db">
        <div className="form">
          <div className="wide"><label>Party name *</label><input name="name" required /></div>
          <div><label>Category *</label><select name="category">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>Criticality</label><select name="crit"><option>High</option><option>Medium</option><option>Low</option></select></div>
          <div><label>Official email *</label><input name="email" type="email" required /></div>
          <div><label>Sender domain *</label><input name="domain" required placeholder="mohp.gov.eg" /></div>
          <div><label>Business unit</label><select name="bu">{BUS.map((b) => <option key={b}>{b}</option>)}</select></div>
          <div><label>Default owner</label><input name="owner" defaultValue={ME} /></div>
        </div>
      </div>
      <div className="df">
        <button className="btn btn-primary" type="submit">Create Party</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function CommForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cat = String(f.get("cat")) as Category;
    const pri = String(f.get("pri")) as Priority;
    const rec = String(f.get("rec"));
    addComm({
      id: nextCommId(),
      party: String(f.get("party")),
      cat,
      subj: String(f.get("subj")),
      owner: String(f.get("owner")),
      sup: String(f.get("sup")),
      pri,
      rec,
      due: addDays(rec, slaDays(cat, pri)),
      status: "Open",
      bu: String(f.get("bu")),
      caseRef: String(f.get("caseRef") || ""),
    });
    onSave();
  }
  return (
    <form onSubmit={submit}>
      <div className="db">
        <div className="form">
          <div className="wide"><label>Subject *</label><input name="subj" required /></div>
          <div><label>External party *</label><select name="party">{db.parties.map((p) => <option key={p.id}>{p.name}</option>)}</select></div>
          <div><label>Category *</label><select name="cat">{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>Priority *</label><select name="pri" defaultValue="High">{PRIS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>Owner *</label><input name="owner" defaultValue={ME} required /></div>
          <div><label>Supervisor</label><input name="sup" defaultValue="Dr. Bassam Farid" /></div>
          <div><label>Received date *</label><input name="rec" type="date" defaultValue={TODAY} required /></div>
          <div><label>Business unit</label><select name="bu">{BUS.map((b) => <option key={b}>{b}</option>)}</select></div>
          <div className="wide"><label>Case reference (legal)</label><input name="caseRef" /></div>
        </div>
        <div className="note">Due date is calculated from the SLA matrix for the chosen category and priority.</div>
      </div>
      <div className="df">
        <button className="btn btn-primary" type="submit">Create Record</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function DocForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    addDoc({
      id: nextDocId(),
      type: String(f.get("type")) as License["type"],
      name: String(f.get("name")),
      party: String(f.get("party")),
      auth: String(f.get("auth")),
      issue: String(f.get("issue")),
      expiry: String(f.get("expiry")),
      risk: String(f.get("risk")) as License["risk"],
      owner: String(f.get("owner")),
      bu: String(f.get("bu")),
    });
    onSave();
  }
  return (
    <form onSubmit={submit}>
      <div className="db">
        <div className="form">
          <div className="wide"><label>Document name *</label><input name="name" required /></div>
          <div><label>Type *</label><select name="type"><option>License</option><option>Contract</option><option>Permit</option></select></div>
          <div><label>Risk</label><select name="risk"><option>High</option><option>Medium</option><option>Low</option></select></div>
          <div><label>External party *</label><select name="party">{db.parties.map((p) => <option key={p.id}>{p.name}</option>)}</select></div>
          <div><label>Issuing authority</label><input name="auth" /></div>
          <div><label>Issue date *</label><input name="issue" type="date" defaultValue={TODAY} required /></div>
          <div><label>Expiry date *</label><input name="expiry" type="date" required /></div>
          <div><label>Owner</label><input name="owner" defaultValue={ME} /></div>
          <div><label>Business unit</label><select name="bu">{BUS.map((b) => <option key={b}>{b}</option>)}</select></div>
        </div>
      </div>
      <div className="df">
        <button className="btn btn-primary" type="submit">Create Document</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

