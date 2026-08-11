# ADR-0013: Campaigns share trigger detection, not the notification rule model

**Status:** Accepted

## Context

Phase 13c adds email campaigns to Leads. One kind sends when a Lead's process
instance enters a configured Journey/Status — the same real-world event Phase 9
already detects for Notification Rules.

ADR-0010 established that notification trigger and recipient-resolver kinds are
closed engine catalogs, and that rules "consume persisted Lead activities in the
mutation transaction". The obvious reading is that a campaign is just another
kind of rule action. Two facts found while planning say otherwise:

- `NotificationRule.scope` is rejected for every trigger except `field_edited`,
  so **a Phase 9 rule cannot target a specific status at all**. Journey/Status
  targeting is new work wherever it lives.
- `notification_rule_recipients` resolves **users** — all six resolvers return
  user ids, and validation requires at least one. A campaign's recipient is the
  **Lead**. They are different recipient universes.

Merging them would need an action discriminator on `notification_rules`,
recipients that are required by validation but meaningless for one branch,
`scope` semantics forked per action, and one admin screen rendering two
unrelated shapes.

## Decision

**Trigger detection is shared; the rule model is not.**

The classification that turns a persisted `activity_logs` row into a trigger
moved out of `PrismaLeadRepository.writeActivity` into
`apps/api/src/leads/trigger-dispatch.ts`, which both consumers read:

```
writeActivity → triggerTypeFor(actionType) → event
                                             ├→ NotificationService.evaluate
                                             └→ CampaignTriggerService.evaluate
```

Detection exists once. Neither consumer knows about the other. The dispatch
payload gains `newValue`, which Phase 9 never needed and a campaign keyed on
*entering* a status does.

Campaigns get their own `campaigns` and `campaign_sends` tables, and their own
`campaigns` permission module with `view`, `create`, `edit` and `send` — `send`
separate from `edit` because composing an email and mailing customers are
different levels of trust.

**Status matching stays exact**, per ADR-0001: a triggered campaign fires when
the activity's new status id equals the configured status id. `sort_order` is
display ordering and is never consulted.

**Delivery happens after the transaction commits.** Evaluation runs inside the
mutation transaction, as ADR-0010 requires, but it only writes a `pending`
`campaign_sends` row. A separate step drains those rows and calls the transport.
An email cannot be rolled back, so sending inside a transaction that later
aborts would be unrecallable.

**A lead receives a given campaign at most once, ever**, enforced by a unique
constraint on `(organization_id, campaign_id, lead_id)` rather than by a code
path. Re-entering the configured status does not re-send.

## Consequences

Phase 9 behaviour is unchanged; its rollback test still applies to the shared
dispatch. Notification Rules keep their closed catalogs, and ADR-0010 stands as
written — this ADR narrows what "rules consume activities" implies, rather than
superseding it.

Adding a third consumer of the same detection is now a registration rather than
another copy of the classification.

The at-most-once constraint means a deliberate re-send to the same Lead is not
possible without deleting its `campaign_sends` row. That is the intended
trade-off for outbound marketing, where duplicates are the harmful direction; a
per-campaign "allow repeat sends" toggle is the named follow-up if it is ever
wanted.

Delivery outside the transaction makes sends at-least-once against an
at-most-once record: a crash between commit and drain leaves rows `pending` for
the next drain, so the failure mode is a delayed send, never a duplicate.
