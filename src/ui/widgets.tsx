import type { ReactNode } from "react";
import type { Category, Priority, SlaState } from "../data/types";

export function catBadge(cat: Category) {
  const map: Record<Category, string> = {
    Government: "b-info",
    Insurance: "b-gold",
    Regulatory: "b-warn",
    Legal: "b-bad",
    Corporate: "b-brown",
    Partner: "b-plum",
  };
  return <span className={`badge ${map[cat]}`}>{cat}</span>;
}

export function priBadge(pri: Priority) {
  const map: Record<Priority, string> = {
    Critical: "b-bad",
    High: "b-warn",
    Medium: "b-gold",
    Low: "b-gray",
  };
  return <span className={`badge ${map[pri]}`}>{pri}</span>;
}

export function slaBadge(state: SlaState) {
  const map: Record<SlaState, string> = { Within: "b-ok", "At Risk": "b-warn", Breached: "b-bad" };
  return <span className={`badge ${map[state]}`}>{state}</span>;
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
  };
  return <span className={`badge ${map[status] || "b-gray"}`}>{status}</span>;
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
  cols: string[];
  rows: { key: string; cells: ReactNode[]; legal?: boolean }[];
}) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
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
              <tr key={r.key} className={r.legal ? "legal-row" : undefined}>
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
