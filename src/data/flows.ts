/**
 * Mirrors External Relations Power Automate cloud flows.
 * The app writes the Dataverse fields these flows listen to; it does not send the emails itself.
 */

/** To-recipient on Activity Parties. participationtypemask = 2 */
export const TO_RECIPIENT = 2;

/** Queue / mailbox party the create-communication flow checks as the To recipient. */
export const CENTRAL_MAILBOX_PARTY_ID = "13c7c1ce-a1a9-ef11-a8ba-000d3ab2c208";

/** erc_lifecyclestatus Closed */
export const LIFECYCLE_CLOSED = 4;

export const FLOWS = {
  createCommunication: {
    name: "External relations - Create new communication",
    trigger: "When a row is added on Emails",
    emailFilter: "_regardingobjectid_value ne null",
    activityPartyFilter: (activityId: string) =>
      `_activityid_value eq ${activityId} and _partyid_value eq ${CENTRAL_MAILBOX_PARTY_ID} and participationtypemask eq ${TO_RECIPIENT}`,
    partyLookup: (sender: string) => {
      const domain = (sender.split("@").pop() || "").replace(/'/g, "''").toLowerCase();
      return `(erc_domain eq '${domain}' or erc_domain eq '@${domain}' or endswith(erc_officialemail,'@${domain}')) and _erc_replyresponsible_value ne null and statecode eq 0`;
    },
    /** Create the communication only when the matched external party status is Active. */
    partyStatus: "Active",
  },
  /**
   * Runs when a communication row is added. Emails the responsible team.
   * Does not start the escalation chain.
   */
  notifyResponsibleTeam: {
    name: "External relations - Notify responsible team",
    trigger: "When a row is added on Communications (erc_communication)",
    /** Skip a communication that is already closed. */
    filter: "erc_lifecyclestatus ne 4",
    /**
     * Reply Responsible team on the external party: the team group mailbox,
     * every member, and the team administrator.
     * The party is read from the saved communication row.
     */
    teamLookup: "erc_externalparty / erc_replyresponsible",
  },
  autoEscalation: {
    name: "External relations - Automatic Communication Escalations",
    recurrence: "every 10 minutes",
    /**
     * The responsible team is already notified on create. This flow starts or
     * continues the chain only while the communication is still open.
     * First level only when the overdue text contains "Overdue" and the row was
     * created on or after the 22 Oct 2026 go-live cutoff. Later levels only when
     * erc_nextescalationon is set and due. The flow is saved as a draft and left off.
     */
    filter: "erc_lifecyclestatus ne 4 and (((erc_escalationstep eq null or erc_escalationstep eq 0) and contains(erc_isoverdue,'Overdue') and createdon ge 2026-10-22T11:20:00Z) or (erc_escalationstep gt 0 and erc_nextescalationon ne null and erc_nextescalationon le @{utcNow()}))",
  },
  manualEscalation: {
    name: "External relations - Communications Manual Escalation",
    triggerColumn: "erc_ismanuallyescalated",
    filter: "erc_ismanuallyescalated eq true",
  },
  captureClosed: {
    name: "External relations - Capture closed date and person",
    triggerColumn: "erc_lifecyclestatus",
    filter: "erc_lifecyclestatus eq 4",
  },
  /**
   * Email only. Threshold, renewal tasks, Reminder sent, and escalation stay in
   * runLicenseMonitor() (src/data/licenseLogic.ts + store.ts). Do not rebuild
   * those rules in Power Automate.
   */
  licenseNotificationEmail: {
    name: "External relations - Send license notification email",
    trigger: "When a row is added on Notifications (erc_notification)",
    filter: "_erc_licenseandcontract_value ne null",
    ownerTable: "systemusers",
    ownerEmailField: "internalemailaddress",
  },
} as const;

export function matchesAutoEscalationFilter(row: {
  isOverdue: boolean;
  status: string;
  escalationStep?: number;
  nextEscalationOn?: string;
}, now = new Date()) {
  if (row.status === "Closed") return false;
  const step = row.escalationStep || 0;
  if (step <= 0) return row.isOverdue;
  if (!row.nextEscalationOn) return false;
  const due = new Date(row.nextEscalationOn);
  return !Number.isNaN(due.getTime()) && due.getTime() <= now.getTime();
}
