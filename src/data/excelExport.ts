/** Excel 2003 XML workbook. Opens in Excel without an extra library. */

export type ExcelSheet = {
  name: string;
  cols: string[];
  rows: string[][];
};

function xmlEscape(value: string) {
  return (value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheetName(value: string, used: Set<string>) {
  const cleaned = (value || "Sheet").replace(/[\\/*?:[\]]/g, " ").trim() || "Sheet";
  let name = cleaned.slice(0, 31);
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${cleaned.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function cell(value: string) {
  return `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
}

export function rangeText(from: string, to: string) {
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `through ${to}`;
  return "all dates";
}

export function exportFileName(prefix: string, from: string, to: string, ext = "xls") {
  if (!from && !to) return `${prefix}-all-dates.${ext}`;
  return `${prefix}-${from || "start"}_to_${to || "end"}.${ext}`;
}

export function exportLabel(from: string, to: string) {
  if (from && to) return `Export Excel ${from} → ${to}`;
  if (from) return `Export Excel from ${from}`;
  if (to) return `Export Excel through ${to}`;
  return "Export Excel";
}

export function downloadExcel(filename: string, sheets: ExcelSheet[]) {
  const used = new Set<string>();
  const worksheets = sheets.map((sheet) => {
    const name = xmlEscape(sheetName(sheet.name, used));
    const header = `<Row>${sheet.cols.map(cell).join("")}</Row>`;
    const body = sheet.rows.map((row) => `<Row>${row.map((value) => cell(value ?? "")).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${name}"><Table>${header}${body}</Table></Worksheet>`;
  }).join("");
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>`
    + `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`
    + worksheets
    + `</Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}
