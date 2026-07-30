# ADR-0001: Single Status Field (not Stage + Status split)

**Status:** Accepted

**Context:** An alternative design proposed splitting a lead's progress into two fields — a sequential "Stage" and a non-sequential "Status" overlay (e.g. Active/On Hold/Issue/Blacklisted sitting on top of a stage). The real Cronberry export and Wellsure's own usage pattern show a single flat `lead_status` field carrying everything — including terminal/overlay-like values (Blacklisted, Drop) in the same list as progress values (Pitch In Progress, Launched).

**Decision:** Falcon uses **one** `status` field per Journey membership, not two. Each Status carries:
- `outcome_type`: `open` / `closed_won` / `closed_lost` — drives forecasting/conversion reporting
- `behavior_type`: `default` / `call_later` / `follow_up` / `archived` — drives automatic task creation and active-view visibility

**Consequences:** Simpler schema, matches real-world usage exactly, avoids modeling a stage/status relationship that doesn't reflect how the business actually works. Trade-off: an admin cannot independently vary "stage" and "overlay status" as two orthogonal axes — if that need emerges later, it would require a schema change, not just new configuration data.
