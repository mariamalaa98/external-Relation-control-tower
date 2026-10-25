import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BUS, CATS, MATCH_BASES, OWNERS, PRIS, SUPS, type Category, type EscalationRule, type MatchBasis, type Priority, type RoutingRule } from "../data/types";
import {
  addEscalationRule,
  addRoutingRule,
  addSlaRule,
  removeRoutingRule,
  setEscalationRuleActive,
  setRoutingRuleActive,
  useStore,
} from "../data/store";
import { DataTable, Overlay, PageHead, catBadge, priBadge } from "./widgets";

type AdminTab = "routing" | "sla" | "escalation";
type AdminModal = "routing" | "sla" | "escalation" | null;

const REGIONS = ["EGY", "KSA"] as const;
const FUNCTIONS = ["External Correspondence"] as const;
const CHANNELS = ["Teams", "Email", "TMS"] as const;

function csvCell(value: string) {
  const text = (value || "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(name: string, cols: string[], rows: string[][]) {
  const lines = [cols.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function basisBadge(basis: MatchBasis) {
  const tone = basis === "Domain" ? "b-info" : basis === "Keyword" ? "b-warn" : "b-gold";
  return <span className={`badge ${tone}`}>{basis}</span>;
}

function levelBadge(level: EscalationRule["level"]) {
  return <span className={`badge ${level === "L2" ? "b-bad" : "b-warn"}`}>{level}</span>;
}

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`sw${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    />
  );
}

function Field({ label, required, wide, hint, children }: { label: string; required?: boolean; wide?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className={`mdf-field${wide ? " wide" : ""}`}>
      <label>{label}{required ? <span className="req"> *</span> : null}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function AdminConfiguration({
  busy,
  onRefresh,
  onDone,
  onFail,
}: {
  busy?: boolean;
  onRefresh: () => void;
  onDone: (msg: string) => void;
  onFail: (msg: string) => void;
}) {
  const db = useStore();
  const [tab, setTab] = useState<AdminTab>("routing");
  const [modal, setModal] = useState<AdminModal>(null);
  const [region, setRegion] = useState<(typeof REGIONS)[number]>("EGY");
  const [unit, setUnit] = useState("Andalusia Hospital – Smouha");
  const [department, setDepartment] = useState("Government Relations");
  const [fn, setFn] = useState<(typeof FUNCTIONS)[number]>("External Correspondence");

  const units = useMemo(() => {
    const names = db.businessUnits.map((row) => row.name);
    return names.length ? names : [...BUS];
  }, [db.businessUnits]);
  const departments = useMemo(() => {
    const names = new Set<string>(["Government Relations"]);
    for (const row of db.departments) if (row.name) names.add(row.name);
    for (const row of db.parties) if (row.department) names.add(row.department);
    return [...names];
  }, [db.departments, db.parties]);

  const unitLabel = units.includes(unit) ? unit : (units[0] || unit);

  function exportCsv() {
    const today = new Date().toISOString().slice(0, 10);
    if (tab === "routing") {
      downloadCsv(`routing-rules-${today}.csv`,
        ["Rule name", "Match basis", "Match value", "Category", "Default owner", "Priority", "Active"],
        db.routingRules.map((row) => [row.name, row.basis, row.value, row.category, row.owner, row.priority, row.active ? "Yes" : "No"]));
      return;
    }
    if (tab === "sla") {
      downloadCsv(`sla-matrix-${today}.csv`,
        ["Category", "Priority", "Acknowledge (hrs)", "Resolve (days)", "Basis"],
        db.sla.map((row) => [row.category, row.priority, String(row.ackHours), String(row.resolveDays), row.basis]));
      return;
    }
    downloadCsv(`escalation-rules-${today}.csv`,
      ["Trigger", "After", "Level", "Escalate to", "Channels", "Active"],
      db.escalationRules.map((row) => [row.trigger, `${row.afterDays} days`, row.level, row.escalateTo, row.channels, row.active ? "Yes" : "No"]));
  }

  const addLabel = tab === "routing" ? "New Rule" : tab === "sla" ? "New SLA Matrix" : "New Escalation Rule";

  return (
    <>
      <PageHead title="Admin Configuration" sub="Routing, SLA and escalation configuration">
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onRefresh}>↻ Refresh</button>
        <button className="btn btn-outline" type="button" onClick={exportCsv}>Export CSV</button>
        <button className="btn btn-primary" type="button" onClick={() => setModal(tab)}>+ {addLabel}</button>
      </PageHead>

      <div className="scope">
        <div className="f">
          <label>Region</label>
          <select value={region} onChange={(e) => setRegion(e.target.value as (typeof REGIONS)[number])}>
            {REGIONS.map((name) => <option key={name}>{name}</option>)}
          </select>
        </div>
        <div className="f">
          <label>Business Unit</label>
          <select value={unitLabel} onChange={(e) => setUnit(e.target.value)}>
            {units.map((name) => <option key={name}>{name}</option>)}
          </select>
        </div>
        <div className="f">
          <label>Department</label>
          <select value={departments.includes(department) ? department : departments[0]} onChange={(e) => setDepartment(e.target.value)}>
            {departments.map((name) => <option key={name}>{name}</option>)}
          </select>
        </div>
        <div className="f">
          <label>Function</label>
          <select value={fn} onChange={(e) => setFn(e.target.value as (typeof FUNCTIONS)[number])}>
            {FUNCTIONS.map((name) => <option key={name}>{name}</option>)}
          </select>
        </div>
      </div>

      <div className="callout">
        Configuration is admin-only. Routing rules resolve top to bottom and pre-fill Process inbound email. SLA rows are the targets used when a communication is matched. All values resolve for <b>{unitLabel} — {region}</b>.
      </div>

      <div className="tabs">
        <button type="button" className={tab === "routing" ? "on" : ""} onClick={() => setTab("routing")}>Routing Rules</button>
        <button type="button" className={tab === "sla" ? "on" : ""} onClick={() => setTab("sla")}>SLA Matrix</button>
        <button type="button" className={tab === "escalation" ? "on" : ""} onClick={() => setTab("escalation")}>Escalation Rules</button>
      </div>

      {tab === "routing" && (
        <DataTable
          cols={["Rule name", "Match basis", "Match value", "Category", "Default owner", "Priority", "Active", ""]}
          rows={db.routingRules.map((row) => ({
            key: row.id,
            cells: [
              row.name,
              basisBadge(row.basis),
              row.value,
              catBadge(row.category),
              row.owner,
              priBadge(row.priority),
              <Switch key="sw" on={row.active} label={`${row.name} active`} onClick={() => setRoutingRuleActive(row.id, !row.active)} />,
              <button key="x" className="row-x" type="button" aria-label={`Remove ${row.name}`} onClick={() => { removeRoutingRule(row.id); onDone(`${row.name} removed`); }}>×</button>,
            ],
          }))}
        />
      )}

      {tab === "sla" && (
        <DataTable
          cols={["Category", "Priority", "Acknowledge (hrs)", "Resolve (days)", "Basis"]}
          rows={db.sla.map((row) => ({
            key: row.id,
            cells: [
              catBadge(row.category),
              priBadge(row.priority),
              row.ackHours,
              row.resolveDays,
              row.basis,
            ],
          }))}
        />
      )}

      {tab === "escalation" && (
        <DataTable
          cols={["Trigger", "After", "Level", "Escalate to", "Channels", "Active"]}
          rows={db.escalationRules.map((row) => ({
            key: row.id,
            cells: [
              row.trigger,
              `${row.afterDays} days`,
              levelBadge(row.level),
              row.escalateTo,
              row.channels,
              <Switch key="sw" on={row.active} label={`${row.trigger} active`} onClick={() => setEscalationRuleActive(row.id, !row.active)} />,
            ],
          }))}
        />
      )}

      {modal === "routing" && (
        <RoutingForm
          busy={!!busy}
          onClose={() => setModal(null)}
          onSaved={(name) => { setModal(null); onDone(`${name} added`); }}
        />
      )}
      {modal === "sla" && (
        <SlaForm
          busy={!!busy}
          onClose={() => setModal(null)}
          onSaved={(name) => { setModal(null); onDone(`${name} added to the SLA matrix`); }}
          onFail={onFail}
        />
      )}
      {modal === "escalation" && (
        <EscalationForm
          busy={!!busy}
          onClose={() => setModal(null)}
          onSaved={(name) => { setModal(null); onDone(`${name} added`); }}
        />
      )}
    </>
  );
}

function RoutingForm({ busy, onClose, onSaved }: { busy: boolean; onClose: () => void; onSaved: (name: string) => void }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") || "").trim();
    const value = String(f.get("value") || "").trim();
    if (!name || !value) return;
    const row: Omit<RoutingRule, "id"> = {
      name,
      basis: String(f.get("basis") || "Domain") as MatchBasis,
      value,
      category: String(f.get("category") || "Government") as Category,
      owner: String(f.get("owner") || OWNERS[0]),
      priority: String(f.get("priority") || "High") as Priority,
      active: f.get("active") === "on",
    };
    addRoutingRule(row);
    onSaved(name);
  }
  return (
    <Overlay kind="modal" title="New routing rule" sub="Added at the end. Earlier rules still match first." onClose={onClose} footer={null}>
      <form onSubmit={submit}>
        <div className="mdf" style={{ border: "none", padding: 0 }}>
          <Field label="Rule name" required wide>
            <input name="name" required placeholder="Government domain routing" />
          </Field>
          <Field label="Match basis" required>
            <select name="basis" defaultValue="Domain">
              {MATCH_BASES.map((basis) => <option key={basis}>{basis}</option>)}
            </select>
          </Field>
          <Field label="Match value" required>
            <input name="value" required placeholder="*.gov.eg" />
          </Field>
          <Field label="Category" required>
            <select name="category" defaultValue="Government">
              {CATS.map((cat) => <option key={cat}>{cat}</option>)}
            </select>
          </Field>
          <Field label="Default owner" required>
            <select name="owner" defaultValue={OWNERS[0]}>
              {OWNERS.map((name) => <option key={name}>{name}</option>)}
            </select>
          </Field>
          <Field label="Priority" required>
            <select name="priority" defaultValue="High">
              {PRIS.map((pri) => <option key={pri}>{pri}</option>)}
            </select>
          </Field>
          <Field label="Active">
            <label><input type="checkbox" name="active" defaultChecked /> Active</label>
          </Field>
        </div>
        <div className="df" style={{ margin: "16px -20px -20px", borderRadius: 0 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>Add rule</button>
          <button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Overlay>
  );
}

function SlaForm({
  busy,
  onClose,
  onSaved,
  onFail,
}: {
  busy: boolean;
  onClose: () => void;
  onSaved: (name: string) => void;
  onFail: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const category = String(f.get("category") || "Government") as Category;
    const priority = String(f.get("priority") || "High") as Priority;
    const ackHours = Number(f.get("ack"));
    const resolveDays = Number(f.get("resolve"));
    const basis = String(f.get("basis") || "Working days") as "Working days" | "Calendar days" | "Hours";
    if (!Number.isFinite(ackHours) || ackHours < 0 || !Number.isFinite(resolveDays) || resolveDays < 1) {
      onFail("Acknowledge hours and resolve days are required");
      return;
    }
    setSaving(true);
    try {
      const row = await addSlaRule({ category, priority, ackHours, resolveDays, basis, active: true });
      onSaved(row.name);
    } catch (err) {
      onFail(err instanceof Error ? err.message : "Could not save the SLA matrix row");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Overlay kind="modal" title="New SLA matrix" sub="Category and priority targets used when a communication is matched" onClose={onClose} footer={null}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="mdf" style={{ border: "none", padding: 0 }}>
          <Field label="Category" required>
            <select name="category" defaultValue="Government">
              {CATS.map((cat) => <option key={cat}>{cat}</option>)}
            </select>
          </Field>
          <Field label="Priority" required>
            <select name="priority" defaultValue="Critical">
              {PRIS.map((pri) => <option key={pri}>{pri}</option>)}
            </select>
          </Field>
          <Field label="Acknowledge (hrs)" required>
            <input name="ack" type="number" min={0} step={1} required defaultValue={4} />
          </Field>
          <Field label="Resolve (days)" required>
            <input name="resolve" type="number" min={1} step={1} required defaultValue={2} />
          </Field>
          <Field label="Basis" required>
            <select name="basis" defaultValue="Working days">
              <option>Working days</option>
              <option>Calendar days</option>
              <option>Hours</option>
            </select>
          </Field>
        </div>
        <div className="df" style={{ margin: "16px -20px -20px", borderRadius: 0 }}>
          <button className="btn btn-primary" type="submit" disabled={busy || saving}>Add SLA matrix</button>
          <button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Overlay>
  );
}

function EscalationForm({ busy, onClose, onSaved }: { busy: boolean; onClose: () => void; onSaved: (name: string) => void }) {
  const people = [...new Set([...SUPS, ...OWNERS, "Supervisor / BU Manager", "Executive + Legal Affairs", "Department Head"])];
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const trigger = String(f.get("trigger") || "").trim();
    const escalateTo = String(f.get("to") || "").trim();
    const afterDays = Number(f.get("after"));
    if (!trigger || !escalateTo || !Number.isFinite(afterDays) || afterDays < 0) return;
    const channels = CHANNELS.filter((name) => f.get(name) === "on");
    if (!channels.length) {
      setError("Choose at least one channel");
      return;
    }
    setError("");
    addEscalationRule({
      trigger,
      afterDays,
      level: String(f.get("level") || "L1") === "L2" ? "L2" : "L1",
      escalateTo,
      channels: channels.join(" + "),
      active: f.get("active") === "on",
    });
    onSaved(trigger);
  }
  return (
    <Overlay kind="modal" title="New escalation rule" sub="Who is notified, and after how long, when a case or renewal is late" onClose={onClose} footer={null}>
      <form onSubmit={submit}>
        <div className="mdf" style={{ border: "none", padding: 0 }}>
          <Field label="Trigger" required wide>
            <input name="trigger" required placeholder="SLA breached" list="esc-triggers" />
            <datalist id="esc-triggers">
              <option value="SLA breached" />
              <option value="L1 unresolved" />
              <option value="Legal category breach" />
              <option value="Renewal overdue" />
            </datalist>
          </Field>
          <Field label="After (days)" required>
            <input name="after" type="number" min={0} step={1} required defaultValue={0} />
          </Field>
          <Field label="Level" required>
            <select name="level" defaultValue="L1">
              <option>L1</option>
              <option>L2</option>
            </select>
          </Field>
          <Field label="Escalate to" required wide>
            <input name="to" required placeholder="Supervisor / BU Manager" list="esc-people" />
            <datalist id="esc-people">
              {people.map((name) => <option key={name} value={name} />)}
            </datalist>
          </Field>
          <Field label="Channels" required wide>
            {CHANNELS.map((name) => (
              <label key={name} style={{ marginRight: 14 }}>
                <input type="checkbox" name={name} defaultChecked={name !== "TMS"} /> {name}
              </label>
            ))}
          </Field>
          <Field label="Active">
            <label><input type="checkbox" name="active" defaultChecked /> Active</label>
          </Field>
          {error ? <div className="mdf-field wide"><div className="hint" style={{ color: "var(--bad)" }}>{error}</div></div> : null}
        </div>
        <div className="df" style={{ margin: "16px -20px -20px", borderRadius: 0 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>Add escalation rule</button>
          <button className="btn btn-outline" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Overlay>
  );
}
