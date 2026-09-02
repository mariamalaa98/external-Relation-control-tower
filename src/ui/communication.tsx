import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  CATS,
  type Communication,
  type EmailAttachment,
  type ThreadEmail,
} from "../data/types";
import {
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
  onCloseRec,
  onReopen,
  onEscalate,
  onSaved,
}: {
  row: Communication;
  busy: boolean;
  onClose: () => void;
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
  const partyFromTable = hasParty;
  const catFromTable = hasParty || row.categoryAssigned;
  const subjectFromTable = !!(row.emailSubject || row.subj);
  const descFromTable = !!row.description?.trim();
  const slaFromTable = !!row.slaId;

  useEffect(() => {
    setThreadBusy(true);
    void loadCommThread(row).finally(() => setThreadBusy(false));
  }, [row.id, row.recordId]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const partyId = partyFromTable ? (row.partyId || "") : String(f.get("partyId") || "");
    const party = db.parties.find((p) => p.id === partyId);
    const slaId = slaFromTable ? (row.slaId || "") : String(f.get("sla") || row.slaId || "");
    setBusy(true);
    try {
      await saveComm(row.id, {
        description: descFromTable ? (row.description || "") : String(f.get("description") || ""),
        partyId,
        party: partyFromTable ? (row.party || "") : (party?.name || ""),
        slaId,
        slaName: slaFromTable ? row.slaName : (db.sla.find((s) => s.id === slaId)?.name || row.slaName),
        cat: partyId || catFromTable ? row.cat : (String(f.get("cat") || row.cat) as Communication["cat"]),
      });
      onSaved("Communication saved");
    } finally {
      setBusy(false);
    }
  }

  async function chooseParty(partyId: string) {
    if (locked || saving || partyFromTable) return;
    const party = db.parties.find((p) => p.id === partyId);
    setBusy(true);
    try {
      await saveComm(row.id, {
        partyId,
        party: party?.name || "",
      });
      onSaved(party ? `External party: ${party.name}` : "External party cleared");
    } finally {
      setBusy(false);
    }
  }

  async function chooseCategory(cat: string) {
    if (locked || saving || catFromTable) return;
    setBusy(true);
    try {
      await saveComm(row.id, {
        partyId: "",
        party: "",
        cat: cat as Communication["cat"],
      });
      onSaved(cat ? `Category: ${cat}` : "Category cleared");
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
          <button className="btn btn-primary" type="submit" form="comm-form" disabled={saving}>Save</button>
          <button className="btn btn-outline" type="button" disabled={busy || !canManualEscalate(row)} onClick={onEscalate}>
            {canManualEscalate(row) ? "Escalate" : "Already escalated"}
          </button>
          <button className="btn btn-outline" type="button" disabled={busy} onClick={onCloseRec}>Close</button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Close panel</button>
        </>
      )}
    >
      <div className="summary-chips comm-hero">
            {row.categoryAssigned ? catBadge(row.cat) : <span className="badge b-gray">Unassigned</span>}
        {priBadge(row.pri)}
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
          <form id="comm-form" className="mdf" onSubmit={save} key={`${row.id}-${row.partyId || ""}-${row.party}-${row.cat}-${row.categoryAssigned}-${row.isEscalated}-${row.status}-${row.closed || ""}`}>
            <div className="mdf-sec">Identity</div>
            <Field label="Owner">
              <div className="lookup">{row.owner || "—"}</div>
            </Field>
            <Field label="External Party">
              {partyFromTable ? (
                <div className="readonly-val">{partyLabel}</div>
              ) : (
                <select
                  name="partyId"
                  defaultValue=""
                  disabled={locked || saving}
                  onChange={(e) => void chooseParty(e.target.value)}
                >
                  <option value="">None — not related to an external party</option>
                  {db.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Communication Type">
              <div className="readonly-val">{row.type || "—"}</div>
            </Field>
            <Field label="Lifecycle Status">
              <div className="readonly-val">{statusBadge(row.status)}</div>
            </Field>
            <Field label="Email Subject" wide>
              {subjectFromTable ? (
                <input readOnly value={row.emailSubject || row.subj} />
              ) : (
                <input name="emailSubject" defaultValue="" disabled={locked} />
              )}
            </Field>
            <Field label="Description" wide>
              {descFromTable ? (
                <textarea readOnly rows={3} value={row.description || ""} />
              ) : (
                <textarea name="description" rows={3} defaultValue="" disabled={locked} />
              )}
            </Field>

            <div className="mdf-sec">Classification</div>
            <Field label="Category">
              {catFromTable ? (
                <div className="readonly-val">{row.cat || "—"}</div>
              ) : (
                <select
                  name="cat"
                  defaultValue=""
                  disabled={locked || saving}
                  onChange={(e) => void chooseCategory(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {CATS.map((c) => <option key={c}>{c}</option>)}
                </select>
              )}
            </Field>
            <Field label="Priority">
              <div className="readonly-val">{row.pri || "—"}</div>
            </Field>
            <Field label="Business Unit">
              <div className="readonly-val">{row.bu || "—"}</div>
            </Field>
            <Field label="SLA">
              {slaFromTable ? (
                <div className="readonly-val">{row.slaName || "—"}</div>
              ) : (
                <select name="sla" defaultValue="" disabled={locked}>
                  <option value="">—</option>
                  {db.sla.filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
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
            {row.log?.map((e, i) => (
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

export function CloseCommForm({
  row,
  busy,
  onCancel,
  onSubmit,
}: {
  row: Communication;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (comment: string) => void;
}) {
  const emails = threadEmails(row);
  const [threadBusy, setThreadBusy] = useState(false);

  useEffect(() => {
    setThreadBusy(true);
    void loadCommThread(row).finally(() => setThreadBusy(false));
  }, [row.id, row.recordId]);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const cmt = String(new FormData(e.currentTarget).get("cmt") || "").trim();
      if (!cmt) return;
      onSubmit(cmt);
    }}>
      <div className="form">
        <div><label>Outcome</label><select><option>Responded and accepted</option><option>Responded — no reply required</option><option>Withdrawn by external party</option></select></div>
        <div className="wide"><label>Closure comment *</label><textarea name="cmt" rows={3} required placeholder="How was the request satisfied?" /></div>
      </div>
      <h2 className="sec">Email evidence ({emails.length})</h2>
      <EmailThreadPanel emails={emails} loading={threadBusy} className="standalone" />
      <div className="note">Closing sets <b>Lifecycle Status = Closed</b>. The <b>Capture closed date and person</b> flow stamps Closed By and Closure Date/Time.</div>
      <div className="df" style={{ margin: "16px -20px -20px" }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>Close Record</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function EmailThreadPanel({
  emails,
  loading,
  className,
}: {
  emails: ThreadEmail[];
  loading: boolean;
  className?: string;
}) {
  if (loading && !emails.length) {
    return <div className="note">Loading emails from the Emails table…</div>;
  }
  if (!emails.length) {
    return (
      <div className="note">No emails linked yet. Replies appear here when Server-Side Sync writes them to the Emails table (same Regarding record or conversation index).</div>
    );
  }
  return (
    <div className={["email-thread", className].filter(Boolean).join(" ")}>
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
  comms,
  onOpen,
  onRunAuto,
  onEscalate,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  comms: Communication[];
  onOpen: (row: Communication) => void;
  onRunAuto: () => void;
  onEscalate: (row: Communication) => void;
}) {
  const db = useStore();
  const overdueOpen = comms.filter((c) => c.status !== "Closed" && c.isOverdue && !c.isEscalated);
  const auto = comms.filter((c) => c.isAutomaticallyEscalated);
  const manual = comms.filter((c) => c.isManuallyEscalated);
  const rows = comms.filter((c) => {
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
                <td>{r.owner || "—"}</td>
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
