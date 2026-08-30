import type { ReactNode } from "react";
import type { Category, Priority, SlaState } from "../data/types";

export function catBadge(cat: Category | string) {
  const map: Record<string, string> = {
    Government: "b-info",
    Insurance: "b-gold",
    Regulatory: "b-warn",
    Legal: "b-bad",
    Corporate: "b-brown",
    Partner: "b-plum",
  };
  return <span className={`badge ${map[cat] || "b-gray"}`}>{cat}</span>;
}

export function priBadge(pri: Priority | string) {
  const map: Record<string, string> = {
    None: "b-gray",
    Critical: "b-bad",
    High: "b-warn",
    Medium: "b-gold",
    Low: "b-gray",
  };
  return <span className={`badge ${map[pri] || "b-gray"}`}>{pri}</span>;
}

export function slaBadge(state: SlaState) {
  const map: Record<SlaState, string> = { Within: "b-ok", "At Risk": "b-warn", Breached: "b-bad" };
  return <span className={`badge ${map[state]}`}>{state}</span>;
}

export function flagBadge(on: boolean, onLabel: string, offLabel: string) {
  return (
    <span className={`flag ${on ? "on" : ""}`}>
      {on ? <span className="flag-ico" aria-hidden>⚑</span> : null}
      {on ? onLabel : offLabel}
    </span>
  );
}

export function statusBadge(status: string) {
  const map: Record<string, string> = {
    Open: "b-info",
    "In Progress": "b-gold",
    "Pending Evidence": "b-warn",
    Closed: "b-ok",
    Active: "b-ok",
    Inactive: "b-gray",
    Expiring: "b-warn",
    Expired: "b-bad",
    Renewed: "b-ok",
    New: "b-info",
    "In Review": "b-warn",
    Routed: "b-ok",
    Linked: "b-ok",
    Created: "b-info",
    Attached: "b-plum",
    Overdue: "b-bad",
    Completed: "b-ok",
    Cancelled: "b-gray",
    "In progress": "b-gold",
    License: "b-info",
    Contract: "b-brown",
    Permit: "b-warn",
  };
  return <span className={`badge ${map[status] || "b-gray"}`}>{status}</span>;
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ffld">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function PageHead({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children?: ReactNode;
}) {
  return (
    <div className="pagehead">
      <div>
        <h1>{title}</h1>
        <div className="sub">{sub}</div>
      </div>
      <div className="acts">{children}</div>
    </div>
  );
}

export function DataTable({
  cols,
  rows,
}: {
  cols: ReactNode[];
  rows: { key: string; cells: ReactNode[]; legal?: boolean; onClick?: () => void }[];
}) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="noresults">
              <td colSpan={cols.length}>No records match the current filters</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className={r.legal ? "legal-row" : undefined} onClick={r.onClick}>
                {r.cells.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Kpi({ acc, label, value, detail, onClick }: { acc: string; label: string; value: number | string; detail: string; onClick?: () => void }) {
  return (
    <div className="kpi" style={{ ["--acc" as string]: acc }} onClick={onClick}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
    </div>
  );
}

export function Overlay({
  kind,
  title,
  sub,
  onClose,
  footer,
  children,
}: {
  kind: "modal" | "drawer";
  title: string;
  sub?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="scrim open" onClick={onClose} />
      <div className={`${kind} open`}>
        <div className="dh">
          <div>
            <div className="t">{title}</div>
            {sub ? <div className="s">{sub}</div> : null}
          </div>
          <button className="x" type="button" onClick={onClose}>×</button>
        </div>
        <div className="db">{children}</div>
        {footer ? <div className="df">{footer}</div> : null}
      </div>
    </>
  );
}
