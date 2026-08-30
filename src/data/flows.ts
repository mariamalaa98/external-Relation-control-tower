/**
 * Mirrors the four External Relations Power Automate cloud flows.
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
    partyLookup: (sender: string) => `erc_officialemail eq '${sender.replace(/'/g, "''")}'`,
  },
  autoEscalation: {
    name: "External relations - Automatic Communication Escalations",
    recurrence: "every 10 minutes",
    /** Overdue formula (Created On + 2 hours) AND not yet locked AND not Closed. */
    filter: "erc_isoverdue eq true and erc_isescalated ne true and erc_lifecyclestatus ne 4",
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
} as const;

export function matchesAutoEscalationFilter(row: {
  isOverdue: boolean;
  isEscalated: boolean;
  status: string;
}) {
  return row.isOverdue && !row.isEscalated && row.status !== "Closed";
}
