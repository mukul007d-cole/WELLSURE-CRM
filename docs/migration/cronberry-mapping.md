# Cronberry → Falcon Migration Mapping (v1)

Based on the supplied real export header described as 120 columns. This document
is a disposition ledger, not executable migration logic. Wellsure-specific field
names are seed/import configuration and must not become hardcoded application
behavior.

## 1. Matching / deduplication priority (ADR-0004)

1. `audience_id` — exact match, highest priority.
2. Marketplace seller ID — the authoritative source column is open between
   `pcid` and `seller_merchant_token`.
3. `gst_number` plus normalized `mobile`.
4. Normalized `mobile` alone.
5. Manual duplicate-review queue.

`gst_number` is one-to-one with a marketplace account per ADR-0002. It remains
paired with phone during migration for safety.

## 2. Security and unused-data exclusions

| Source column | Disposition | Reason |
|---|---|---|
| `pass` | **Exclude before staging persistence** | Plaintext source credential. It must never be imported, logged, placed in reject exports, copied into JSON, or stored anywhere in Falcon. |
| `android_fcm_token` | Exclude | Confirmed unrelated/unused. |
| `ios_fcm_token` | Exclude | Confirmed unrelated/unused. |
| `web_fcm_token` | Exclude | Confirmed unrelated/unused. |

Import ingestion must drop excluded columns before durable staging and redact
them from structured logs and error payloads.

## 3. Complete source-column disposition ledger

“Configurable field” below means a Field record plus value imported through the
field-builder mapping. It does not mean adding a source-specific database
column. Sensitive values are still filtered in the API by `field_visibility`.

### 3.1 Relational/core data

| Source column(s) | Falcon destination / transformation |
|---|---|
| `email` | `leads.email`; trim and normalize for matching/search without overwriting the original migration evidence. |
| `name` | `leads.name`. |
| `mobile` | `leads.phone`; normalize for deduplication. |
| `alternate_mobile_number` | Configurable alternate-contact Field on the Lead. |
| `address` | Configurable address Field on the Lead. |
| `city` | Configurable city Field on the Lead. |
| `state` | Configurable state Field on the Lead. |
| `pincode`, `postcode` | Merge into canonical configurable `pincode`. They have the same purpose with regional naming differences; log conflicts when both non-empty values differ. |
| `gst_number` | Configurable business-identity Field with an index suitable for deduplication; do not couple application behavior to this seed key. |
| `entry_date` | `leads.created_at`, preserving the source timestamp and recording import time separately on the import job. |
| `lead_update_date` | `leads.updated_at`, preserving the source timestamp. |
| `lead_status` | Resolve to the configured Status of the applicable `process_instance`; unknown values enter validation/review rather than creating hidden logic. |
| `company_name`, `company` | Merge into canonical configurable `company_name`; prefer the non-empty value and log differing populated values. |
| `pancard_details` | Sensitive configurable Field. Seed visibility only for Finance/Compliance-equivalent roles; API allow-list enforcement is mandatory and role names remain configurable. |

### 3.2 Assignment and task/history data

| Source column(s) | Falcon destination / transformation |
|---|---|
| `Lead Owner` | Current `assignments` row for the imported process instance using the configured Lead Owner assignment type. |
| `Prev Lead Owner` | Non-current historical `assignments` row where resolvable; retain unresolved source identity in import evidence and flag it for review. |
| `lead_reassign` | Historical import reference only. Native Falcon reassignment count is derived from append-only `activity_logs`; no maintained counter is created. |
| `sales_associate` | Current typed `assignments` row. |
| `team_leader` | Current typed `assignments` row. |
| `operations_associate` | Current typed `assignments` row. |
| `secondary_user_email_idops` | Current secondary Ops collaborator `assignments` row after user resolution. |
| `secondary_user_email_idsales` | Current secondary Sales collaborator `assignments` row after user resolution. |
| `secondary_user_id_account_management` | Current secondary Account Management collaborator `assignments` row after user resolution. |
| `b2b_registration_done_by` | Typed assignment/history reference on the applicable process instance after user resolution. |
| `lead_followdate`, `lead_last_followdate` | Task due-date/history inputs. Preserve both source values in import evidence; create Tasks only according to the approved import rule and never silently discard a conflict. |
| `weekly_task` | Tasks module as an imported free-text/recurring task note. Recurrence behavior must be configured rather than inferred from the column name. |

Assignment-type labels are imported configuration values, not schema enums. An
unresolved source user must not be silently assigned to the importer or another
user.

### 3.3 Finance data

| Source column | Falcon destination / transformation |
|---|---|
| `invoice_customer_name` | `invoices.customer_name`. |
| `invoice_date` | Invoice issue date (add to the concrete Invoice migration schema). |
| `invoice_due_amount` | `invoices.due_amount`. |
| `invoice_due_date` | `invoices.due_date`. |
| `invoice_number` | `invoices.invoice_number`. |
| `invoice_partial_payment` | Payment/import evidence used to reconcile Payment rows and invoice balance; conflict-check against other paid/pending columns. |
| `invoice_status` | `invoices.status` after validation against configured import mapping. |
| `invoice_total_amount` | `invoices.total_amount`. |
| `payment_received` | `payments.amount_paid` or aggregate reconciliation evidence when the export lacks transaction-level detail. |
| `pending_amount` | Reconciliation input for outstanding balance; do not maintain an independent value that can drift from invoices/payments. |
| `seller_payment_date` | `payments.payment_date` when a corresponding payment can be formed. |
| `seller_paid_amount_exgst` | Payment/reconciliation evidence, preserving its ex-GST meaning. |

Amounts and dates that cannot form a consistent invoice/payment record enter a
review queue. The import must not fabricate transaction detail.

### 3.4 Activity-log transformation

| Source column(s) | Falcon destination / transformation |
|---|---|
| `Remarks` | Parse into backdated `activity_logs` rows. Known configured Status text becomes `status_change`; other text becomes `comment`. Set `source = migrated_cronberry_remark`. |
| `cr_call_date`, `cr_call_duration`, `cr_call_status`, `cr_call_type`, `cr_campaign_name`, `cr_recording_duration`, `cr_recording_url` | Combine the fields belonging to a source call into a historical `comment` activity with `source = migrated_cronberry_call_log`. Preserve `cr_recording_url` as a reference URL; do not download or re-host recordings in V1. |
| `ops_last_comments` | Backdated/imported `comment` activity with a source discriminator and original text. |
| `sales_comments` | Backdated/imported `comment` activity with a source discriminator and original text. |
| `additional_comments` | Backdated/imported `comment` activity with a source discriminator and original text. |

`Remarks` lines split on `<br/>`; each line extracts timestamp, actor text in
parentheses, and body. Actor names are resolved to Users when unambiguous and
otherwise retained as migration evidence with a nullable actor. The fixed action
taxonomy remains `comment`, `status_change`, `reassignment`, and `field_edit`.

### 3.5 Attachment transformation

| Source column(s) | Falcon destination / transformation |
|---|---|
| `supporting_documents_2`, `supporting_documents_link1` | Merge into one Attachment list; deduplicate identical references and log conflicting metadata. |
| `new_audit_records_link` | Attachment/reference entry associated with the Lead, subject to permission-checked access. |
| `ungatting_docs` | Attachment/reference entry associated with the Lead, subject to permission-checked access. |
| `file_name` | **Open:** likely attachment metadata, but its relationship to a file/link is not confirmed. Keep in staged import evidence only until data-team review. |

### 3.6 Configurable fields

| Source column(s) | Canonical configurable-field disposition |
|---|---|
| `abandon_cart` | Import as configurable Field. |
| `brands` | Import as configurable Field. |
| `business_category` | Import as configurable Field. |
| `business_type` | Import as configurable Field. |
| `audit_date` | Import as configurable milestone-date Field. |
| `current_active_listings` | Import as configurable Field. |
| `fba_launched_flag` | Import as configurable Field. |
| `fba_launched_date` | Import as configurable milestone-date Field. |
| `gms_slab` | Import as configurable Field. |
| `total_gms_b2b` | Import as configurable Field. |
| `hvs_tagging_status` | Import as configurable Field; the key has no hardcoded behavior. |
| `inventory_management_status` | Import as configurable Field, not a process Status. |
| `paid_service_status` | Import as configurable Field. |
| `paid_services_type` | Import as configurable Field and use the approved value mapping to seed applicable `lead_services` enrollment; unknown values require review. |
| `reactivation` | Import as configurable Field. |
| `registration_date` | Import as configurable milestone-date Field. |
| `renewal_count` | Import as informational configurable Field; no renewal engine in V1. |
| `seller_followup_freq_am_ops` | Import as configurable Field. |
| `seller_paid_plan` | Import as informational configurable Field. |
| `seller_renewal_date` | Import as informational configurable date Field; no renewal engine in V1. |
| `seller_type` | Import as configurable Field. |
| `suspension_status` | Import as configurable Field, not a process Status unless Wellsure separately configures such a mapping. |
| `tag` | Import as configurable Field. |
| `product_quantity` | Import as configurable Field. |
| `total_business_in_past_history` | Import as configurable Field. |
| `launch_date` | Import as configurable milestone-date Field. |
| `first_pitch_done` | Import as configurable Field. |
| `appeal_submission_date` | Import as configurable milestone-date Field. |
| `ungatting_approval_date` | Import as configurable milestone-date Field. |
| `upgrade_amount` | Import as informational configurable Field; it does not extend V1 finance workflow. |
| `product_name`, `product_names` | Merge into canonical configurable `product_names`, capable of representing multiple products; log conflicts. |
| `client_reprsentative_name`, `clients_representative_name` | Merge into canonical configurable `client_representative_name`. Prefer the non-empty value; if both differ, use the value from the more recently updated source record and log the conflict. |
| `lead_source` | Import as configurable source Field, pending reconciliation with `source_name`. |
| `medium` | Import as configurable source/attribution Field. |

### 3.7 Import/system metadata

| Source column | Falcon destination / transformation |
|---|---|
| `audience_id` | Immutable legacy-source identifier in import/migration metadata and ADR-0004 dedup priority 1. |
| `lead_count` | Import metadata/historical reference; not a maintained Lead counter unless its meaning is separately confirmed. |
| `updated` | **Open:** likely redundant with `lead_update_date`; retain only in staged import evidence until confirmed. |

### 3.8 Columns awaiting data-team review

These columns have a deliberate staged disposition but no finalized Falcon
mapping. They are blocking for the import mapping, not for the Phase 0 docs.

| Source column(s) | Open question / provisional treatment |
|---|---|
| `pcid`, `seller_merchant_token` | Which is the authoritative marketplace seller ID for ADR-0004 priority 2, or do they represent different concepts? Retain both in staging. |
| `seller_status`, `lead_status` | Determine whether they duplicate the one process Status or whether `seller_status` is a separate account-health Field. Do not merge yet. |
| `source_name`, `lead_source` | Determine whether they duplicate/overlap and establish conflict precedence. Do not merge yet. |
| `quotation_total_amount`, `quotation_customer_name`, `quotation_date`, `quotation_expiry_date`, `quotation_number` | V1 has no quotation module under ADR-0003. Proposed disposition is informational configurable Fields, but this remains a scope decision. |
| `issue` | Determine whether this is distinct from the seed Status named “Issue.” Retain in staging; do not infer from the matching label. |
| `is_shared` | Define whether this represents assignment/ownership sharing or another concept. |
| `amount` | Too generic to map safely to a financial concept. |
| `form_steps` | Purpose and V1 relevance are unknown. |
| `cart_add_date` | Purpose and V1 relevance are unknown. |
| `domain` | Purpose and V1 relevance are unknown. |
| `order_date` | Purpose and V1 relevance are unknown. |
| `order_id` | Purpose and V1 relevance are unknown. |
| `order_status` | Purpose and V1 relevance are unknown. |
| `retained_by` | Define whether this is an assignment type or another historical attribute. |
| `file_name` | Define the associated source file/reference and whether it is attachment metadata. |
| `updated` | Confirm relationship and precedence versus `lead_update_date`. |
| `message` | Purpose and V1 relevance are unclear. It may be legacy notification/SMS content, but no behavior or destination may be inferred from its generic name. Retain only in access-controlled staging pending data-team review. |

## 4. Coverage result and import gates

A programmatic cross-check of this ledger against the complete export header—not
a sample of source rows—confirms that all 120 source columns now have a
disposition. The final missing header was `message`; it has an explicit open
mapping decision rather than a guessed destination. Header coverage is complete,
while the substantive questions in `docs/requirements/open-decisions.md` still
block final import mapping where noted.

**Scope note (ADR-0016).** The requirements below describe the *Cronberry
migration run*, not the general bulk-import feature built in phase 15. That
feature is a synchronous, single-file CSV flow (`POST /leads/import/*`) capped
at 5,000 rows; the migration is expected to be performed by mapping a
cleaned-up export through it, in batches, the same way any admin imports a CSV.
Resumability, idempotent batching and 100,000-row load validation attach to the
migration and remain open. Preview-before-commit, immutable counts,
permission-safe error reporting and the exclusion of security data are already
provided by the feature.

Before implementation, the migration must provide:

- immutable source/staged/inserted/updated/duplicate/rejected counts;
- preview and validation before commit;
- resumable, idempotent batches;
- a conflict record for every non-identical canonical merge;
- permission-safe error exports with excluded security data absent;
- normalized deduplication evidence showing which ADR-0004 rule matched;
- real-sample and synthetic malformed/duplicate tests; and
- load validation for a resumable 100,000-row import without blocking normal
  interactive traffic, per `docs/testing/quality-gates.md`.

## 5. Status behavior mapping

The example `behavior_type` assignments in
`docs/workflows/journey-definitions.md` remain unverified assumptions. Migration
may match source status text to configured Status records only after Wellsure
approves the seed mapping. It must not infer task creation or archival behavior
from a source string.
