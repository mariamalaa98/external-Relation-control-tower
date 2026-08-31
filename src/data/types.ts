export const CATS = ["Government", "Insurance", "Regulatory", "Legal", "Corporate", "Partner"] as const;
export const PRIS = ["Critical", "High", "Medium", "Low"] as const;
export const BUS = [
  "Andalusia Hospital – Smouha",
  "Andalusia Hospital – El Maadi",
  "Andalusia Hospital – Shallalat",
  "Group – Head Office",
] as const;
export const OWNERS = [
  "Ahmed Salah",
  "Mona ElSayed",
  "Nourhan Abdelrahman",
  "Heba Kamal",
  "Sara Fouad",
  "Yasser Mahmoud",
  "Karim ElBadry",
  "Mariam Alaa",
] as const;
export const SUPS = ["Dr. Bassam Farid", "Yasser Mahmoud", "Mona ElSayed"] as const;

export const MAILBOX_PROD = "AndalusiaKSA-FU@andalusiagroup.net";
export const MAILBOX_TEST = "mariam.alaa@andalusiagroup.net";
export const MAILBOX_MAHA = "maha.hakim@andalusiagroup.net";
export const CENTRAL_MAILBOX_ADDRESSES = [MAILBOX_PROD, MAILBOX_TEST, MAILBOX_MAHA] as const;

export type Category = (typeof CATS)[number];
export type Priority = (typeof PRIS)[number] | "None";
export type CommStatus = "In Progress" | "Closed";
export const COMM_STATUSES = ["In Progress", "Closed"] as const;
export type SlaState = "Within" | "At Risk" | "Breached";
export type DocType = "License" | "Contract" | "Permit";
export type DocRisk = "Critical" | "High" | "Medium" | "Low";
export type IntakeStatus = "New" | "In Review" | "Routed";
export type DataSource = "dataverse" | "local";

export type SlaRule = {
  id: string;
  name: string;
  category: Category;
  priority: Priority;
  ackHours: number;
  resolveDays: number;
  basis: "Working days" | "Calendar days" | "Hours";
  active: boolean;
};

export type BusinessUnitRef = { id: string; name: string };

export type Party = {
  id: string;
  name: string;
  category: Category;
  email: string;
  domain: string;
  bu: string;
  buId?: string;
  owner: string;
  criticality: "High" | "Medium" | "Low";
  status: "Active" | "Inactive";
};

export type LogEntry = { title: string; meta: string };

export type EvidenceFile = {
  id: string;
  name: string;
  rel: string;
  date: string;
  by: string;
};

export type Communication = {
  id: string;
  recordId: string;
  party: string;
  partyId?: string;
  slaId?: string;
  slaName?: string;
  cat: Category;
  subj: string;
  owner: string;
  sup: string;
  pri: Priority;
  rec: string;
  due: string;
  status: CommStatus;
  bu: string;
  caseRef?: string;
  closed?: string;
  closedBy?: string;
  resp?: string;
  respAction?: string;
  ev: number;
  type: "Inbound" | "Outbound" | "Internal follow up";
  log: LogEntry[];
  closureComment?: string;
  createdOn: string;
  description?: string;
  emailSubject?: string;
  isOverdue: boolean;
  /** True when Is OverDue / Due Date came from Dataverse formula columns. Do not recompute. */
  overdueFromColumn?: boolean;
  isEscalated: boolean;
  isAutomaticallyEscalated: boolean;
  isManuallyEscalated: boolean;
  escalatedBy?: string;
  escalationReason?: string;
  threadId?: string;
  conversationIndex?: string;
  emailActivityId?: string;
  /** True when Category was set on the record (formula from party, or written erc_category for unmatched). */
  categoryAssigned?: boolean;
};

export type RenewalStatus = "Open" | "In progress" | "Completed" | "Overdue" | "Cancelled";

export type Renewal = {
  id: string;
  recordId: string;
  documentId?: string;
  documentName?: string;
  type: DocType;
  status: RenewalStatus;
  due?: string;
  completed?: string;
  risk: DocRisk;
  owner: string;
  notes?: string;
  reminderDate?: string;
  reminderCount?: number;
  escalation: "Not Escalated" | "L1" | "L2";
};

export type License = {
  id: string;
  recordId: string;
  type: DocType;
  name: string;
  party: string;
  partyId?: string;
  auth: string;
  issue: string;
  expiry: string;
  risk: DocRisk;
  owner: string;
  bu: string;
  buId?: string;
  status?: string;
  notified?: string;
  done?: string;
  daysRemaining?: number;
};

export type EmailAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  inline?: boolean;
  emailId?: string;
  localBody?: string;
  localBytesBase64?: string;
};

export type ThreadEmail = {
  id: string;
  subject: string;
  from: string;
  to: string;
  sentOn: string;
  direction: "Inbound" | "Outbound";
  preview: string;
  body: string;
  quoted?: string;
  attachmentCount: number;
  attachments?: EmailAttachment[];
  isReply: boolean;
  conversationIndex?: string;
};

export type IntakeEmail = {
  id: string;
  recv: string;
  from: string;
  to: string;
  subj: string;
  match: string;
  cat: Category;
  pri: Priority;
  owner: string;
  status: IntakeStatus;
  commId?: string;
  conversationIndex?: string;
  inReplyTo?: string;
  threadAction?: "Created" | "Attached";
};

export type Store = {
  source: DataSource;
  ready: boolean;
  error?: string;
  sla: SlaRule[];
  parties: Party[];
  comms: Communication[];
  docs: License[];
  renewals: Renewal[];
  intake: IntakeEmail[];
  files: EvidenceFile[];
  threadByComm: Record<string, ThreadEmail[]>;
  businessUnits: BusinessUnitRef[];
};
