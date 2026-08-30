import { useState, type FormEvent } from "react";
import { CATS, type Category, type Communication, type IntakeEmail } from "../data/types";
import {
  formatDateTime,
  unmatchedComms,
  unmatchedIntake,
  useStore,
} from "../data/store";
import { DataTable, FilterField, Overlay, PageHead, catBadge, priBadge, statusBadge } from "./widgets";

export function UnmatchedSendersPage({
  q,
  setQ,
  busy,
  onRefresh,
  onOpenComm,
  onResolveComm,
  onResolveMail,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  onRefresh: () => void;
  onOpenComm: (row: Communication) => void;
  onResolveComm: (row: Communication) => void;
  onResolveMail: (mail: IntakeEmail) => void;
}) {
  const db = useStore();
  const [tab, setTab] = useState<"comms" | "mail">("comms");
  const comms = unmatchedComms(true).filter((c) => {
    const blob = `${c.id} ${c.subj} ${c.owner} ${c.emailSubject || ""}`.toLowerCase();
    return blob.includes(q.toLowerCase());
  });
  const openComms = comms.filter((c) => c.status !== "Closed");
  const mails = unmatchedIntake().filter((m) => {
    const blob = `${m.from} ${m.to} ${m.subj}`.toLowerCase();
    return blob.includes(q.toLowerCase());
  });

  return (
    <>
      <PageHead title="Unmatched Senders" sub="Emails and communications not linked to External Party Master">
        <button className="btn btn-outline" type="button" disabled={busy} onClick={onRefresh}>Refresh</button>
      </PageHead>
      <div className="callout">
        Unknown senders stay here until you <b>link an External Party</b> (Category and Priority then follow that party)
        or <b>assign a category</b> without a party. Unmatched records keep Priority = None.
      </div>
      <div className="kpis">
        <div className="kpi" style={{ ["--acc" as string]: "var(--bad)" }}>
          <div className="l">Open communications</div>
          <div className="v">{openComms.length}</div>
          <div className="d">No External Party lookup</div>
        </div>
        <div className="kpi" style={{ ["--acc" as string]: "var(--warn)" }}>
          <div className="l">Unmatched mailbox</div>
          <div className="v">{mails.length}</div>
          <div className="d">Sender domain not on a party</div>
        </div>
      </div>
      <div className="tabs" style={{ marginTop: 8 }}>
        <button className={tab === "comms" ? "on" : ""} type="button" onClick={() => setTab("comms")}>
          Communications ({comms.length})
        </button>
        <button className={tab === "mail" ? "on" : ""} type="button" onClick={() => setTab("mail")}>
          Mailbox emails ({mails.length})
        </button>
      </div>
      <div className="tabbody">
        <div className="filters" style={{ marginTop: 0 }}>
          <FilterField label="Search">
            <input
              placeholder={tab === "comms" ? "Search subject or ID" : "Search sender or subject"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </FilterField>
          <span className="fnote">{tab === "comms" ? comms.length : mails.length} shown</span>
        </div>
        {tab === "comms" ? (
          <DataTable
            cols={["CommID", "Subject", "Sender / owner", "Category", "Priority", "Status", ""]}
            rows={comms.map((r) => ({
              key: r.recordId || r.id,
              onClick: () => onOpenComm(r),
              cells: [
                <span className="link" key="id">{r.id}</span>,
                r.emailSubject || r.subj,
                r.owner || "—",
                r.categoryAssigned ? catBadge(r.cat) : <span className="badge b-gray">Unassigned</span>,
                priBadge(r.pri),
                statusBadge(r.status),
                r.status === "Closed" ? "—" : (
                  <button className="btn btn-outline btn-mini" type="button" onClick={(e) => { e.stopPropagation(); onResolveComm(r); }}>
                    Link or classify
                  </button>
                ),
              ],
            }))}
          />
        ) : (
          <DataTable
            cols={["Received", "From", "To", "Subject", ""]}
            rows={mails.map((m) => ({
              key: m.id,
              onClick: () => onResolveMail(m),
              cells: [
                <span className="mono" key="r">{m.recv}</span>,
                m.from,
                m.to,
                m.subj,
                <button key="p" className="btn btn-outline btn-mini" type="button" onClick={(e) => { e.stopPropagation(); onResolveMail(m); }}>
                  Link or classify
                </button>,
              ],
            }))}
          />
        )}
      </div>
      {db.source === "dataverse" ? null : (
        <div className="note">Prototype data: unmatched rows are communications without a party lookup, plus mailbox emails with no matched party.</div>
      )}
    </>
  );
}

export function ResolveUnmatchedForm({
  title,
  sub,
  sender,
  subject,
  received,
  busy,
  defaultCat,
  onCancel,
  onSubmit,
}: {
  title: string;
  sub: string;
  sender?: string;
  subject: string;
  received?: string;
  busy: boolean;
  defaultCat?: Category;
  onCancel: () => void;
  onSubmit: (opts: { partyId?: string; cat?: Category }) => void;
}) {
  const db = useStore();
  const [mode, setMode] = useState<"party" | "category">("party");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (mode === "party") {
      const partyId = String(f.get("partyId") || "");
      if (!partyId) return;
      onSubmit({ partyId });
      return;
    }
    onSubmit({ cat: String(f.get("cat")) as Category });
  }

  return (
    <Overlay kind="modal" title={title} sub={sub} onClose={onCancel} footer={null}>
      <form onSubmit={submit}>
        <dl className="kv">
          {received ? <><dt>Received</dt><dd className="mono">{received}</dd></> : null}
          {sender ? <><dt>Sender</dt><dd>{sender}</dd></> : null}
          <dt>Subject</dt><dd>{subject}</dd>
        </dl>
        <div className="resolve-modes">
          <label className={mode === "party" ? "on" : ""}>
            <input type="radio" name="mode" checked={mode === "party"} onChange={() => setMode("party")} />
            Link to an External Party
          </label>
          <label className={mode === "category" ? "on" : ""}>
            <input type="radio" name="mode" checked={mode === "category"} onChange={() => setMode("category")} />
            Assign a category only
          </label>
        </div>
        {mode === "party" ? (
          <div className="form">
            <div className="wide">
              <label>External party *</label>
              <select name="partyId" required>
                <option value="">Select party…</option>
                {db.parties.filter((p) => p.status === "Active").map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.category}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="form">
            <div className="wide">
              <label>Category *</label>
              <select name="cat" defaultValue={defaultCat || "Corporate"} required>
                {CATS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="note">
          {mode === "party"
            ? "The communication is bound to that party. Category, Priority, and Business Unit then follow the party formula columns."
            : "No External Party is set. Priority stays None. Category is written on the communication (erc_category), not the formula column."}
        </div>
        <div className="df" style={{ margin: "16px -20px -20px" }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {mode === "party" ? "Link party" : "Save category"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Overlay>
  );
}
