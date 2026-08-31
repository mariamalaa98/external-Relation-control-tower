import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  COMM_STATUSES,
  CATS,
  type Communication,
  type EmailAttachment,
  type ThreadEmail,
} from "../data/types";
import {
  ME,
  canManualEscalate,
  commLocked,
  formatDateTime,
  loadCommThread,
  loadEmailAttachmentFile,
  overdueLabel,
  saveComm,
  threadEmails,
  useStore,
  yesNo,
} from "../data/store";
import {
  bytesToObjectUrl,
  decodeText,
  downloadBytes,
  formatBytes,
  previewKind,
} from "../data/emailAttachments";
import { Overlay, FilterField, catBadge, flagBadge, priBadge, statusBadge } from "./widgets";

export function CommRecordForm({
  row,
  busy,
  onClose,
  onRespond,
  onCloseRec,
  onReopen,
  onEscalate,
  onSaved,
}: {
  row: Communication;
  busy: boolean;
  onClose: () => void;
  onRespond: () => void;
  onCloseRec: () => void;
  onReopen: () => void;
  onEscalate: () => void;
  onSaved: (msg: string) => void;
}) {
  const db = useStore();
  const emails = threadEmails(row);
  const locked = commLocked(row);
  const [saving, setBusy] = useState(false);
  const [tab, setTab] = useState<"general" | "email">("general");
  const [threadBusy, setThreadBusy] = useState(false);
  const hasParty = !!row.partyId;
  const partyLabel = row.party || (hasParty ? "Linked party" : "None");

  useEffect(() => {
    setThreadBusy(true);
    void loadCommThread(row).finally(() => setThreadBusy(false));
  }, [row.id, row.recordId]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const partyId = String(f.get("partyId") || "");
    const party = db.parties.find((p) => p.id === partyId);
    setBusy(true);
    try {
      await saveComm(row.id, {
        type: String(f.get("type")) as Communication["type"],
        description: String(f.get("description") || ""),
        emailSubject: String(f.get("emailSubject") || row.emailSubject || row.subj),
        subj: String(f.get("emailSubject") || row.subj),
        partyId,
        party: party?.name || "",
        status: String(f.get("status") || row.status) as Communication["status"],
        slaId: String(f.get("sla") || row.slaId || ""),
        slaName: db.sla.find((s) => s.id === String(f.get("sla")))?.name || row.slaName,
        pri: partyId ? row.pri : "None",
        cat: partyId ? row.cat : (String(f.get("cat") || row.cat) as Communication["cat"]),
      });
      onSaved("Communication saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay
      kind="drawer"
      title={row.emailSubject || row.subj}
      sub={`${row.id} · ${partyLabel}`}
      onClose={onClose}
      footer={locked ? (
        <>
          <button className="btn btn-outline" type="button" disabled={busy} onClick={onReopen}>Reopen Record</button>
          <span className="closed-note">Closed {formatDateTime(row.closed)} · read only</span>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close panel</button>
        </>
      ) : (
        <>
          <button className="btn btn-outline" type="button" disabled={busy || !canManualEscalate(row)} onClick={onEscalate}>
            {canManualEscalate(row) ? "Escalate" : "Already escalated"}
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={onCloseRec}>Close</button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close panel</button>
        </>
      )}
    >
      <div className="cmdbar">
        <button className="cmd" type="submit" form="comm-form" disabled={locked || saving}>Save</button>
        <button className="cmd" type="button" disabled={locked || busy || !canManualEscalate(row)} onClick={onEscalate}>
          {canManualEscalate(row) ? "Escalate" : "Already escalated"}
        </button>
        <button className="cmd" type="button" disabled={locked || busy} onClick={onCloseRec}>Close</button>
        <button className="cmd" type="button" disabled={locked || busy} onClick={onRespond}>Respond</button>
      </div>
      <div className="summary-chips comm-hero">
            {hasParty ? catBadge(row.cat) : (row.categoryAssigned ? catBadge(row.cat) : <span className="badge b-gray">No party</span>)}
        {priBadge(hasParty ? row.pri : "None")}
        {statusBadge(row.status)}
        {flagBadge(row.isOverdue, "Overdue", "On Track")}
        {flagBadge(row.isEscalated, "Escalated", "Not Escalated")}
      </div>
      <div className="tabs">
        <button className={tab === "general" ? "on" : ""} type="button" onClick={() => setTab("general")}>General</button>
        <button className={tab === "email" ? "on" : ""} type="button" onClick={() => setTab("email")}>
          Email thread{emails.length ? ` (${emails.length})` : ""}
        </button>
      </div>
      {tab === "email" ? (
        <EmailThreadPanel emails={emails} loading={threadBusy} />
      ) : null}
      <div hidden={tab !== "general"}>
          <form id="comm-form" className="mdf" onSubmit={save} key={`${row.id}-${row.partyId || ""}-${row.party}-${row.isEscalated}-${row.status}-${row.closed || ""}`}>
            <div className="mdf-sec">Identity</div>
            <Field label="Owner">
              <div className="lookup">{row.owner || ME} <span className="avail">Available</span></div>
            </Field>
            <Field label="External Party">
              <select name="partyId" defaultValue={row.partyId || ""} disabled={locked}>
                <option value="">None — not related to an external party</option>
                {db.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {row.partyId && !db.parties.some((p) => p.id === row.partyId) ? (
                  <option value={row.partyId}>{row.party || "Linked party"}</option>
                ) : null}
              </select>
            </Field>
            <Field label="Communication Type">
              <select name="type" defaultValue={row.type} disabled={locked}>
                <option>Inbound</option>
                <option>Outbound</option>
                <option>Internal follow up</option>
              </select>
            </Field>
            <Field label="Lifecycle Status">
              <select name="status" defaultValue={row.status} disabled={locked}>
                {COMM_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Email Subject" wide>
              <input name="emailSubject" defaultValue={row.emailSubject || row.subj} disabled={locked} />
            </Field>
            <Field label="Description" wide>
              <textarea name="description" rows={3} defaultValue={row.description || ""} disabled={locked} />
            </Field>

            <div className="mdf-sec">Classification</div>
            <Field label="Category">
              {hasParty ? (
                <div className="readonly-val">{row.cat || "—"}</div>
              ) : (
                <select name="cat" defaultValue={row.categoryAssigned ? row.cat : ""} disabled={locked}>
                  <option value="">Unassigned</option>
                  {CATS.map((c) => <option key={c}>{c}</option>)}
                </select>
              )}
            </Field>
            <Field label="Priority">
              <div className="readonly-val">{hasParty ? (row.pri || "—") : "None"}</div>
            </Field>
            <Field label="Business Unit">
              <div className="readonly-val">{hasParty ? (row.bu || "—") : "—"}</div>
            </Field>
            <Field label="SLA">
              <select name="sla" defaultValue={row.slaId || ""} disabled={locked}>
                <option value="">—</option>
                {db.sla.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Due Date">
              <input readOnly value={formatDateTime(row.due)} />
            </Field>
            <Field label="Is Over Due">
              {flagBadge(row.isOverdue, overdueLabel(true), overdueLabel(false))}
            </Field>

            <div className="mdf-sec">Escalation</div>
            <Field label="Is Escalated" required>
              {flagBadge(row.isEscalated, "Escalated", "Not Escalated")}
              {row.isEscalated ? <div className="hint">Locked — escalate can run only once.</div> : null}
            </Field>
            <Field label="Is Automatically Escalated">
              <div className="readonly-val">{yesNo(row.isAutomaticallyEscalated)}</div>
            </Field>
            <Field label="Escalated By">
              <div className="lookup">{row.escalatedBy || "—"}</div>
            </Field>
            <Field label="Escalation Reason" wide>
              <input readOnly value={row.escalationReason || ""} placeholder="—" />
            </Field>

            <div className="mdf-sec">Closure</div>
            <Field label="Closed By">
              <div className="lookup muted-val">{row.closedBy || "—"}</div>
            </Field>
            <Field label="Closure Date/Time">
              <input readOnly value={row.closed ? formatDateTime(row.closed) : ""} placeholder="—" />
            </Field>
            <Field label="Closure Comment" wide>
              <textarea readOnly rows={2} value={row.closureComment || ""} placeholder="Entered when you escalate or close" />
            </Field>
          </form>
          <h2 className="sec">Timeline</h2>
          <ul className="tl">
            {row.log.map((e, i) => (
              <li key={i}><b>{e.title}</b><span>{e.meta}</span></li>
            ))}
          </ul>
          {locked ? (
            <div className="note"><b>This record is closed and read only.</b> Closed on {formatDateTime(row.closed)} by {row.closedBy || "flow"}.</div>
          ) : null}
        </div>
    </Overlay>
  );
}

function EmailThreadPanel({ emails, loading }: { emails: ThreadEmail[]; loading: boolean }) {
  if (loading && !emails.length) {
    return <div className="note">Loading emails from the Emails table…</div>;
  }
  if (!emails.length) {
    return (
      <div className="tabbody">
        <div className="note">No emails linked yet. Replies appear here when Server-Side Sync writes them to the Emails table (same Regarding record or conversation index).</div>
      </div>
    );
  }
  return (
    <div className="email-thread">
      {emails.map((mail) => (
        <article className={`email-card ${mail.direction === "Outbound" ? "out" : "in"}`} key={mail.id}>
          <header className="email-card-head">
            <span className={`email-dir ${mail.direction === "Outbound" ? "out" : "in"}`}>
              {mail.direction === "Outbound" ? "Sent" : "Received"}
              {mail.isReply ? " · Reply" : ""}
            </span>
            <span className="email-when">{formatDateTime(mail.sentOn)}</span>
          </header>
          <h3 className="email-subject">{mail.subject || "(no subject)"}</h3>
          <dl className="email-meta">
            <div><dt>From</dt><dd>{mail.from || "—"}</dd></div>
            <div><dt>To</dt><dd>{mail.to || "—"}</dd></div>
          </dl>
          {mail.body ? <div className="email-body">{mail.body}</div> : <p className="email-empty">No body text on this email.</p>}
          {mail.quoted ? <blockquote className="email-quote">{mail.quoted}</blockquote> : null}
          <EmailAttachmentList items={mail.attachments || []} expectedCount={mail.attachmentCount} />
        </article>
      ))}
    </div>
  );
}

function EmailAttachmentList({ items, expectedCount }: { items: EmailAttachment[]; expectedCount: number }) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!items.length && !expectedCount) return null;

  async function loadFile(att: EmailAttachment) {
    setBusyId(att.id);
    setError("");
    try {
      return await loadEmailAttachmentFile(att);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this attachment");
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function openAttachment(att: EmailAttachment) {
    const kind = previewKind(att);
    if (previewId === att.id && (previewUrl || previewText)) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewId(null);
      setPreviewUrl("");
      setPreviewText("");
      return;
    }
    const file = await loadFile(att);
    if (!file) return;
    if (kind === "download") {
      downloadBytes(file.bytes, file.name, file.mimeType);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (kind === "text") {
      setPreviewText(decodeText(file.bytes) || "(empty file)");
      setPreviewUrl("");
    } else {
      setPreviewText("");
      setPreviewUrl(bytesToObjectUrl(file.bytes, file.mimeType));
    }
    setPreviewId(att.id);
  }

  async function downloadAttachment(att: EmailAttachment) {
    const file = await loadFile(att);
    if (!file) return;
    downloadBytes(file.bytes, file.name, file.mimeType);
  }

  return (
    <div className="email-atts">
      <div className="email-att-head">
        📎 {items.length || expectedCount} attachment{(items.length || expectedCount) === 1 ? "" : "s"}
      </div>
      {items.length ? (
        <ul className="email-att-list">
          {items.map((att) => {
            const kind = previewKind(att);
            const open = previewId === att.id;
            const busy = busyId === att.id;
            return (
              <li key={att.id} className="email-att-row">
                <div className="email-att-info">
                  <button className="email-att-name" type="button" onClick={() => void openAttachment(att)} disabled={busy}>
                    {att.name}
                  </button>
                  <span className="email-att-meta">
                    {[formatBytes(att.size), att.inline ? "inline" : "", kind === "download" ? "download to open" : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="email-att-actions">
                  <button className="btn btn-outline btn-mini" type="button" disabled={busy} onClick={() => void openAttachment(att)}>
                    {busy && open ? "Opening…" : kind === "download" ? "Open" : open ? "Hide" : "View"}
                  </button>
                  <button className="btn btn-outline btn-mini" type="button" disabled={busy} onClick={() => void downloadAttachment(att)}>
                    {busy && !open ? "Downloading…" : "Download"}
                  </button>
                </div>
                {open ? (
                  <div className="email-att-preview">
                    {kind === "image" && previewUrl ? <img src={previewUrl} alt={att.name} /> : null}
                    {kind === "pdf" && previewUrl ? <iframe title={att.name} src={previewUrl} /> : null}
                    {kind === "text" ? <pre>{previewText}</pre> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="email-empty">This email has attachments, but the files could not be loaded from Dataverse.</p>
      )}
      {error ? <p className="email-att-error">{error}</p> : null}
    </div>
  );
}

function Field({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`mdf-field${wide ? " wide" : ""}`}>
      <label>{label}{required ? <span className="req"> *</span> : null}</label>
      {children}
    </div>
  );
}

export function EscalationCenter({
  q,
  setQ,
  busy,
  onOpen,
  onRunAuto,
  onEscalate,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  onOpen: (row: Communication) => void;
  onRunAuto: () => void;
  onEscalate: (row: Communication) => void;
}) {
  const db = useStore();
  const overdueOpen = db.comms.filter((c) => c.status !== "Closed" && c.isOverdue && !c.isEscalated);
  const auto = db.comms.filter((c) => c.isAutomaticallyEscalated);
  const manual = db.comms.filter((c) => c.isManuallyEscalated);
  const rows = db.comms.filter((c) => {
    const blob = `${c.id} ${c.party} ${c.subj} ${c.owner}`.toLowerCase();
    return blob.includes(q.toLowerCase()) && (c.isOverdue || c.isEscalated);
  });
  return (
    <>
      <div className="callout">
        <b>Automatic Communication Escalations</b> runs every 10 minutes for records where the <b>Is OverDue</b> formula column is true, Is Escalated is not true, and Lifecycle is not Closed.
        <b>Communications Manual Escalation</b> runs when you set Is Manually Escalated. Both write Is Escalated so a record is never emailed twice.
      </div>
      <div className="kpis">
        <div className="kpi" style={{ ["--acc" as string]: "var(--bad)" }}>
          <div className="l">Pending auto</div>
          <div className="v">{overdueOpen.length}</div>
          <div className="d">Overdue, not escalated, not closed</div>
        </div>
        <div className="kpi" style={{ ["--acc" as string]: "var(--warn)" }}>
          <div className="l">Automatic</div>
          <div className="v">{auto.length}</div>
          <div className="d">Is Automatically Escalated = Yes</div>
        </div>
        <div className="kpi" style={{ ["--acc" as string]: "var(--info)" }}>
          <div className="l">Manual</div>
          <div className="v">{manual.length}</div>
          <div className="d">Is Manually Escalated = Yes</div>
        </div>
      </div>
      <div className="filters">
        <FilterField label="Search">
          <input placeholder="Search escalated or overdue communications" value={q} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={onRunAuto}>
          {db.source === "dataverse" ? "Refresh from auto flow" : "Run automatic escalation"}
        </button>
        <span className="fnote">{rows.length} shown</span>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>CommID</th><th>Subject</th><th>Owner</th><th>Due</th><th>Overdue</th><th>Escalated</th><th>Auto</th><th>Manual</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.recordId || r.id} onClick={() => onOpen(r)}>
                <td><span className="link">{r.id}</span></td>
                <td>{r.subj}</td>
                <td>{r.owner}</td>
                <td className="mono">{formatDateTime(r.due)}</td>
                <td>{flagBadge(r.isOverdue, "Overdue", "On Track")}</td>
                <td>{flagBadge(r.isEscalated, "Escalated", "Not Escalated")}</td>
                <td>{yesNo(r.isAutomaticallyEscalated)}</td>
                <td>{yesNo(r.isManuallyEscalated)}</td>
                <td>
                  {canManualEscalate(r) ? (
                    <button className="btn btn-outline btn-mini" type="button" onClick={(e) => { e.stopPropagation(); onEscalate(r); }}>Escalate</button>
                  ) : "Already escalated"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
