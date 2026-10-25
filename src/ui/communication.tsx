import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
} from "../data/store";
import {
  bytesToObjectUrl,
  decodeText,
  downloadBytes,
  formatBytes,
  previewKind,
} from "../data/emailAttachments";
import { Overlay, catBadge, flagBadge, priBadge, statusBadge } from "./widgets";

function emailDescription(emails: ThreadEmail[]) {
  const withText = emails.filter((mail) => (mail.body || mail.quoted || "").trim());
  const inbound = withText.find((mail) => mail.direction === "Inbound");
  const mail = inbound || withText[0];
  return (mail?.body || mail?.quoted || "").trim();
}

function clipDescription(text: string) {
  return text.length <= 2000 ? text : text.slice(0, 2000);
}

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
  const fromEmail = clipDescription(emailDescription(emails));
  const descriptionText = fromEmail || row.description || "";
  const savedBody = useRef("");

  useEffect(() => {
    setThreadBusy(true);
    void loadCommThread(row).finally(() => setThreadBusy(false));
  }, [row.id, row.recordId]);

  useEffect(() => {
    if (!fromEmail || locked || fromEmail === (row.description || "").trim() || savedBody.current === fromEmail) return;
    savedBody.current = fromEmail;
    void saveComm(row.id, { description: fromEmail }).catch(() => { savedBody.current = ""; });
  }, [fromEmail, locked, row.description, row.id]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const partyId = partyFromTable ? (row.partyId || "") : String(f.get("partyId") || "");
    const party = db.parties.find((p) => p.id === partyId);
    setBusy(true);
    try {
      await saveComm(row.id, {
        description: descriptionText,
        partyId,
        party: partyFromTable ? (row.party || "") : (party?.name || ""),
        slaId: row.slaId || "",
        slaName: row.slaName,
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
          {canManualEscalate(row) ? (
            <button className="btn btn-outline" type="button" disabled={busy} onClick={onEscalate}>Escalate to level {(row.escalationStep || 0) + 1}</button>
          ) : null}
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
        {row.isManuallyEscalated ? flagBadge(true, "Manually Escalated", "Not Escalated") : null}
        {row.escalationStep ? <span className="badge b-gold">Level {row.escalationStep}</span> : null}
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
          <form id="comm-form" className="mdf" onSubmit={save} key={`${row.id}-${row.partyId || ""}-${row.party}-${row.cat}-${row.categoryAssigned}-${row.isManuallyEscalated}-${row.status}-${row.closed || ""}`}>
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
              <textarea readOnly rows={8} value={descriptionText || (threadBusy ? "Loading emails" : "")} placeholder="No email body" />
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
            <Field label="Due Date">
              <input readOnly value={formatDateTime(row.due)} />
            </Field>
            <Field label="Is Over Due">
              {flagBadge(row.isOverdue, overdueLabel(true), overdueLabel(false))}
            </Field>

            {row.isEscalated || row.escalationStep ? (
              <>
                <div className="mdf-sec">Escalation</div>
                <Field label="Level">
                  <div className="readonly-val">{row.escalationStep ? `Level ${row.escalationStep}` : "—"}</div>
                </Field>
                <Field label="Current recipient">
                  <div className="lookup">{row.currentRecipient || "—"}</div>
                </Field>
                <Field label="Last escalated">
                  <input readOnly value={row.lastEscalatedOn ? formatDateTime(row.lastEscalatedOn) : ""} placeholder="—" />
                </Field>
                <Field label="Next level">
                  <input readOnly value={row.nextEscalationOn ? formatDateTime(row.nextEscalationOn) : ""} placeholder={row.escalationStep ? "Chain complete" : "—"} />
                </Field>
                <Field label="Escalated By">
                  <div className="lookup">{row.escalatedBy || "—"}</div>
                </Field>
                <Field label="Escalation Reason" wide>
                  <input readOnly value={row.escalationReason || ""} placeholder="—" />
                </Field>
              </>
            ) : null}

            <div className="mdf-sec">Closure</div>
            <Field label="Closed By">
              <div className="lookup muted-val">{row.closedBy || "—"}</div>
            </Field>
            <Field label="Closure Date/Time">
              <input readOnly value={row.closed ? formatDateTime(row.closed) : ""} placeholder="—" />
            </Field>
            <Field label="Closure Comment" wide>
              <textarea readOnly rows={2} value={row.closureComment || ""} />
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
        <div><label>Outcome</label><select><option>Responded</option><option>No reply required</option></select></div>
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
    return <div className="note">Loading emails</div>;
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
