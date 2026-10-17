# Cronberry export verification — September 2026 sample

A check of one month of real Cronberry data against
`docs/migration/cronberry-mapping.md` and against what the bulk importer
(phase 15, ADR-0016) can actually carry. The question was whether this export
can be mapped into Falcon perfectly.

**Verdict: not as exported, and not through the importer alone.** The file is
structurally clean, and most columns map. But three things block a faithful
migration, and a few columns are not what their names say:

1. **The export has no phone numbers.** `Mobile` is empty in every row.
2. **Owner and associate columns hold people's names, and the importer needs
   email addresses.**
3. **The importer cannot carry history.** That covers original creation dates,
   previous owners, and the 4,266 timestamped `Remarks` entries.

Every number below was computed from the file. No row of it is reproduced
here: the file holds real personal data and, in 242 rows, plaintext
credentials. It must not enter the repository (`AGENTS.md`).

---

## 1. The file

| Property | Value |
| --- | --- |
| Rows | 2,822 |
| Columns | 121 (the ledger was written against 120) |
| Ragged rows | 0 — every row has 121 cells |
| Encoding | ASCII, standard CSV quoting. 244 `brands` cells and 256 `Remarks` cells contain line breaks inside quotes |
| `entry_date` range | 1–30 September 2026: one month, as described |
| `audience_id` | Present and unique in every row, all 13 digits |
| `source_name` | `API (API)` in every row |

**Dates are `dd-mm-yyyy HH:MM`.** In 6,194 date cells the first part exceeds 12
and the second part never does, so day-first is certain. `Remarks` timestamps
use a different format, `yyyy-mm-dd HH:MM:SS`.

## 2. Against the mapping ledger

### Header coverage

Two header names are not in the ledger as written:

- **`Mobile`**, capitalised. The ledger says `mobile`. It is empty either way;
  see §3.1.
- **`mtn_merchant_token`**, which is new and is the 121st column. It is
  populated in 429 rows, with 413 distinct values. It is now recorded in the
  ledger's open-questions table.

### Columns that are not what their names say

These contradict assumptions in the ledger or in ADR-0004. Per `AGENTS.md` they
are flagged here, not resolved.

| Column | What the name suggests | What it holds |
| --- | --- | --- |
| `seller_merchant_token` | A per-seller marketplace ID (ADR-0004 priority 2) | Five values across 427 rows: `P1`, `P2`, `P3`, and bracketed `[P1]`, `[P2]`. A priority tier, not an identifier. **It cannot be a deduplication key.** |
| `mtn_merchant_token` | — (new) | 413 distinct values in 429 rows. This, or `pcid` (428 distinct in 446 rows), is the plausible marketplace ID. |
| `suspension_status` | An account suspension state | Two staff first names, in four spellings, in 419 rows. An assignment-like attribute, not a status. |
| `fba_launched_flag` | A yes/no flag | Revenue bands: `1L-2L`, `50k-1L`, `25k-50k`. |
| `brands` | Brand names | Brand names with an 11-digit number appended, often on a second line, in a few formats. |
| `team_leader` | Free text | Three people, written six ways (bracketed and unbracketed). |

### Columns that are entirely empty in this month

66 of the 121 columns are empty in every row, including every `invoice_*`,
`quotation_*`, `cr_call_*` and `order_*` column, `city`, `company`,
`company_name`, `pancard_details`, `hvs_tagging_status` and `weekly_task`. They
need no mapping for this file. Empty for one month does not mean unused, so
the full-history export should be profiled the same way before they are
dropped.

## 3. Blockers

### 3.1 No phone numbers

`Mobile` is empty in all 2,822 rows. `alternate_mobile_number` is filled in 55.

Two consequences:

- Leads arrive with no primary phone. For a sales CRM worked by phone, that is
  most of the record's value.
- ADR-0004 priorities 3 and 4 (GST + phone, phone alone) cannot match
  anything. Only 589 rows (21%) carry any of `gst_number`, `pcid` or
  `mtn_merchant_token`. For the other 79%, `audience_id` is the only key.

**Action:** re-export with the mobile number included. The column exists in the
header, so this is most likely an export setting or a field permission on the
Cronberry side. Do not migrate without it.

### 3.2 People are named, not emailed

The importer's assignment columns resolve a **user's email address**, and it
rejects a row whose email matches no user. It never falls back to the importer
or a default owner, which is correct. Cronberry writes people's **names**:

| Column | Distinct people |
| --- | --- |
| `Lead Owner` (every row) | 87 |
| `Prev Lead Owner` | 76 (12 not among current owners) |
| `sales_associate` | 94 (60 not among current owners) |
| `operations_associate` | 19 |
| `team_leader` | 3 |
| `b2b_registration_done_by` | 4 |
| `Remarks` actors | 74 |
| **All of the above, combined** | **176** |

`secondary_user_email_idops` and `secondary_user_email_idsales` are already
emails.

**Action:** before import, build a name → email table for every person who
should become a Falcon user, and rewrite those columns to emails. Anyone left
off the table, such as people who have left, needs an explicit decision. Either
their leads go to a named successor, or the column is skipped for those rows.

### 3.3 History the importer cannot carry

The importer creates a lead, its process instance, its current status, its
current assignments and its field values, and nothing else. The ledger asks for
more:

| Source | Ledger wants | The importer does |
| --- | --- | --- |
| `entry_date` | `leads.created_at`, preserved | Sets the import time. Every lead would look created on migration day. |
| `lead_update_date` | `leads.updated_at`, preserved | Sets the import time. |
| `Prev Lead Owner` | A historical assignment row | Nothing. There is no historical assignment target. |
| `Remarks` | Backdated `activity_logs` rows | Nothing. There is no activity-log target. |
| `lead_followdate`, `lead_last_followdate` | Task inputs | Nothing. There is no task target. |

`Remarks` itself parses perfectly. Splitting on `<br/>`, as the ledger
specifies, yields **4,266 entries with zero parse failures**, every one in the
form `yyyy-mm-dd HH:MM:SS :- <body> (<actor>)`. The line breaks inside cells
fall within entry bodies, such as lists of product IDs, and are not
separators. The ledger's rule is right. Only the importer cannot act on it.

**Action, as a decision for Wellsure:** either

- **accept the loss for the first migration.** Import each history column into
  a read-only text Field, so nothing is lost, only flattened. Use one Field
  for the remarks, one for the original entry date, and one for the previous
  owner. Or
- **build the dedicated migration step** the ledger and ADR-0016 already
  anticipate (`cronberry-mapping.md` §4), which writes backdated timestamps,
  history rows and activity logs. That is development work, not configuration.

### 3.4 Statuses

There is no Journey column. Every row must be assigned a Journey before import,
because the importer takes one Journey per file.

`lead_status` has 18 values. The importer matches them case-insensitively
against the Journey's configured Status names and keys, and rejects a row whose
status matches nothing. Compared with the seed list in
`docs/workflows/journey-definitions.md`:

| In the export | Rows | Matches a seed Status? |
| --- | --- | --- |
| Interested | 2,310 | yes |
| Not Interested, Launched, Pending For Launch, Pitch In Progress, Unable to Launch, Transfer To FBA, Issue, Registration Done, Working | 344 combined | yes |
| Ungating Applied | 91 | **no** |
| Ungatting Resubmission Done | 30 | **no** |
| Rework | 26 | **no** |
| Ungatting Approved | 11 | **no** |
| Black listed | 6 | **no** — the seed spells it `Blacklisted` |
| Ready For Audit | 2 | unclear — the seed row reads "Ready For Ungatting / Ready For Audit" |
| Ungating ReSubmission Required | 1 | **no** |
| `Ready For launch  Audit Done` (two spaces) | 1 | **no** — and the importer does not collapse inner spaces |

Note "Ungating" against "Ungatting": both spellings occur.

**Action:** for each Journey, configure Statuses for every value it will
receive, or normalise the values in the file to the configured names. That is
a mapping for Wellsure to approve (`cronberry-mapping.md` §5), not one to
guess.

### 3.5 Rows with nothing in them

182 rows have no `name`, and the importer rejects every one. 174 of those carry
no name, email, GST, `pcid`, merchant token or alternate phone either. They have
only an owner, a status (171 are `Interested`) and timestamps. They look like
empty API-created placeholders.

**Action:** decide whether to drop them or import them under a placeholder name.
Dropping is the likely answer. The other 8 nameless rows do carry an identifier
and need a name supplied.

## 4. Values that need cleaning before import

The importer stores `date` and `select` values as given, checking only that
they are strings. So none of the following would be rejected. All of them
would import and then misbehave.

| Problem | Where | Effect if imported as-is |
| --- | --- | --- |
| `dd-mm-yyyy HH:MM` dates | 10 date columns | Date filters compare the stored text, so `13-09-2026` sorts and filters wrongly. **Convert to `yyyy-mm-dd`.** |
| Bracketed and unbracketed duplicates (`[No]` / `No`, `[P1]` / `P1`, `[Inventory Managed]` / `Inventory Managed`), and an empty `[]` | `reactivation`, `seller_merchant_token`, `inventory_management_status`, `team_leader`, `seller_type`, `lead_source`, `gms_slab` | One option becomes two, and filters miss half the rows. **Strip the brackets; treat `[]` as blank.** |
| HTML entities (`&lt;15k`) | `gms_slab`, `brands`, `address` | Shown literally. **Decode.** |
| Case variants of one value | `suspension_status`, `team_leader` | Two options for one value. **Normalise case.** |
| `lowercase` GST | 1 row | Fails a GST pattern rule. **Uppercase, then validate.** 539 of 544 GST numbers pass the format and checksum test. 5 do not, and need review. |

## 5. Duplicates inside the file

Measured on the identifiers, after trimming and uppercasing:

| Identifier | Values shared by more than one row | Rows involved |
| --- | --- | --- |
| `gst_number` | 17 | 35 |
| `email` | 25 | 51 |
| `pcid` | 12 | 30 |
| `mtn_merchant_token` | 10 | 26 |
| `audience_id` | 0 | 0 |

These are not simple repeats. Within a shared `pcid` or merchant token, no
group has the same status or owner throughout, and most have different names.
This is consistent with one seller being worked in more than one Journey.
Falcon models that as one Lead with several process instances. **The importer
cannot produce that.** It skips a matching row rather than attaching a second
Journey to the existing Lead (ADR-0016, "Duplicates are skipped"). Whichever
match key is chosen, these sellers either arrive as separate Leads (no key) or
lose their second Journey (a key).

**Action:** Wellsure confirms what these groups are. If they are one seller in
several Journeys, either accept separate Leads for the first migration, or
include the attach-to-existing behaviour in the migration step from §3.3.

## 6. Security

`pass` is filled in **242 rows**, with 30 distinct plaintext values. The ledger
requires it be excluded before anything persists, and the importer persists
nothing from a skipped column. **But the importer's analyze step returns three
sample values for every column to the browser**, for the mapping screen. If the
raw export is uploaded, plaintext passwords appear on the administrator's
screen.

**Action:** strip `pass`, and the three empty FCM token columns, from the file
before it is uploaded. Delete the original export once the migration is done.

## 7. What maps cleanly

Not everything is a problem. These map as the ledger says, after the cleaning in
§4:

- `audience_id` → a text Field, and the match key for every later batch. It is
  the only identifier present in every row.
- `name`, `email` → core lead columns (2,640 and 617 rows).
- `gst_number`, `pcid`, `mtn_merchant_token`, `alternate_mobile_number`,
  `address`, `brands` → Fields.
- The milestone dates (`audit_date`, `launch_date`, `registration_date`,
  `appeal_submission_date`, `ungatting_approval_date`) → date Fields, once
  converted.
- The categorical columns (`reactivation`, `seller_status`, `seller_type`,
  `gms_slab`, `inventory_management_status`, `first_pitch_done`,
  `current_active_listings`, `lead_source`) → select or number Fields.
- `lead_count`, `lead_reassign` → number Fields holding historical reference
  values, not maintained counters (ledger §3.2, §3.7).
- `additional_comments`, `sales_comments` → textarea Fields, or comments in the
  migration step.
- 2,822 rows is within the importer's 5,000-row limit. A full-history export
  will need batches, and `audience_id` as the match key is what makes those
  batches safe to re-run.

## 8. Before the migration

In order. Every item is either an export, a decision, or a cleaning rule.

1. **Re-export with phone numbers** (§3.1), and confirm the full-history export
   has the same 121-column header.
2. **Decide the history question** (§3.3): flattened Fields now, or the
   migration step first.
3. **Decide the Journey for every row** (§3.4), and approve the
   status-value → Status mapping per Journey.
4. **Build the people table** (§3.2): 176 names to emails, or to an explicit
   "no user" decision.
5. **Confirm the meaning** of `seller_merchant_token`, `mtn_merchant_token`,
   `pcid`, `suspension_status` and `fba_launched_flag` (§2). Choose the
   marketplace ID for ADR-0004 priority 2. `seller_merchant_token` is ruled
   out by the data.
6. **Decide the empty rows** (§3.5) and the **duplicate groups** (§5).
7. **Configure Falcon to match:** Journeys, Statuses, Fields, and users, all
   in the admin UI.
8. **Clean the file** (§4, §6). Strip `pass` and the FCM tokens, convert dates,
   strip brackets, decode entities, normalise case, map names to emails, and
   split it by Journey.
9. **Preview every file** in the importer and read every rejected row. Then
   commit, with `audience_id` as the match key.

Steps 1–6 need people at Wellsure, not code. Step 8 is a script worth writing
once and running on every export, since the same rules apply to the full
history.
