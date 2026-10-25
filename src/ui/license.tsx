import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  BUS,
  LICENSE_RENEWAL_STATUSES,
  type License,
  type Notice,
  type Renewal,
} from "../data/types";
import {
  DEFAULT_REMINDER_THRESHOLD,
  ME,
  TODAY,
  addDoc,
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
  sameId,
  saveDoc,
  uploadLicenseFile,
  useStore,
} from "../data/store";
import { noticeDuty, formatAuditStamp } from "../data/auditLogic";
import { downloadBytes, mimeFromFileName } from "../data/emailAttachments";
import { DataTable, FilterField, Kpi, Overlay, PageHead, flagBadge, priBadge, statusBadge } from "./widgets";
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
  const [response, setResponse] = useState("All");
  const withDuty = useMemo(() => db.notices.map((n) => ({ notice: n, duty: noticeDuty(n, db.docs, db.renewals) })), [db.notices, db.docs, db.renewals]);
  const filtered = useMemo(() => withDuty.filter(({ notice: n, duty }) => {
    const hit = `${n.title} ${n.documentName || ""} ${n.message || ""} ${n.owner} ${duty.respondedBy}`.toLowerCase().includes(q.toLowerCase());
    const typeOk = type === "All" || n.type === type;
    const readOk = read === "All" || (read === "Unread" ? !n.isRead : n.isRead);
    const responseOk = response === "All" || (response === "Responded" ? duty.responded : !duty.responded);
    return hit && typeOk && readOk && responseOk;
  }), [withDuty, q, type, read, response]);
  const unanswered = withDuty.filter((row) => !row.duty.responded).length;

  function openRelated(n: Notice) {
    const doc = db.docs.find((d) => d.recordId === n.documentId || d.id === n.documentId);
    if (doc) onOpenDoc(doc);
  }

  return (
    <>
      <div className="callout">
        <b>Notification log</b> records reminder, expiry, and escalation events. <b>Responded by</b> and <b>Responded on</b> show who acted and when. If there is no response, the <b>responsible person</b> stays accountable.
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
        <FilterField label="Response">
          <select value={response} onChange={(e) => setResponse(e.target.value)}>
            <option>All</option>
            <option>No response</option>
            <option>Responded</option>
          </select>
        </FilterField>
        <span className="fnote">{filtered.length} shown · {unanswered} with no response</span>
      </div>
      <DataTable
        cols={["Sent", "Type", "Title", "Document", "Responsible", "Responded by", "Responded on", "Accountability", ""]}
        rows={filtered.map(({ notice: n, duty }) => ({
          key: n.recordId || n.id,
          onClick: () => openRelated(n),
          cells: [
            <span className="mono" key="s">{formatDateTime(n.sentOn)}</span>,
            statusBadge(n.type),
            <>{n.isRead ? n.title : <b>{n.title}</b>}</>,
            n.documentName || "—",
            duty.responded ? (duty.responsible || "—") : <span className="accountable" key="who">{duty.responsible || "Unassigned"}</span>,
            duty.respondedBy || "—",
            duty.respondedAt ? <span className="mono" key="at">{formatAuditStamp(duty.respondedAt) || formatDateTime(duty.respondedAt)}</span> : "—",
            <span key="duty" className={`badge ${duty.responded ? "b-ok" : "b-bad"}`}>{duty.responded ? "Responded" : "No response"}</span>,
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

const RISK_ROWS = ["Critical", "High", "Medium", "Low"] as const;
const RISK_BANDS = [
  { id: 0, label: "Under 30 days", detail: "Expired or due soon", tone: "bad" },
  { id: 1, label: "30 – 90 days", detail: "Inside the 90-day window", tone: "warn" },
  { id: 2, label: "Over 90 days", detail: "Further out", tone: "ok" },
] as const;

function expiryBand(days: number) {
  if (days < 30) return 0;
  if (days <= 90) return 1;
  return 2;
}

function daysLabel(days: number) {
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export function RiskMatrix({
  docs,
  q,
  setQ,
  onOpen,
}: {
  docs: License[];
  q: string;
  setQ: (v: string) => void;
  onOpen: (row: License) => void;
}) {
  const placed = useMemo(() => docs.map((doc) => {
    const days = doc.daysRemaining ?? daysBetween(TODAY, doc.expiry);
    return { doc, days, band: Number.isFinite(days) ? expiryBand(days) : -1 };
  }).filter((row) => row.band >= 0), [docs]);

  const filtered = useMemo(() => placed.filter(({ doc }) => matchesSearch(
    q,
    doc.documentNumber,
    doc.name,
    doc.party,
    doc.owner,
    doc.type,
    doc.expiry,
    doc.risk,
  )), [placed, q]);

  const missing = docs.length - placed.length;

  return (
    <>
      <PageHead title="Risk Matrix" sub={`${filtered.length} documents by risk and time to expiry`} />
      <div className="kpis">
        {RISK_BANDS.map((band) => (
          <Kpi
            key={band.id}
            acc={band.tone === "bad" ? "var(--bad)" : band.tone === "warn" ? "var(--warn)" : "var(--ok)"}
            label={band.label}
            value={filtered.filter((row) => row.band === band.id).length}
            detail={band.detail}
          />
        ))}
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input
            type="search"
            placeholder="Search name, party, owner"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
        </FilterField>
        <span className="fnote">{filtered.length} shown{missing ? ` · ${missing} without an expiry date` : ""}</span>
      </div>
      <div className="risk-matrix">
        <div className="risk-head">
          <div className="risk-corner" />
          {RISK_BANDS.map((band) => (
            <div className={`risk-colhead ${band.tone}`} key={band.id}>
              <div className="l">{band.label}</div>
              <div className="n">{filtered.filter((row) => row.band === band.id).length}</div>
            </div>
          ))}
        </div>
        {RISK_ROWS.map((risk) => (
          <div className="risk-row" key={risk}>
            <div className={`risk-rowhead risk-${risk.toLowerCase()}`}>{risk}</div>
            {RISK_BANDS.map((band) => {
              const list = filtered
                .filter((row) => row.doc.risk === risk && row.band === band.id)
                .sort((a, b) => a.days - b.days);
              return (
                <div className={`risk-cell${list.length ? "" : " empty"}`} key={band.id}>
                  {list.length ? list.map(({ doc, days }) => (
                    <button
                      className="risk-card"
                      type="button"
                      key={doc.recordId || doc.id}
                      onClick={() => onOpen(doc)}
                    >
                      <div className="nm">{doc.name}</div>
                      <div className="meta">
                        {statusBadge(doc.type)}
                        <span>{doc.party || "No external party"}</span>
                      </div>
                      <div className="meta">
                        <span className="mono">{doc.expiry}</span>
                        <b>{daysLabel(days)}</b>
                      </div>
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

function hasEntered(value?: string) {
  const text = String(value || "").trim();
  return text.length > 0 && text !== "—" && text !== "-";
}

function formatDateOnly(value?: string) {
  if (!value) return "";
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US");
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
  onOpen,
}: {
  rows: License[];
  q: string;
  setQ: (v: string) => void;
  onOpen: (row: License) => void;
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
            placeholder="Search number, name, party"
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
        cols={["Number", "Type", "Document", "External party", "Issue", "Expiry", "Days", "Risk", "Renewal", "Reminder", "Overdue", "Escalated", "Owner", "BU", "Department"]}
        rows={filtered.map((r) => ({
          key: r.recordId || r.id,
          onClick: () => onOpen(r),
          cells: [
            <span className="link" key="id">{r.documentNumber || r.id}</span>,
            statusBadge(r.type),
            r.name,
            r.party || "—",
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
        auth: "",
        issue: String(f.get("issue") || ""),
        expiry: String(f.get("expiry") || ""),
        risk: "Medium",
        reminderThreshold: Number(f.get("threshold")) || DEFAULT_REMINDER_THRESHOLD,
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

        <div className="mdf-sec">Dates and reminder</div>
        <Field label="Issue date" hint="The date printed on the license or contract. This is not the day the record is created.">
          <input name="issue" type="date" defaultValue={TODAY} />
        </Field>
        <Field label="Expiry date" required>
          <input name="expiry" type="date" required />
        </Field>
        <Field label="Reminder threshold (days)" hint={`Default ${DEFAULT_REMINDER_THRESHOLD}. A renewal task is created when days remaining reach this value.`}>
          <input name="threshold" type="number" min={1} defaultValue={DEFAULT_REMINDER_THRESHOLD} />
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
      {error ? <div className="note">{error}</div> : <div className="note">Days remaining, risk, and renewal status are calculated from the expiry date. Renewal status starts as Not Started, becomes In Progress inside the reminder window, and Expired after the expiry date.</div>}
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

  const numberEntered = hasEntered(row.documentNumber) || hasEntered(row.id);
  const nameEntered = hasEntered(row.name);
  const typeEntered = hasEntered(row.type);
  const partyEntered = hasEntered(row.party) || hasEntered(row.partyId);
  const issueEntered = hasEntered(row.issue);
  const expiryEntered = hasEntered(row.expiry);
  const thresholdEntered = Number(row.reminderThreshold) > 0;
  const urlEntered = hasEntered(row.documentUrl);
  const fileEntered = hasEntered(row.currentDocumentName);
  const buEntered = hasEntered(row.bu) || hasEntered(row.buId);
  const deptEntered = hasEntered(row.department) || hasEntered(row.departmentId);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked) return;
    const f = new FormData(e.currentTarget);
    const patch: Partial<License> = {};
    if (f.get("name") != null) patch.name = String(f.get("name") || row.name).trim();
    if (f.get("documentNumber") != null) patch.documentNumber = String(f.get("documentNumber") || "").trim() || row.documentNumber;
    if (f.get("type") != null) patch.type = String(f.get("type") || row.type) as License["type"];
    if (f.get("active") != null) patch.active = String(f.get("active")) !== "false";
    if (f.get("partyId") != null) {
      const partyId = String(f.get("partyId") || "");
      const party = db.parties.find((p) => p.id === partyId);
      patch.partyId = partyId;
      patch.party = party?.name || "";
    }
    if (f.get("issue") != null) patch.issue = String(f.get("issue") || row.issue);
    if (f.get("expiry") != null) patch.expiry = String(f.get("expiry") || row.expiry);
    if (f.get("threshold") != null) patch.reminderThreshold = Number(f.get("threshold")) || DEFAULT_REMINDER_THRESHOLD;
    if (f.get("renewalNotes") != null) patch.renewalNotes = String(f.get("renewalNotes") || "").trim();
    if (f.get("documentUrl") != null) patch.documentUrl = String(f.get("documentUrl") || "").trim();
    if (f.get("bu") != null) {
      patch.bu = unitName;
      patch.buId = buId;
    }
    if (f.get("deptId") != null) {
      const deptRaw = String(f.get("deptId") || "");
      const keepDept = deptRaw === "__label__";
      const deptId = keepDept ? (row.departmentId || "") : deptRaw;
      const dept = db.departments.find((d) => d.id === deptId);
      patch.department = keepDept ? (row.department || "") : (dept?.name || "");
      patch.departmentId = keepDept ? row.departmentId : deptId;
    }
    await run("License saved", () => saveDoc(row.id, patch));
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
          {numberEntered ? <input readOnly value={row.documentNumber || row.id} /> : <input name="documentNumber" defaultValue="" maxLength={100} disabled={disabled} />}
        </Field>
        <Field label="Document type" required>
          {typeEntered ? <input readOnly value={row.type} /> : (
            <select name="type" defaultValue={row.type} disabled={disabled}>
              <option>License</option><option>Contract</option><option>Permit</option>
            </select>
          )}
        </Field>
        <Field label="License and contract" required wide>
          {nameEntered ? <input readOnly value={row.name} /> : <input name="name" required defaultValue="" maxLength={850} disabled={disabled} />}
        </Field>
        <Field label="Active" required>
          <input readOnly value={row.active === false ? "False" : "True"} />
        </Field>
        <Field label="Owner">
          <div className="lookup">{row.owner || "—"}</div>
        </Field>

        <div className="mdf-sec">Party</div>
        <Field label="External party">
          {partyEntered ? <input readOnly value={row.party || "—"} /> : (
            <select name="partyId" defaultValue={row.partyId || ""} disabled={disabled}>
              <option value="">None</option>
              {db.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </Field>

        <div className="mdf-sec">Dates and risk</div>
        <Field label="Issue date" hint="The date printed on the license or contract. Created on is the day this record was added, and the system sets that separately.">
          {issueEntered ? <input readOnly value={formatDateOnly(row.issue)} /> : <input name="issue" type="date" defaultValue="" disabled={disabled} />}
        </Field>
        <Field label="Expiry date" required>
          {expiryEntered ? <input readOnly value={formatDateOnly(row.expiry)} /> : <input name="expiry" type="date" required disabled={disabled} />}
        </Field>
        <Field label="Days remaining" hint="Calculated from expiry. Days to expiry is the Dataverse formula column.">
          <input readOnly value={String(left)} />
        </Field>
        <Field label="Risk level" hint="Calculated from days remaining unless the cycle is closed.">
          <div className="readonly-val">{priBadge(row.risk)}</div>
        </Field>
        <Field label="Reminder threshold (days)">
          {thresholdEntered ? <input readOnly value={String(row.reminderThreshold)} /> : <input name="threshold" type="number" min={1} defaultValue={DEFAULT_REMINDER_THRESHOLD} disabled={disabled} />}
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
        <Field label="Renewal status" hint="Set by the system from the expiry date and the reminder window.">
          <div className="readonly-val">{statusBadge(row.renewalStatus || "Not Started")}</div>
        </Field>
        <Field label="Renewal SLA date" hint="Formula column — read only">
          <input readOnly value={row.renewalSlaDate ? formatDateTime(row.renewalSlaDate) : ""} placeholder="—" />
        </Field>
        <Field label="Renewal completed">
          <input readOnly value={row.done || ""} placeholder="—" />
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
          {locked || urlEntered ? (
            row.documentUrl ? <a href={row.documentUrl} target="_blank" rel="noreferrer">{row.documentUrl}</a> : <div className="readonly-val">—</div>
          ) : (
            <input name="documentUrl" defaultValue="" maxLength={100} disabled={disabled} />
          )}
        </Field>
        <Field label="Current document file" hint="Stored on the Dataverse file column. Upload after the record exists.">
          <div className="deeplink-row">
            <div className="readonly-val">{row.currentDocumentName || "No file"}</div>
            {row.currentDocumentName ? (
              <button className="btn btn-outline" type="button" disabled={saving} onClick={() => void onDownload()}>Download</button>
            ) : null}
          </div>
          {!locked && !fileEntered ? <input type="file" disabled={disabled} onChange={(e) => void onUpload(e.target.files?.[0])} /> : null}
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
          {buEntered ? <input readOnly value={row.bu || "—"} /> : (
            <select name="bu" value={buId} onChange={(e) => setBuId(e.target.value)} disabled={disabled}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Department">
          {deptEntered ? <input readOnly value={row.department || "—"} /> : (
            <select name="deptId" defaultValue="" disabled={disabled}>
              <option value="">—</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </Field>
      </form>
      {locked ? <div className="note"><b>This renewal cycle is closed and read only.</b> Completion recorded {row.done}.</div> : (
        <div className="note">Values already saved are locked. Empty fields can still be filled, then use <b>Save</b>. Risk is calculated from days remaining. Formula columns (days to expiry, renewal SLA date) are not written by this app.</div>
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

