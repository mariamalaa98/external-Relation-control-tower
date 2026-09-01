import { MAILBOX_TEST, type Communication, type IntakeEmail, type License, type Party, type SlaRule, type Store } from "./types";
import { dueFromCreated } from "./communicationLogic";

const sla = (id: string, category: SlaRule["category"], priority: SlaRule["priority"], ackHours: number, resolveDays: number, basis: SlaRule["basis"]): SlaRule =>
  ({ id, name: `${category} - ${priority}`, category, priority, ackHours, resolveDays, basis, active: true });

const p = (id: string, name: string, category: Party["category"], email: string, domain: string, bu: string, owner: string, criticality: Party["criticality"], status: Party["status"], department = "Government Relations"): Party =>
  ({ id, name, category, email, domain, bu, owner, criticality, status, department });

const c = (
  id: string, party: string, cat: Communication["cat"], subj: string, owner: string, sup: string,
  pri: Communication["pri"], rec: string, status: Communication["status"], bu: string, extra: Partial<Communication> = {}
): Communication => {
  const createdOn = extra.createdOn || `${rec}T10:03:00`;
  const due = extra.due || dueFromCreated(createdOn);
  return {
    id, recordId: id, party, cat, subj, owner, sup, pri, rec, status, bu, ev: extra.ev ?? 0, type: extra.type || "Inbound",
    emailSubject: extra.emailSubject || subj,
    isOverdue: extra.isOverdue ?? true,
    isEscalated: extra.isEscalated ?? false,
    isAutomaticallyEscalated: extra.isAutomaticallyEscalated ?? false,
    isManuallyEscalated: extra.isManuallyEscalated ?? false,
    conversationIndex: extra.conversationIndex || `thread-${id}`,
    threadId: extra.threadId || `thread-${id}`,
    log: extra.log ?? [
      { title: "Email ingested from Dataverse email table", meta: `${rec} — ${MAILBOX_TEST}` },
      { title: "Sender matched to External Party Master", meta: `${rec} — matched on sender domain` },
      { title: "Due date set to Created On + 2 hours", meta: `due ${due}` },
    ],
    ...extra,
    due,
    createdOn,
  };
};

const d = (
  id: string, type: License["type"], name: string, party: string, auth: string, issue: string, expiry: string,
  risk: License["risk"], owner: string, bu: string, extra: Partial<License> = {}
): License => ({
  id, recordId: id, type, name, party, auth, issue, expiry, risk, owner, bu,
  reminderThreshold: extra.reminderThreshold ?? 120,
  reminderSent: extra.reminderSent ?? !!extra.notified,
  ...extra,
});

const m = (id: string, recv: string, from: string, subj: string, match: string, cat: IntakeEmail["cat"], pri: IntakeEmail["pri"], owner: string, status: IntakeEmail["status"], extra: Partial<IntakeEmail> = {}): IntakeEmail =>
  ({ id, recv, from, to: MAILBOX_TEST, subj, match, cat, pri, owner, status, conversationIndex: extra.conversationIndex || `thread-${id}`, ...extra });

const BU = [
  "Andalusia Hospital – Smouha",
  "Andalusia Hospital – El Maadi",
  "Andalusia Hospital – Shallalat",
  "Group – Head Office",
];

const recentOverdue = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
const stillWithin = new Date(Date.now() - 30 * 60 * 1000).toISOString();

export const SEED: Store = {
  source: "local",
  ready: true,
  businessUnits: BU.map((name, i) => ({ id: `bu-${i}`, name })),
  sla: [
    sla("S1", "Government", "Critical", 4, 2, "Working days"),
    sla("S2", "Government", "High", 8, 5, "Working days"),
    sla("S3", "Regulatory", "Critical", 4, 2, "Working days"),
    sla("S4", "Regulatory", "High", 8, 5, "Working days"),
    sla("S5", "Legal", "Critical", 2, 2, "Calendar days"),
    sla("S6", "Legal", "High", 4, 3, "Calendar days"),
    sla("S7", "Insurance", "High", 24, 7, "Working days"),
    sla("S8", "Insurance", "Medium", 24, 10, "Working days"),
    sla("S9", "Corporate", "Medium", 24, 10, "Working days"),
    sla("S10", "Partner", "Low", 48, 14, "Working days"),
  ],
  parties: [
    p("P1", "National Health Insurance Authority", "Government", "correspondence@nhia.gov.eg", "nhia.gov.eg", BU[3], "Ahmed Salah", "High", "Active", "Government Relations"),
    p("P2", "Egyptian Drug Authority", "Regulatory", "inspection@edaegypt.gov.eg", "edaegypt.gov.eg", BU[1], "Mona ElSayed", "High", "Active", "Government Relations"),
    p("P3", "Ministry of Health – Alexandria", "Government", "licensing@mohp.gov.eg", "mohp.gov.eg", BU[0], "Ahmed Salah", "High", "Active", "Government Relations"),
    p("P4", "MetLife Egypt", "Insurance", "claims@metlife.com.eg", "metlife.com.eg", BU[0], "Nourhan Abdelrahman", "High", "Active", "Insurance Relations"),
    p("P5", "AXA Egypt", "Insurance", "provider.relations@axa.com.eg", "axa.com.eg", BU[3], "Nourhan Abdelrahman", "Medium", "Active", "Insurance Relations"),
    p("P6", "Zulficar & Partners Law Firm", "Legal", "legal@zulficarpartners.com", "zulficarpartners.com", BU[3], "Heba Kamal", "High", "Active", "Legal Affairs"),
    p("P7", "Misr Insurance", "Insurance", "providers@misrinsurance.com.eg", "misrinsurance.com.eg", BU[2], "Nourhan Abdelrahman", "Medium", "Active", "Insurance Relations"),
    p("P8", "Nile Radiology Partners", "Partner", "contracts@nileradiology.com", "nileradiology.com", BU[0], "Karim ElBadry", "Low", "Inactive", "Medical Services"),
    p("P9", "Egyptian Tax Authority", "Government", "vat@eta.gov.eg", "eta.gov.eg", BU[3], "Sara Fouad", "High", "Active", "Finance"),
    p("P10", "General Authority for Healthcare Accreditation", "Regulatory", "cap@gahar.gov.eg", "gahar.gov.eg", BU[0], "Yasser Mahmoud", "High", "Active", "Government Relations"),
  ],
  comms: [
    c("COM-2026-0412", "National Health Insurance Authority", "Government", "Facility re-accreditation site visit schedule", "Ahmed Salah", "Dr. Bassam Farid", "Critical", "2026-08-10", "In Progress", BU[0], { resp: "2026-08-12 16:20", respAction: "Acknowledged; documents in preparation", isAutomaticallyEscalated: true, isEscalated: true, escalatedBy: "System (Automatic Escalation)" }),
    c("COM-2026-0411", "Egyptian Drug Authority", "Regulatory", "Pharmacy stock inspection findings response", "Mona ElSayed", "Yasser Mahmoud", "High", "2026-08-12", "In Progress", BU[1], { resp: "2026-08-12 15:40", respAction: "CAP submitted; evidence pending", isAutomaticallyEscalated: true, isEscalated: true, escalatedBy: "System (Automatic Escalation)" }),
    c("COM-2026-0410", "MetLife Egypt", "Insurance", "Claim rejection batch — July settlement dispute", "Nourhan Abdelrahman", "Yasser Mahmoud", "High", "2026-08-13", "In Progress", BU[0], { resp: "2026-08-14 11:10", respAction: "Dispute file opened with payer", createdOn: recentOverdue, isOverdue: true, isEscalated: false }),
    c("COM-2026-0409", "Ministry of Health – Alexandria", "Government", "Annual operating licence documentation request", "Ahmed Salah", "Dr. Bassam Farid", "Critical", "2026-08-09", "Closed", BU[2], { closed: "2026-08-10T14:20:00", closedBy: "Ahmed Salah", closureComment: "Documents submitted; receipt archived", ev: 2, resp: "2026-08-09 14:10", respAction: "Documents submitted; receipt archived" }),
    c("COM-2026-0408", "Zulficar & Partners Law Firm", "Legal", "Legal notice — patient compensation claim", "Heba Kamal", "Dr. Bassam Farid", "Critical", "2026-08-08", "In Progress", BU[1], { caseRef: "CASE-2026-017", resp: "2026-08-11 09:40", respAction: "Counsel engaged; formal reply drafted", isManuallyEscalated: true, isEscalated: true, escalatedBy: "Heba Kamal", escalationReason: "Counsel requested executive visibility" }),
    c("COM-2026-0407", "AXA Egypt", "Insurance", "Contract amendment — updated tariff annex", "Nourhan Abdelrahman", "Mona ElSayed", "Medium", "2026-08-14", "In Progress", BU[3], { createdOn: stillWithin, isOverdue: false, isEscalated: false }),
    c("COM-2026-0406", "General Authority for Healthcare Accreditation", "Regulatory", "GAHAR corrective action plan submission", "Ahmed Salah", "Dr. Bassam Farid", "High", "2026-08-11", "In Progress", BU[0], { resp: "2026-08-11 12:15", respAction: "CAP v3 issued for review", isAutomaticallyEscalated: true, isEscalated: true, escalatedBy: "System (Automatic Escalation)" }),
    c("COM-2026-0405", "Bank Misr — Corporate Banking", "Corporate", "Payroll account mandate signatory update", "Sara Fouad", "Mona ElSayed", "Low", "2026-08-14", "In Progress", BU[3], { createdOn: stillWithin, isOverdue: false }),
    c("COM-2026-0404", "Egyptian Tax Authority", "Government", "VAT reconciliation query — Q2 2026", "Sara Fouad", "Mona ElSayed", "High", "2026-08-06", "Closed", BU[3], { closed: "2026-08-12T11:00:00", closedBy: "Sara Fouad", closureComment: "Reconciliation workings sent to ETA", ev: 1, resp: "2026-08-06 17:35", respAction: "Reconciliation workings sent to ETA" }),
    c("COM-2026-0403", "Matouk Bassiouny", "Legal", "Employment dispute — former nursing staff", "Heba Kamal", "Dr. Bassam Farid", "High", "2026-07-29", "In Progress", BU[0], { caseRef: "CASE-2026-014", resp: "2026-08-03 11:05", respAction: "Statement of defence filed", isManuallyEscalated: true, isAutomaticallyEscalated: true, isEscalated: true, escalatedBy: "Heba Kamal" }),
  ],
  docs: [
    d("DOC-2026-0071", "License", "Facility Operating Licence — Smouha", "Ministry of Health – Alexandria", "MOHP Alexandria Directorate", "2025-09-15", "2026-09-14", "High", "Ahmed Salah", BU[0], { notified: "2026-05-17 09:00" }),
    d("DOC-2026-0072", "License", "Pharmacy Practice Licence — El Maadi", "Egyptian Drug Authority", "Egyptian Drug Authority", "2025-11-02", "2026-11-01", "High", "Mona ElSayed", BU[1], { notified: "2026-07-04 09:00" }),
    d("DOC-2026-0073", "Contract", "Payer Agreement — MetLife Egypt", "MetLife Egypt", "—", "2024-01-01", "2026-12-31", "Medium", "Nourhan Abdelrahman", BU[0]),
    d("DOC-2026-0074", "Contract", "Payer Agreement — AXA Egypt", "AXA Egypt", "—", "2023-07-01", "2026-08-31", "High", "Nourhan Abdelrahman", BU[3], { notified: "2026-05-03 09:00" }),
    d("DOC-2026-0075", "Permit", "Medical Waste Disposal Permit", "Egyptian Environmental Affairs Agency", "EEAA", "2025-06-20", "2026-06-19", "High", "Yasser Mahmoud", BU[2], { notified: "2026-02-19 09:00" }),
    d("DOC-2026-0076", "License", "Radiology Equipment Operating Permit", "Nuclear & Radiological Regulatory Authority", "ENRRA", "2026-02-10", "2027-02-09", "Low", "Sara Fouad", BU[0], { status: "Renewed", notified: "2026-10-12 09:00", done: "2026-07-28" }),
    d("DOC-2026-0077", "Permit", "Fire Safety Permit — Shallalat", "Civil Protection Authority", "Civil Protection Authority", "2025-10-01", "2026-10-01", "Medium", "Yasser Mahmoud", BU[2], { notified: "2026-06-03 09:00", done: "2026-08-14" }),
    d("DOC-2026-0078", "Contract", "Cleaning Services Contract", "Nile Facility Services", "—", "2024-10-18", "2026-10-18", "Low", "Sara Fouad", BU[1]),
    d("DOC-2026-0081", "License", "Pharmacy Practice Licence — Smouha", "Egyptian Drug Authority", "Egyptian Drug Authority", "2025-11-01", "2026-10-31", "High", "Mona ElSayed", BU[0], { notified: "2026-07-03 09:00" }),
  ],
  intake: [
    m("EML-1001", "2026-08-25 09:02", "licensing@mohp.gov.eg", "Renewal reminder — facility operating licence", "Ministry of Health – Alexandria", "Government", "Critical", "Ahmed Salah", "New"),
    m("EML-1002", "2026-08-25 08:41", "claims@metlife.com.eg", "Rejected claims list — week 33", "MetLife Egypt", "Insurance", "High", "Nourhan Abdelrahman", "New"),
    m("EML-1003", "2026-08-24 17:55", "m.saad@unknownclinic.net", "Partnership proposal — radiology referrals", "", "Partner", "Low", "Karim ElBadry", "In Review"),
    m("EML-1004", "2026-08-24 14:10", "inspection@edaegypt.gov.eg", "Inspection appointment confirmation", "Egyptian Drug Authority", "Regulatory", "High", "Mona ElSayed", "New"),
    m("EML-1005", "2026-08-24 11:23", "legal@zulficarpartners.com", "Legal notice follow-up — CASE-2026-017", "Zulficar & Partners Law Firm", "Legal", "Critical", "Heba Kamal", "In Review", { conversationIndex: "thread-COM-2026-0408", inReplyTo: "COM-2026-0408" }),
    m("EML-1006", "2026-08-23 16:48", "noreply@tenders-portal.eg", "Tender bulletin — medical consumables", "", "Corporate", "Low", "Sara Fouad", "New"),
  ],
  renewals: [],
  notices: [],
  files: [
    { id: "F1", name: "NHIA re-accreditation response letter.pdf", rel: "COM-2026-0412", date: "2026-08-15", by: "Ahmed Salah" },
    { id: "F2", name: "EDA inspection findings — signed CAP.pdf", rel: "COM-2026-0411", date: "2026-08-14", by: "Mona ElSayed" },
    { id: "F3", name: "Facility operating licence — Smouha 2026.pdf", rel: "COM-2026-0409", date: "2026-08-12", by: "Ahmed Salah" },
    { id: "F4", name: "Legal notice CASE-2026-017 — receipt proof.pdf", rel: "COM-2026-0408", date: "2026-08-11", by: "Heba Kamal" },
  ],
  threadByComm: {},
};
