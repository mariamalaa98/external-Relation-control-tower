import { useMemo, useState, type FormEvent } from "react";
import { ARCHIVE_TYPES, type ArchiveType } from "../data/types";
import {
  addArchive,
  downloadArchiveFile,
  formatDateTime,
  matchesSearch,
  useStore,
} from "../data/store";
import { downloadBytes, mimeFromFileName } from "../data/emailAttachments";
import { DataTable, FilterField, Kpi, Overlay } from "./widgets";

export function DocumentArchiveScreen({
  q,
  setQ,
  busy,
  onToast,
  onFail,
}: {
  q: string;
  setQ: (v: string) => void;
  busy: boolean;
  onToast: (msg: string) => void;
  onFail: (msg: string) => void;
}) {
  const db = useStore();
  const [type, setType] = useState("All");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => db.archives.filter((row) => {
    const hit = matchesSearch(q, row.name, row.fileName, row.communicationName, row.licenseName, row.uploadedBy, row.type, row.notes);
    return hit && (type === "All" || row.type === type);
  }), [db.archives, q, type]);

  async function download(id: string, name: string) {
    try {
      const file = await downloadArchiveFile(id);
      downloadBytes(file.bytes, file.name || name, mimeFromFileName(file.name || name));
    } catch (err) {
      onFail(err instanceof Error ? err.message : "Could not download the file.");
    }
  }

  const loadError = db.warnings?.find((w) => /document archive/i.test(w));

  return (
    <>
      {loadError ? <div className="callout">{loadError}</div> : null}
      {!db.archives.length ? (
        <div className="callout">
          Document Archive is empty until a file is uploaded here or from a communication / license record. Files are stored on <b>erc_documentarchive</b>.
        </div>
      ) : null}
      <div className="kpis">
        <Kpi acc="var(--bronze)" label="Archived files" value={db.archives.length} detail="erc_documentarchive" />
        <Kpi acc="var(--info)" label="Communication evidence" value={db.archives.filter((r) => r.type === "Communication evidence").length} detail="Linked to a case" />
        <Kpi acc="var(--warn)" label="License documents" value={db.archives.filter((r) => r.type === "License document").length} detail="License / contract files" />
      </div>
      <div className="filters">
        <FilterField label="Search" className="ffld-search">
          <input type="search" placeholder="Search file, communication, license" value={q} onInput={(e) => setQ(e.currentTarget.value)} onChange={(e) => setQ(e.target.value)} />
        </FilterField>
        <FilterField label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option>All</option>
            {ARCHIVE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </FilterField>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => setOpen(true)}>Upload file</button>
        <span className="fnote">{filtered.length} shown</span>
      </div>
      <DataTable
        cols={["Name", "Type", "Communication", "License", "Uploaded by", "Uploaded on", "File"]}
        rows={filtered.map((row) => ({
          key: row.recordId || row.id,
          cells: [
            row.name,
            row.type,
            row.communicationName || "—",
            row.licenseName || "—",
            row.uploadedBy || "—",
            <span className="mono" key="on">{formatDateTime(row.uploadedOn)}</span>,
            row.fileName
              ? <button className="btn btn-ghost" type="button" onClick={() => void download(row.id, row.fileName || row.name)}>Download</button>
              : "—",
          ],
        }))}
      />
      {open ? (
        <ArchiveUploadForm
          busy={busy}
          onClose={() => setOpen(false)}
          onSaved={(msg) => { setOpen(false); onToast(msg); }}
          onFail={onFail}
        />
      ) : null}
    </>
  );
}

export function ArchiveUploadForm({
  busy,
  defaultCommId,
  defaultLicenseId,
  defaultType = "Communication evidence",
  onClose,
  onSaved,
  onFail,
}: {
  busy: boolean;
  defaultCommId?: string;
  defaultLicenseId?: string;
  defaultType?: ArchiveType;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onFail: (msg: string) => void;
}) {
  const db = useStore();
  const [saving, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const name = String(f.get("name") || "").trim();
    const file = (form.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
    if (!name) return onFail("File name is required");
    setBusy(true);
    try {
      await addArchive({
        name,
        type: String(f.get("type") || defaultType) as ArchiveType,
        notes: String(f.get("notes") || "").trim() || undefined,
        communicationId: String(f.get("communicationId") || "") || undefined,
        licenseId: String(f.get("licenseId") || "") || undefined,
        file,
      });
      onSaved(`${name} saved to Document Archive`);
    } catch (err) {
      onFail(err instanceof Error ? err.message : "Could not archive the file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay kind="modal" title="Upload to Document Archive" sub="Saved on erc_documentarchive" onClose={onClose} footer={null}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form">
          <div className="wide"><label>Name *</label><input name="name" required defaultValue="" /></div>
          <div>
            <label>Document type *</label>
            <select name="type" defaultValue={defaultType}>
              {ARCHIVE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label>Related communication</label>
            <select name="communicationId" defaultValue={defaultCommId || ""}>
              <option value="">—</option>
              {db.comms.map((c) => <option key={c.recordId || c.id} value={c.recordId || c.id}>{c.id} · {c.subj}</option>)}
            </select>
          </div>
          <div>
            <label>Related license</label>
            <select name="licenseId" defaultValue={defaultLicenseId || ""}>
              <option value="">—</option>
              {db.docs.map((d) => <option key={d.recordId || d.id} value={d.recordId || d.id}>{d.id} · {d.name}</option>)}
            </select>
          </div>
          <div className="wide"><label>File</label><input name="file" type="file" /></div>
          <div className="wide"><label>Notes</label><input name="notes" maxLength={100} /></div>
        </div>
        <div className="note">The file is stored on the Document Archive table. Notes are limited to 100 characters.</div>
        <div className="df" style={{ margin: "16px -20px -20px" }}>
          <button className="btn btn-primary" type="submit" disabled={busy || saving}>Save</button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Overlay>
  );
}
