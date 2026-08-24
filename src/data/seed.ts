import type { Communication, License, Party, SlaRule, Store } from "./types";

const sla = (category: SlaRule["category"], priority: SlaRule["priority"], ackHours: number, resolveDays: number, basis: SlaRule["basis"]): SlaRule =>
  ({ category, priority, ackHours, resolveDays, basis });

const p = (id: string, name: string, category: Party["category"], email: string, domain: string, bu: string, owner: string, criticality: Party["criticality"], status: Party["status"]): Party =>
  ({ id, name, category, email, domain, bu, owner, criticality, status });

const c = (
  id: string, party: string, cat: Communication["cat"], subj: string, owner: string, sup: string,
  pri: Communication["pri"], rec: string, due: string, status: Communication["status"], bu: string, extra: Partial<Communication> = {}
): Communication => ({ id, party, cat, subj, owner, sup, pri, rec, due, status, bu, ...extra });

const d = (
  id: string, type: License["type"], name: string, party: string, auth: string, issue: string, expiry: string,
  risk: License["risk"], owner: string, bu: string, extra: Partial<License> = {}
): License => ({ id, type, name, party, auth, issue, expiry, risk, owner, bu, ...extra });

const BU = [
  "Andalusia Hospital – Smouha",
  "Andalusia Hospital – El Maadi",
  "Andalusia Hospital – Shallalat",
  "Group – Head Office",
];

export const SEED: Store = {
  sla: [
    sla("Government", "Critical", 4, 2, "Working days"),
    sla("Government", "High", 8, 5, "Working days"),
    sla("Regulatory", "Critical", 4, 2, "Working days"),
    sla("Regulatory", "High", 8, 5, "Working days"),
    sla("Legal", "Critical", 2, 2, "Calendar days"),
    sla("Legal", "High", 4, 3, "Calendar days"),
    sla("Insurance", "High", 24, 7, "Working days"),
    sla("Insurance", "Medium", 24, 10, "Working days"),
    sla("Corporate", "Medium", 24, 10, "Working days"),
    sla("Partner", "Low", 48, 14, "Working days"),
  ],
  parties: [
    p("P1", "National Health Insurance Authority", "Government", "correspondence@nhia.gov.eg", "nhia.gov.eg", BU[3], "Ahmed Salah", "High", "Active"),
    p("P2", "Egyptian Drug Authority", "Regulatory", "inspection@edaegypt.gov.eg", "edaegypt.gov.eg", BU[1], "Mona ElSayed", "High", "Active"),
    p("P3", "Ministry of Health – Alexandria", "Government", "licensing@mohp.gov.eg", "mohp.gov.eg", BU[0], "Ahmed Salah", "High", "Active"),
    p("P4", "MetLife Egypt", "Insurance", "claims@metlife.com.eg", "metlife.com.eg", BU[0], "Nourhan Abdelrahman", "High", "Active"),
    p("P5", "AXA Egypt", "Insurance", "provider.relations@axa.com.eg", "axa.com.eg", BU[3], "Nourhan Abdelrahman", "Medium", "Active"),
    p("P6", "Zulficar & Partners Law Firm", "Legal", "legal@zulficarpartners.com", "zulficarpartners.com", BU[3], "Heba Kamal", "High", "Active"),
    p("P7", "Misr Insurance", "Insurance", "providers@misrinsurance.com.eg", "misrinsurance.com.eg", BU[2], "Nourhan Abdelrahman", "Medium", "Active"),
    p("P8", "Nile Radiology Partners", "Partner", "contracts@nileradiology.com", "nileradiology.com", BU[0], "Karim ElBadry", "Low", "Inactive"),
    p("P9", "Egyptian Tax Authority", "Government", "vat@eta.gov.eg", "eta.gov.eg", BU[3], "Sara Fouad", "High", "Active"),
    p("P10", "General Authority for Healthcare Accreditation", "Regulatory", "cap@gahar.gov.eg", "gahar.gov.eg", BU[0], "Yasser Mahmoud", "High", "Active"),
  ],
  comms: [
    c("COM-2026-0412", "National Health Insurance Authority", "Government", "Facility re-accreditation site visit schedule", "Ahmed Salah", "Dr. Bassam Farid", "Critical", "2026-08-10", "2026-08-12", "In Progress", BU[0], { resp: "2026-08-12 16:20", respAction: "Acknowledged; documents in preparation" }),
    c("COM-2026-0411", "Egyptian Drug Authority", "Regulatory", "Pharmacy stock inspection findings response", "Mona ElSayed", "Yasser Mahmoud", "High", "2026-08-12", "2026-08-18", "Pending Evidence", BU[1], { resp: "2026-08-12 15:40", respAction: "CAP submitted; evidence pending" }),
    c("COM-2026-0410", "MetLife Egypt", "Insurance", "Claim rejection batch — July settlement dispute", "Nourhan Abdelrahman", "Yasser Mahmoud", "High", "2026-08-13", "2026-08-20", "Open", BU[0], { resp: "2026-08-14 11:10", respAction: "Dispute file opened with payer" }),
    c("COM-2026-0409", "Ministry of Health – Alexandria", "Government", "Annual operating licence documentation request", "Ahmed Salah", "Dr. Bassam Farid", "Critical", "2026-08-09", "2026-08-11", "Closed", BU[2], { closed: "2026-08-10", ev: 2, resp: "2026-08-09 14:10", respAction: "Documents submitted; receipt archived" }),
    c("COM-2026-0408", "Zulficar & Partners Law Firm", "Legal", "Legal notice — patient compensation claim", "Heba Kamal", "Dr. Bassam Farid", "Critical", "2026-08-08", "2026-08-10", "In Progress", BU[1], { caseRef: "CASE-2026-017", resp: "2026-08-11 09:40", respAction: "Counsel engaged; formal reply drafted" }),
    c("COM-2026-0407", "AXA Egypt", "Insurance", "Contract amendment — updated tariff annex", "Nourhan Abdelrahman", "Mona ElSayed", "Medium", "2026-08-14", "2026-08-24", "Open", BU[3]),
    c("COM-2026-0406", "General Authority for Healthcare Accreditation", "Regulatory", "GAHAR corrective action plan submission", "Ahmed Salah", "Dr. Bassam Farid", "High", "2026-08-11", "2026-08-17", "In Progress", BU[0], { resp: "2026-08-11 12:15", respAction: "CAP v3 issued for review" }),
    c("COM-2026-0405", "Bank Misr — Corporate Banking", "Corporate", "Payroll account mandate signatory update", "Sara Fouad", "Mona ElSayed", "Low", "2026-08-14", "2026-08-28", "Open", BU[3]),
    c("COM-2026-0404", "Egyptian Tax Authority", "Government", "VAT reconciliation query — Q2 2026", "Sara Fouad", "Mona ElSayed", "High", "2026-08-06", "2026-08-13", "Closed", BU[3], { closed: "2026-08-12", ev: 1, resp: "2026-08-06 17:35", respAction: "Reconciliation workings sent to ETA" }),
    c("COM-2026-0403", "Matouk Bassiouny", "Legal", "Employment dispute — former nursing staff", "Heba Kamal", "Dr. Bassam Farid", "High", "2026-07-29", "2026-08-05", "Pending Evidence", BU[0], { caseRef: "CASE-2026-014", resp: "2026-08-03 11:05", respAction: "Statement of defence filed" }),
  ],
  docs: [
    d("DOC-2026-0071", "License", "Facility Operating Licence — Smouha", "Ministry of Health – Alexandria", "MOHP Alexandria Directorate", "2025-09-15", "2026-09-14", "High", "Ahmed Salah", BU[0], { notified: "2026-05-17 09:00" }),
    d("DOC-2026-0072", "License", "Pharmacy Practice Licence — El Maadi", "Egyptian Drug Authority", "Egyptian Drug Authority", "2025-11-02", "2026-11-01", "High", "Mona ElSayed", BU[1], { notified: "2026-07-04 09:00" }),
    d("DOC-2026-0073", "Contract", "Payer Agreement — MetLife Egypt", "MetLife Egypt", "—", "2024-01-01", "2026-12-31", "Medium", "Nourhan Abdelrahman", BU[0]),
    d("DOC-2026-0074", "Contract", "Payer Agreement — AXA Egypt", "AXA Egypt", "—", "2023-07-01", "2026-08-31", "High", "Nourhan Abdelrahman", BU[3], { notified: "2026-05-03 09:00" }),
    d("DOC-2026-0075", "Permit", "Medical Waste Disposal Permit", "Egyptian Environmental Affairs Agency", "EEAA", "2025-06-20", "2026-06-19", "High", "Yasser Mahmoud", BU[2], { notified: "2026-02-19 09:00" }),
    d("DOC-2026-0076", "License", "Radiology Equipment Operating Permit", "Nuclear & Radiological Regulatory Authority", "ENRRA", "2026-02-10", "2027-02-09", "Low", "Sara Fouad", BU[0], { status: "Renewed", notified: "2026-10-12 09:00", done: "2026-07-28" }),
  ],
};
