import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  BUS,
  LICENSE_RENEWAL_STATUSES,
  type License,
  type LicenseRenewalStatus,
  type Notice,
  type Renewal,
} from "../data/types";
import {
  DEFAULT_REMINDER_THRESHOLD,
  ME,
  TODAY,
  addDoc,
  completeCycle,
  daysBetween,
  docLocked,
  docState,
  downloadArchiveFile,
  downloadLicenseFile,
  escalateLicense,
  formatDateTime,
  markNoticeRead,
  matchesSearch,
  reopenDoc,
  renewDoc,
  sameId,
  saveDoc,
  sendRenewalNotice,
  uploadLicenseFile,
  useStore,
} from "../data/store";
import { downloadBytes, mimeFromFileName } from "../data/emailAttachments";
import { DataTable, FilterField, Kpi, Overlay, flagBadge, priBadge, statusBadge } from "./widgets";
import { ArchiveUploadForm } from "./archive";

export function NotificationCenter({
  q,
  setQ,
  busy,
  onOpenDoc,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  onOpenDoc: (doc: License) => void;
}) {
  const db = useStore();
  const [type, setType] = useState("All");
  const [read, setRead] = useState("Unread");
  const filtered = useMemo(() => db.notices.filter((n) => {
    const hit = `${n.title} ${n.documentName || ""} ${n.message || ""} ${n.owner}`.toLowerCase().includes(q.toLowerCase());
    const typeOk = type === "All" || n.type === type;
    const readOk = read === "All" || (read === "Unread" ? !n.isRead : n.isRead);
    return hit && typeOk && readOk;
  }), [db.notices, q, type, read]);

  function openRelated(n: Notice) {
    const doc = db.docs.find((d) => d.recordId === n.documentId || d.id === n.documentId);
    if (doc) onOpenDoc(doc);
  }

  return (
    <>
      <div className="callout">
        <b>Notification log</b> records reminder, expiry, and escalation events from the license/contract expiry monitor.
        The app writes these rows to Dataverse. Email sending can be attached later with Power Automate.
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search title, document, owner" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option>All</option>
            <option>Reminder</option>
            <option>Expiry</option>
            <option>Escalation</option>
          </select>
        </FilterField>
        <FilterField label="Read">
          <select value={read} onChange={(e) => setRead(e.target.value)}>
            <option>All</option>
            <option>Unread</option>
            <option>Read</option>
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} shown · {db.notices.filter((n) => !n.isRead).length} unread</span>
      </div>
      <DataTable
        cols={["Sent", "Type", "Title", "Document", "Result", "Owner", ""]}
        rows={filtered.map((n) => ({
          key: n.recordId || n.id,
          onClick: () => openRelated(n),
          cells: [
            <span className="mono" key="s">{formatDateTime(n.sentOn)}</span>,
            statusBadge(n.type),
            <>{n.isRead ? n.title : <b>{n.title}</b>}</>,
            n.documentName || "—",
            flagBadge(n.result === "Sent", "Sent", "Failed"),
            n.owner || "—",
            n.isRead
              ? statusBadge("Read")
              : (
                <button
                  className="btn btn-outline btn-mini"
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void markNoticeRead(n.id);
                  }}
                >
                  Mark read
                </button>
              ),
          ],
        }))}
      />
    </>
  );
}

export function LicenseEscalationPanel({
  q,
  busy,
  docs,
  onOpen,
  onEscalate,
}: {
  q: string;
  busy: boolean;
  docs: License[];
  onOpen: (row: License) => void;
  onEscalate: (row: License) => void;
}) {
  const db = useStore();
  const rows = docs.filter((d) => {
    const hit = `${d.id} ${d.name} ${d.party} ${d.owner}`.toLowerCase().includes(q.toLowerCase());
    return hit && (d.isOverdue || d.isEscalated || docState(d) === "Expired");
  });
  const pending = docs.filter((d) => d.isOverdue && !d.isEscalated && !d.done);
  const escalated = docs.filter((d) => d.isEscalated);
  return (
    <>
      <div className="callout">
        <b>License / contract escalation.</b> When expiry is reached and the renewal is not completed, risk becomes Critical, the renewal is Overdue, and the record is sent to Escalation Center once.
      </div>
      <div className="kpis">
        <div className="kpi" style={{ ["--acc" as string]: "var(--bad)" }}>
          <div className="l">Pending expiry</div>
          <div className="v">{pending.length}</div>
          <div className="d">Expired, not escalated</div>
        </div>
        <div className="kpi" style={{ ["--acc" as string]: "var(--warn)" }}>
          <div className="v">{escalated.length}</div>
          <div className="l">Escalated</div>
          <div className="d">Is Escalated = Yes</div>
        </div>
      </div>
      <DataTable
        cols={["ID", "Document", "Expiry", "Days", "Risk", "Overdue", "Escalation", "Owner", ""]}
        rows={rows.map((r) => {
          const renewal = db.renewals.find((x) => x.recordId === r.currentRenewalId || x.documentId === r.recordId || x.documentId === r.id);
          return {
            key: r.recordId || r.id,
            onClick: () => onOpen(r),
            cells: [
              <span className="link" key="id">{r.id}</span>,
              r.name,
              <span className="mono" key="exp">{r.expiry}</span>,
              r.daysRemaining ?? daysBetween(TODAY, r.expiry),
              priBadge(r.risk),
              flagBadge(!!r.isOverdue, "Overdue", "On Track"),
              renewal?.escalation || (r.isEscalated ? "L1" : "Not Escalated"),
              r.owner || "—",
              r.isEscalated
                ? "Already escalated"
                : (
                  <button className="btn btn-outline btn-mini" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onEscalate(r); }}>
                    Escalate
                  </button>
                ),
            ],
          };
        })}
      />
    </>
  );
}

export function RenewalTaskTable({ rows }: { rows: Renewal[] }) {
  if (!rows.length) return null;
  return (
    <>
      <h2 className="sec">Renewal tasks ({rows.length})</h2>
      <DataTable
        cols={["ID", "Document", "Type", "Status", "Due", "Risk", "Escalation", "Owner", "Reminders"]}
        rows={rows.map((r) => ({
          key: r.recordId || r.id,
          cells: [
            r.id,
            r.documentName || "—",
            statusBadge(r.type),
            statusBadge(r.status),
            <span className="mono" key="due">{r.due ? r.due.slice(0, 10) : "—"}</span>,
            priBadge(r.risk),
            r.escalation,
            r.owner || ME,
            r.reminderCount ?? 0,
          ],
        }))}
      />
    </>
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

function deptsForUnit(departments: { id: string; name: string; companyId?: string; companyName?: string }[], buId?: string, buName?: string) {
  if (!buId && !buName) return departments;
  const matched = departments.filter((d) =>
    (buId && d.companyId && d.companyId.toLowerCase() === buId.toLowerCase())
    || (buName && d.companyName && d.companyName.toLowerCase() === buName.toLowerCase()),
  );
  return matched.length ? matched : departments;
}

export function LicenseTracker({
  rows,
  q,
  setQ,
  busy,
  onOpen,
  onRenew,
}: {
  rows: License[];
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  onOpen: (row: License) => void;
  onRenew: (row: License) => void;
}) {
  const [typeFilter, setTypeFilter] = useState("All");
  const [lifeFilter, setLifeFilter] = useState("All");
  const [renewalFilter, setRenewalFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [activeFilter, setActiveFilter] = useState("All");

  const filtered = useMemo(() => rows.filter((r) => {
    const st = docState(r);
    const hit = matchesSearch(
      q,
      r.id,
      r.documentNumber,
      r.name,
      r.party,
      r.auth,
      r.owner,
      r.department,
      r.bu,
      r.type,
      r.expiry,
      r.issue,
      r.renewalStatus,
      r.renewalNotes,
      r.status,
      r.documentUrl,
      r.currentDocumentName,
      r.currentRenewalName,
      r.escalationReason,
    );
    const typeOk = typeFilter === "All" || r.type === typeFilter;
    const lifeOk = lifeFilter === "All" || st === lifeFilter;
    const renewalOk = renewalFilter === "All" || (r.renewalStatus || "Not Started") === renewalFilter;
    const riskOk = riskFilter === "All" || r.risk === riskFilter;
    const activeOk = activeFilter === "All" || (activeFilter === "Active" ? r.active !== false : r.active === false);
    return hit && typeOk && lifeOk && renewalOk && riskOk && activeOk;
  }), [rows, q, typeFilter, lifeFilter, renewalFilter, riskFilter, activeFilter]);

  const expiring = rows.filter((d) => docState(d) === "Expiring");
  const expired = rows.filter((d) => docState(d) === "Expired" || d.isOverdue);
  const escalated = rows.filter((d) => d.isEscalated);
  const active = rows.filter((d) => d.active !== false && docState(d) === "Active");

  return (
    <>
      <div className="kpis">
        <Kpi acc="var(--ok)" label="Active" value={active.length} detail="Not in reminder window" />
        <Kpi acc="var(--warn)" label="Expiring" value={expiring.length} detail="Inside 90-day window" />
        <Kpi acc="var(--bad)" label="Expired" value={expired.length} detail="Expiry reached, not renewed" />
        <Kpi acc="var(--warn)" label="Escalated" value={escalated.length} detail="Is Escalated = Yes" />
        <Kpi acc="var(--info)" label="All documents" value={rows.length} detail="In the current org filter" />
      </div>
      <div className="callout">
        <b>License &amp; Contract Tracker</b> holds identity, party, dates, renewal, reminder, escalation, and the current document.
        Days remaining and risk update from the expiry date. The reminder threshold (default {DEFAULT_REMINDER_THRESHOLD} days) creates a renewal task and notification.
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input
            type="search"
            placeholder="Search number, name, party, authority"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
        </FilterField>
        <FilterField label="Type">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option>All</option><option>License</option><option>Contract</option><option>Permit</option></select>
        </FilterField>
        <FilterField label="Lifecycle">
          <select value={lifeFilter} onChange={(e) => setLifeFilter(e.target.value)}><option>All</option><option>Active</option><option>Expiring</option><option>Expired</option><option>Renewed</option></select>
        </FilterField>
        <FilterField label="Renewal status">
          <select value={renewalFilter} onChange={(e) => setRenewalFilter(e.target.value)}>
            <option>All</option>
            {LICENSE_RENEWAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </FilterField>
        <FilterField label="Risk">
          <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}><option>All</option><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select>
        </FilterField>
        <FilterField label="Active">
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}><option>All</option><option>Active</option><option>Inactive</option></select>
        </FilterField>
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["Number", "Type", "Document", "External party", "Issuing authority", "Issue", "Expiry", "Days", "Risk", "Renewal", "Reminder", "Overdue", "Escalated", "Owner", "BU", "Department", "Action"]}
        rows={filtered.map((r) => ({
          key: r.recordId || r.id,
          onClick: () => onOpen(r),
          cells: [
            <span className="link" key="id">{r.documentNumber || r.id}</span>,
            statusBadge(r.type),
            r.name,
            r.party || "—",
            r.auth || "—",
            <span className="mono" key="iss">{r.issue || "—"}</span>,
            <span className="mono" key="exp">{r.expiry}</span>,
            r.daysRemaining ?? daysBetween(TODAY, r.expiry),
            priBadge(r.risk),
            statusBadge(r.renewalStatus || "Not Started"),
            flagBadge(!!r.reminderSent || !!r.notified, "Sent", "Not sent"),
            flagBadge(!!r.isOverdue, "Overdue", "On Track"),
            flagBadge(!!r.isEscalated, "Escalated", "No"),
            r.owner || "—",
            r.bu || "—",
            r.department || "—",
            docLocked(r)
              ? <>{statusBadge("Closed")} 🔒</>
              : <button className="btn btn-outline btn-mini" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onRenew(r); }}>Renew</button>,
          ],
        }))}
      />
    </>
  );
}

export function LicenseCreateForm({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  const db = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const units = db.businessUnits.length ? db.businessUnits : BUS.map((name) => ({ id: name, name }));
  const [buId, setBuId] = useState(units[0]?.id || "");
  const unitName = units.find((u) => u.id === buId)?.name || "";
  const depts = deptsForUnit(db.departments, buId, unitName);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const partyId = String(f.get("partyId") || "");
    const party = db.parties.find((p) => p.id === partyId);
    const authId = String(f.get("authId") || "");
    const auth = db.parties.find((p) => p.id === authId);
    const deptId = String(f.get("deptId") || "");
    const dept = db.departments.find((d) => d.id === deptId);
    const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
    setBusy(true);
    setError("");
    try {
      await addDoc({
        type: String(f.get("type")) as License["type"],
        name: String(f.get("name") || "").trim(),
        documentNumber: String(f.get("documentNumber") || "").trim() || undefined,
        party: party?.name || "",
        partyId: party?.id,
        auth: auth?.name || String(f.get("auth") || "").trim(),
        issuingAuthorityId: auth?.id,
        issue: String(f.get("issue") || ""),
        expiry: String(f.get("expiry") || ""),
        risk: "Medium",
        reminderThreshold: Number(f.get("threshold")) || DEFAULT_REMINDER_THRESHOLD,
        renewalStatus: String(f.get("renewalStatus") || "Not Started") as LicenseRenewalStatus,
        renewalNotes: String(f.get("renewalNotes") || "").trim(),
        documentUrl: String(f.get("documentUrl") || "").trim(),
        owner: String(f.get("owner") || ME),
        bu: unitName,
        buId: buId || undefined,
        department: dept?.name,
        departmentId: dept?.id,
        active: String(f.get("active")) !== "false",
      }, file);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay
      kind="drawer"
      title="New license or contract"
      sub="Creates a License and Contract record with reminder and renewal fields"
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-primary" type="submit" form="license-create" disabled={busy}>Create Document</button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </>
      }
    >
      <form id="license-create" className="mdf" onSubmit={submit}>
        <div className="mdf-sec">Identity</div>
        <Field label="Document name" required wide>
          <input name="name" required maxLength={850} />
        </Field>
        <Field label="Document number">
          <input name="documentNumber" maxLength={100} placeholder="Assigned if left blank" />
        </Field>
        <Field label="Document type" required>
          <select name="type"><option>License</option><option>Contract</option><option>Permit</option></select>
        </Field>
        <Field label="Active" required>
          <select name="active" defaultValue="true"><option value="true">True</option><option value="false">False</option></select>
        </Field>

        <div className="mdf-sec">Party</div>
        <Field label="External party" required>
          <select name="partyId" required>
            <option value="">Select party</option>
            {db.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Issuing authority">
          <select name="authId" defaultValue="">
            <option value="">—</option>
            {db.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        <div className="mdf-sec">Dates and reminder</div>
        <Field label="Issue date">
          <input name="issue" type="date" defaultValue={TODAY} />
        </Field>
        <Field label="Expiry date" required>
          <input name="expiry" type="date" required />
        </Field>
        <Field label="Reminder threshold (days)" hint={`Default ${DEFAULT_REMINDER_THRESHOLD}. A renewal task is created when days remaining reach this value.`}>
          <input name="threshold" type="number" min={1} defaultValue={DEFAULT_REMINDER_THRESHOLD} />
        </Field>
        <Field label="Renewal status" required>
          <select name="renewalStatus" defaultValue="Not Started">
            {LICENSE_RENEWAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Renewal notes" wide>
          <input name="renewalNotes" maxLength={100} />
        </Field>

        <div className="mdf-sec">Document</div>
        <Field label="Document URL" hint="Max 100 characters">
          <input name="documentUrl" maxLength={100} placeholder="https://" />
        </Field>
        <Field label="Current document">
          <input name="file" type="file" />
        </Field>

        <div className="mdf-sec">Ownership</div>
        <Field label="Owner">
          <input name="owner" defaultValue={ME} />
        </Field>
        <Field label="Business unit">
          <select name="bu" value={buId} onChange={(e) => setBuId(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select name="deptId" defaultValue="">
            <option value="">—</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </form>
      {error ? <div className="note">{error}</div> : <div className="note">Days remaining and risk are calculated from the expiry date. Required Dataverse fields: type, expiry, risk, renewal status, active.</div>}
    </Overlay>
  );
}

export function LicenseRecordForm({
  row,
  busy,
  onClose,
  onSaved,
}: {
  row: License;
  busy: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const db = useStore();
  const locked = docLocked(row);
  const [saving, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [escReason, setEscReason] = useState(row.escalationReason || "");
  const units = db.businessUnits.length ? db.businessUnits : BUS.map((name) => ({ id: name, name }));
  const [buId, setBuId] = useState(row.buId || units.find((u) => u.name === row.bu)?.id || "");
  const unitName = units.find((u) => u.id === buId)?.name || row.bu;
  const depts = deptsForUnit(db.departments, buId, unitName);
  const left = row.daysRemaining ?? daysBetween(TODAY, row.expiry);
  const relatedRenewals = db.renewals.filter((r) => r.documentId === row.recordId || r.documentId === row.id || r.recordId === row.currentRenewalId);
  const relatedNotices = db.notices.filter((n) => n.documentId === row.recordId || n.documentId === row.id);
  const relatedArchives = db.archives.filter((a) => sameId(a.licenseId, row.recordId) || a.licenseId === row.id);

  async function run(ok: string, work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      onSaved(ok);
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked) return;
    const f = new FormData(e.currentTarget);
    const partyId = String(f.get("partyId") || "");
    const party = db.parties.find((p) => p.id === partyId);
    const authRaw = String(f.get("authId") || "");
    const keepAuth = authRaw === "__label__";
    const authId = keepAuth ? (row.issuingAuthorityId || "") : authRaw;
    const auth = db.parties.find((p) => p.id === authId);
    const deptRaw = String(f.get("deptId") || "");
    const keepDept = deptRaw === "__label__";
    const deptId = keepDept ? (row.departmentId || "") : deptRaw;
    const dept = db.departments.find((d) => d.id === deptId);
    await run("License saved", () => saveDoc(row.id, {
      name: String(f.get("name") || row.name).trim(),
      documentNumber: String(f.get("documentNumber") || "").trim() || row.documentNumber,
      type: String(f.get("type") || row.type) as License["type"],
      active: String(f.get("active")) !== "false",
      partyId,
      party: party?.name || "",
      issuingAuthorityId: keepAuth ? row.issuingAuthorityId : authId,
      auth: keepAuth ? row.auth : (auth?.name || ""),
      issue: String(f.get("issue") || row.issue),
      expiry: String(f.get("expiry") || row.expiry),
      reminderThreshold: Number(f.get("threshold")) || DEFAULT_REMINDER_THRESHOLD,
      renewalStatus: String(f.get("renewalStatus") || row.renewalStatus || "Not Started") as LicenseRenewalStatus,
      renewalNotes: String(f.get("renewalNotes") || "").trim(),
      documentUrl: String(f.get("documentUrl") || "").trim(),
      bu: unitName,
      buId,
      department: keepDept ? (row.department || "") : (dept?.name || ""),
      departmentId: keepDept ? row.departmentId : deptId,
    }));
  }

  async function onUpload(file?: File) {
    if (!file) return;
    await run(`Uploaded ${file.name}`, () => uploadLicenseFile(row.id, file));
  }

  async function onDownload() {
    try {
      const file = await downloadLicenseFile(row.id);
      downloadBytes(file.bytes, file.name, "application/octet-stream");
      onSaved(`Downloaded ${file.name}`);
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Download failed");
    }
  }

  const disabled = locked || saving || busy;

  return (
    <Overlay
      kind="drawer"
      title={row.name}
      sub={`${row.documentNumber || row.id} · ${row.party || "No external party"}`}
      onClose={onClose}
      footer={locked ? (
        <>
          <button className="btn btn-outline" type="button" disabled={busy || saving} onClick={() => void run("Renewal cycle reopened", () => reopenDoc(row.id))}>Reopen Renewal Cycle</button>
          <span className="closed-note">Completed {row.done || "—"} · read only</span>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close panel</button>
        </>
      ) : (
        <>
          <button className="btn btn-primary" type="submit" form="license-form" disabled={saving}>Save</button>
          <button className="btn btn-outline" type="button" disabled={disabled} onClick={() => void run(`${row.name} renewed`, () => renewDoc(row.id))}>Renew (+12 months)</button>
          <button className="btn btn-outline" type="button" disabled={disabled} onClick={() => void run("Notification sent", () => sendRenewalNotice(row.id))}>Send notification</button>
          <button className="btn btn-outline" type="button" disabled={disabled} onClick={() => void run("Completion recorded", () => completeCycle(row.id))}>Record completion</button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close panel</button>
        </>
      )}
    >
      <div className="summary-chips comm-hero">
        {statusBadge(row.type)}
        {priBadge(row.risk)}
        {statusBadge(docState(row))}
        {statusBadge(row.renewalStatus || "Not Started")}
        {flagBadge(!!row.isOverdue, "Overdue", "On Track")}
        {flagBadge(!!row.isEscalated, "Escalated", "Not Escalated")}
        {flagBadge(row.active !== false, "Active", "Inactive")}
      </div>
      <form
        id="license-form"
        className="mdf"
        onSubmit={save}
        key={`${row.recordId || row.id}-${row.renewalStatus}-${row.done || ""}-${row.partyId || ""}-${row.buId || ""}-${row.currentDocumentName || ""}`}
      >
        <div className="mdf-sec">Identity</div>
        <Field label="Document number">
          <input name="documentNumber" defaultValue={row.documentNumber || row.id} maxLength={100} disabled={disabled} />
        </Field>
        <Field label="Document type" required>
          <select name="type" defaultValue={row.type} disabled={disabled}>
            <option>License</option><option>Contract</option><option>Permit</option>
          </select>
        </Field>
        <Field label="License and contract" required wide>
          <input name="name" required defaultValue={row.name} maxLength={850} disabled={disabled} />
        </Field>
        <Field label="Active" required>
          <select name="active" defaultValue={row.active === false ? "false" : "true"} disabled={disabled}>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </Field>
        <Field label="Owner">
          <div className="lookup">{row.owner || "—"}</div>
        </Field>
        <Field label="Record ID">
          <input readOnly value={row.recordId || row.id} />
        </Field>

        <div className="mdf-sec">Party</div>
        <Field label="External party">
          <select name="partyId" defaultValue={row.partyId || ""} disabled={disabled}>
            <option value="">None</option>
            {db.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Issuing authority">
          <select name="authId" defaultValue={row.issuingAuthorityId || (row.auth ? "__label__" : "")} disabled={disabled}>
            <option value="">None</option>
            {row.auth && !row.issuingAuthorityId ? <option value="__label__">{row.auth}</option> : null}
            {db.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>

        <div className="mdf-sec">Dates and risk</div>
        <Field label="Issue date">
          <input name="issue" type="date" defaultValue={row.issue} disabled={disabled} />
        </Field>
        <Field label="Expiry date" required>
          <input name="expiry" type="date" required defaultValue={row.expiry} disabled={disabled} />
        </Field>
        <Field label="Days remaining" hint="Calculated from expiry. Days to expiry is the Dataverse formula column.">
          <input readOnly value={String(left)} />
        </Field>
        <Field label="Risk level" hint="Calculated from days remaining unless the cycle is closed.">
          <div className="readonly-val">{priBadge(row.risk)}</div>
        </Field>
        <Field label="Reminder threshold (days)">
          <input name="threshold" type="number" min={1} defaultValue={row.reminderThreshold || DEFAULT_REMINDER_THRESHOLD} disabled={disabled} />
        </Field>
        <Field label="Reminder sent">
          {flagBadge(!!row.reminderSent, "Yes", "No")}
        </Field>
        <Field label="Last notified">
          <input readOnly value={row.notified ? formatDateTime(row.notified) : ""} placeholder="—" />
        </Field>
        <Field label="Is overdue">
          {flagBadge(!!row.isOverdue, "Overdue", "On Track")}
        </Field>

        <div className="mdf-sec">Renewal</div>
        <Field label="Renewal status" required>
          <select name="renewalStatus" defaultValue={row.renewalStatus || "Not Started"} disabled={disabled}>
            {LICENSE_RENEWAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Renewal SLA date" hint="Formula column — read only">
          <input readOnly value={row.renewalSlaDate ? formatDateTime(row.renewalSlaDate) : ""} placeholder="—" />
        </Field>
        <Field label="Renewal completed">
          <input readOnly value={row.done || ""} placeholder="—" />
        </Field>
        <Field label="Current renewal">
          <div className="readonly-val">{row.currentRenewalName || row.currentRenewalId || "—"}</div>
        </Field>
        <Field label="Renewal notes" wide>
          <input name="renewalNotes" defaultValue={row.renewalNotes || ""} maxLength={100} disabled={disabled} />
        </Field>

        <div className="mdf-sec">Escalation</div>
        <Field label="Is escalated">
          {flagBadge(!!row.isEscalated, "Yes", "No")}
        </Field>
        <Field label="Escalated by">
          <div className="lookup">{row.escalatedBy || "—"}</div>
        </Field>
        <Field label="Escalation reason" wide>
          {row.isEscalated ? (
            <input readOnly value={row.escalationReason || ""} />
          ) : (
            <input value={escReason} onChange={(e) => setEscReason(e.target.value)} maxLength={100} disabled={disabled} placeholder="Required to escalate" />
          )}
        </Field>
        {!locked && !row.isEscalated ? (
          <Field label=" " wide>
            <button
              className="btn btn-outline"
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!escReason.trim()) {
                  onSaved("Escalation reason is required");
                  return;
                }
                void run(`${row.id} escalated`, () => escalateLicense(row.id, escReason.trim(), ME));
              }}
            >
              Escalate
            </button>
          </Field>
        ) : null}

        <div className="mdf-sec">Current document</div>
        <Field label="Document URL" hint="Max 100 characters">
          {locked ? (
            row.documentUrl ? <a href={row.documentUrl} target="_blank" rel="noreferrer">{row.documentUrl}</a> : <div className="readonly-val">—</div>
          ) : (
            <input name="documentUrl" defaultValue={row.documentUrl || ""} maxLength={100} disabled={disabled} />
          )}
        </Field>
        <Field label="Current document file" hint="Stored on the Dataverse file column. Upload after the record exists.">
          <div className="deeplink-row">
            <div className="readonly-val">{row.currentDocumentName || "No file"}</div>
            {row.currentDocumentName ? (
              <button className="btn btn-outline" type="button" disabled={saving} onClick={() => void onDownload()}>Download</button>
            ) : null}
          </div>
          {!locked ? <input type="file" disabled={disabled} onChange={(e) => void onUpload(e.target.files?.[0])} /> : null}
        </Field>
        <Field label="Document Archive" wide hint="A copy stored on erc_documentarchive, separate from the current file column.">
          {relatedArchives.length ? (
            <ul className="tl">
              {relatedArchives.map((file) => (
                <li key={file.recordId || file.id}>
                  <b>{file.name}</b>
                  <span>
                    {file.uploadedOn ? formatDateTime(file.uploadedOn) : ""}
                    {file.fileName ? (
                      <>
                        {" · "}
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => void downloadArchiveFile(file.id).then((f) => downloadBytes(f.bytes, f.name || file.name, mimeFromFileName(f.name || file.name))).catch((err) => onSaved(err instanceof Error ? err.message : "Download failed"))}
                        >
                          Download
                        </button>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <div className="readonly-val">No archived copies</div>}
          <button className="btn btn-outline" type="button" disabled={disabled} onClick={() => setArchiveOpen(true)}>Save copy to archive</button>
        </Field>

        <div className="mdf-sec">Organization</div>
        <Field label="Business unit">
          <select name="bu" value={buId} onChange={(e) => setBuId(e.target.value)} disabled={disabled}>
            <option value="">—</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select name="deptId" defaultValue={row.departmentId || (row.department ? "__label__" : "")} disabled={disabled}>
            <option value="">—</option>
            {row.department && !row.departmentId ? <option value="__label__">{row.department}</option> : null}
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </form>
      {locked ? <div className="note"><b>This renewal cycle is closed and read only.</b> Completion recorded {row.done}.</div> : (
        <div className="note">Risk is calculated from days remaining. <b>Renew</b> extends expiry by twelve months and closes the open renewal task. Formula columns (days to expiry, renewal SLA date) are not written by this app.</div>
      )}
      {archiveOpen ? (
        <ArchiveUploadForm
          busy={saving}
          defaultLicenseId={row.recordId || row.id}
          defaultType="License document"
          onClose={() => setArchiveOpen(false)}
          onSaved={(msg) => { setArchiveOpen(false); onSaved(msg); }}
          onFail={onSaved}
        />
      ) : null}
      {relatedRenewals.length ? <RenewalTaskTable rows={relatedRenewals} /> : null}
      {relatedNotices.length ? (
        <>
          <h2 className="sec">Notifications ({relatedNotices.length})</h2>
          <DataTable
            cols={["Sent", "Type", "Title", "Result"]}
            rows={relatedNotices.map((n) => ({
              key: n.recordId || n.id,
              cells: [
                <span className="mono" key="s">{formatDateTime(n.sentOn)}</span>,
                statusBadge(n.type),
                n.title,
                flagBadge(n.result === "Sent", "Sent", "Failed"),
              ],
            }))}
          />
        </>
      ) : null}
    </Overlay>
  );
}

