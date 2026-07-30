# ADR-0003: Finance Scope for V1

**Status:** Accepted

**Decision:** V1 finance scope is limited to **invoices** and **payments/outstanding balances**. It explicitly excludes: renewal-schedule automation, payout calculations, and accounting-system integration.

**Context:** The real Cronberry export already contains this exact shape of data (`invoice_number`, `invoice_total_amount`, `invoice_due_amount`, `payment_received`, `pending_amount`, `seller_paid_amount_exgst`), so this scope maps directly onto existing fields rather than inventing new finance logic.

**Consequences:** `seller_renewal_date`, `renewal_count`, and `seller_paid_plan` are migrated and stored as plain fields on the lead (informational), not driven by a renewal/payout engine. A "Won" outcome (`outcome_type = closed_won`) can still fire a webhook toward an external accounting tool later, but no accounting logic lives inside Falcon itself in V1.
