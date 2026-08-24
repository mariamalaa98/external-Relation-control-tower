export const CATS = ["Government", "Insurance", "Regulatory", "Legal", "Corporate", "Partner"] as const;
export const PRIS = ["Critical", "High", "Medium", "Low"] as const;
export const BUS = [
  "Andalusia Hospital – Smouha",
  "Andalusia Hospital – El Maadi",
  "Andalusia Hospital – Shallalat",
  "Group – Head Office",
] as const;

export type Category = (typeof CATS)[number];
export type Priority = (typeof PRIS)[number];
export type CommStatus = "Open" | "In Progress" | "Pending Evidence" | "Closed";
export type SlaState = "Within" | "At Risk" | "Breached";

export type SlaRule = {
  category: Category;
  priority: Priority;
  ackHours: number;
  resolveDays: number;
  basis: "Working days" | "Calendar days";
};

export type Party = {
  id: string;
  name: string;
  category: Category;
  email: string;
  domain: string;
  bu: string;
  owner: string;
  criticality: "High" | "Medium" | "Low";
  status: "Active" | "Inactive";
};

export type Communication = {
  id: string;
  party: string;
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
  resp?: string;
  respAction?: string;
  ev?: number;
};

export type License = {
  id: string;
  type: "License" | "Contract" | "Permit";
  name: string;
  party: string;
  auth: string;
  issue: string;
  expiry: string;
  risk: "High" | "Medium" | "Low";
  owner: string;
  bu: string;
  status?: string;
  notified?: string;
  done?: string;
};

export type Store = {
  sla: SlaRule[];
  parties: Party[];
  comms: Communication[];
  docs: License[];
};
