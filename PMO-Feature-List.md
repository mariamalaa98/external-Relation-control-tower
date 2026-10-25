# External Relations Control Tower — Phase 1

**Product:** Andalusia Pulse — External Relations Control Tower  
**Prepared for:** PMO  
**Date:** 29 September 2026

Phase 1 is the live control tower: mailbox, communications, SLA, escalation, external parties, and licenses and renewals.

On every page except Admin Configuration, the user can filter by Business Unit and Department.

The Excel copy of this list is `PMO-Feature-List.xlsx`.

---

## Phase 1 pages

### Executive Dashboard

One view of the live external-relations position.

- Total communications, in progress, overdue, and SLA compliance
- Renewals due within 90 days, expired licenses, and unread notices
- Communications by category, including unassigned
- SLA mix: Within SLA, At risk, and Breached
- A list of records missing owner, party, category, due date, SLA, expiry, or party contact
- Each figure opens the related page. Refresh reloads Dataverse

### My Pending Actions

The queue of communications that still need work.

- Communications that are In Progress or not yet escalated
- Search by ID, party, subject, or owner
- Filters for category, lifecycle status, and SLA
- Open a communication, or create a new one

### Central Mailbox

Turn inbound email into a tracked communication.

- Emails sent to the central mailboxes
- Received time, sender, recipient, subject, and status: New, In Review, or Routed
- Whether the email created a new case or was attached to an existing thread
- Matched external party, or Unmatched when the sender is not on the party master
- Process and route: confirm party, category, priority, owner, supervisor, and business unit

### Communication Tracker

The full register of external communications.

- Every communication: ID, party, category, subject, owner, priority, due date, status, overdue, and escalated
- Search, and filters for category, lifecycle (In Progress / Closed), and SLA (Within / At Risk / Breached)
- Open a record to see the case, email thread, attachments, timeline, and evidence
- Respond, close with a comment, reopen with a reason, or escalate once
- Copy a link that opens this communication directly
- Due date and overdue are calculated in Dataverse (created time plus 2 hours)

### Legal Cases Notification

The same register, limited to legal matters.

- Only communications where Category is Legal
- Case reference, party, subject, owner, priority, received date, due date, status, overdue, and escalated
- Open the same communication record used by the tracker

### License and Contract Tracker

The register of licenses, contracts, and permits.

- Document number, type, name, external party, issuing authority, issue date, and expiry
- Days remaining, risk, renewal status, reminder sent, overdue, escalated, owner, business unit, and department
- Counts for active, expiring within 90 days, expired, and escalated
- Filters for type, lifecycle, renewal status, risk, and active or inactive
- Create a document, upload its file, renew it, and run the expiry monitor
- Risk follows the expiry date: Critical when expired, High under 30 days, Medium 30 to 90 days, Low after 90 days

### Renewal Calendar

When documents expire, and how urgent they are.

- Month calendar of expiry dates, colored by urgency: under 30 days, 30 to 90 days, and over 90 days
- List of all documents, sorted by expiry
- Risk matrix: High, Medium, and Low against those three time bands
- Renewal tasks created by the expiry monitor, with reminder count and escalation level

### External Party Master

The organizations used to match inbound email.

- Party name, category, official email, domain, business unit, department, criticality, and status
- Status is Draft, Active, or Inactive. A new party is saved as Draft
- Domain is required so the mailbox can match the sender
- How many communications are linked to each party

### Escalation Center

Cases and documents that have missed their date.

- Communications tab: overdue and already escalated cases, with owner, due date, and whether escalation was automatic or manual
- Automatic escalation runs every 10 minutes for open, overdue communications that are not yet escalated
- Manual escalation runs once per case and requires a reason
- Licenses tab: expired documents that have not been renewed, with a one-time escalation

### Notification Center

The log of license reminder, expiry, and escalation events.

- Notices of type Reminder, Expiry, and Escalation
- Filter by type and by read or unread
- Open the license or contract the notice belongs to
- Run the expiry monitor, which creates the renewal task and the notice when a document enters its reminder window (default 120 days)

### Admin Configuration

The SLA rules the communications are matched against.

- SLA name, category, priority, acknowledgement hours, and resolve days
- Whether the target is working days, calendar days, or hours
- Whether the rule is active
- This page is a view of the SLA matrix. Due date and overdue on a communication are formula columns in Dataverse

---

## Not part of Phase 1

| Page | Why it is outside Phase 1 |
| --- | --- |
| Document Archive | File store for communication evidence and license documents. This was the next cycle after the live control tower. |
| Communication Audit | Read-only 24-hour response compliance, supervisor and executive escalation, and CSV export. |
| Notification Audit | Renewal-cycle compliance, the 120-day notification window, weekly completions, and CSV export. |
| Power BI Reports | The page shows live counts today. A published Power BI report is embedded when the workspace report is ready. |
