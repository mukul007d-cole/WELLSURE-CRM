# Cronberry → Falcon Migration Mapping (v1)

Based on the real export sample (120 columns, live production data).

---

## 1. Matching / Deduplication Priority (Gate G — confirmed)

1. `audience_id` (Cronberry's internal record ID) — exact match, highest priority
2. Marketplace seller ID / `seller_merchant_token`
3. `gst_number` + normalized `mobile`
4. Normalized `mobile` alone
5. Manual duplicate review queue

`gst_number` is 1:1 with a marketplace account (confirmed) — so GST match alone is close to authoritative, but still paired with phone for safety.

---

## 2. Fields Excluded From Migration — Do Not Import

| Column | Reason |
|---|---|
| `pass` | **Plaintext password in the source export.** Never migrated, never stored in Falcon under any field. Security-critical exclusion, not a judgment call. |
| `android_fcm_token`, `ios_fcm_token`, `web_fcm_token` | Confirmed unused/unrelated — belongs to no active app. Dropped entirely. |

---

## 3. Fields Requiring Reconciliation (real duplicates/typos in Cronberry itself)

| Duplicate columns | Resolution |
|---|---|
| `client_reprsentative_name` / `clients_representative_name` | Merge into one canonical field: `client_representative_name`. Prefer whichever is non-empty; if both populated, prefer the more recently updated record's value and log the conflict. |
| `product_name` / `product_names` | Merge into one canonical field: `product_names` (plural, since a seller can carry multiple products). |
| `supporting_documents_2` / `supporting_documents_link1` | Merge into a single `documents` attachment list rather than two separate fields — matches the general Attachment model rather than ad-hoc link fields. |

---

## 4. Special Transformation — Activity Log Parsing

`Remarks` in the source export is a single text blob containing Cronberry's entire comment/status history, e.g.:

```
2026-07-30 14:55:19 :- Registration Done (Meenakshi Nigam)<br/>
2026-07-30 14:56:17 :- Ready For Ungatting (Meenakshi Nigam)
```

**Migration must parse this**, not copy it as one field. Split on the `<br/>` delimiter, then on each line extract: timestamp, actor name (in parentheses), and remaining text as the comment/status-change body. Each parsed entry becomes one row in `activity_logs` (not a fresh comment — backdated to its original timestamp, so history stays accurate). Lines matching a known status name become `action_type = status_change`; everything else becomes `action_type = comment`.

`cr_call_*` fields (call date/duration/status/type/campaign/recording URL) migrate the same way — each becomes a historical `activity_logs` entry of type `comment` (call log), even though live call/IVR integration itself is deferred to post-V1.

---

## 5. Real Column → Falcon Field Mapping (high-level groups)

| Source columns (examples) | Falcon destination |
|---|---|
| `name`, `email`, `mobile`, `alternate_mobile_number`, `address`, `city`, `state`, `pincode`/`postcode` | Core Seller fields |
| `company`, `company_name`, `business_type`, `business_category`, `gst_number`, `pancard_details` | Seller business-identity fields |
| `audience_id`, `entry_date`, `lead_source`, `source_name`, `medium` | Migration/system metadata + Lead source fields |
| `lead_status` | Maps to the single Status field (confirmed model) on the relevant Journey |
| `Lead Owner`, `Prev Lead Owner`, `lead_reassign`, `sales_associate`, `team_leader`, `operations_associate`, `secondary_user_email_idops`, `secondary_user_email_idsales`, `secondary_user_id_account_management` | Assignment fields — Lead Owner (current), reassignment history (count + prior owner), plus role-specific assignment fields matching the real handoff chain |
| `registration_date`, `launch_date`, `fba_launched_flag`, `fba_launched_date`, `audit_date`, `ungatting_approval_date`, `appeal_submission_date` | Journey/service milestone date fields |
| `invoice_*`, `quotation_*`, `payment_received`, `pending_amount`, `seller_paid_amount_exgst`, `seller_paid_plan`, `seller_renewal_date`, `renewal_count`, `upgrade_amount` | Finance module (Invoices + Payments/Outstanding — matches confirmed V1 scope) |
| `cr_call_*` | Historical activity log entries (call records) |
| `Remarks` | Parsed into `activity_logs` (see §4) |
| `hvs_tagging_status` | Custom field, kept as-is — "High Value Seller" tag |
| `weekly_task` | Maps to the Tasks module as a recurring/free-text task note |
| `tag`, `is_shared`, `reactivation`, `suspension_status`, `issue` | Custom fields / status-adjacent flags — kept, mapped to the field builder as configurable attributes |

---

## 6. Open follow-up (non-blocking)

- Once more rows are available (this sample was 8 records), re-run this mapping against a larger/full export to catch any additional duplicate-field or bad-data patterns not visible at small sample size.
- Confirm whether historical call recordings (`cr_recording_url`) need to be migrated as actual files (S3) or just kept as a reference link.
