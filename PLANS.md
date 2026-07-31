# PLANS.md — Execution Plan Format

For any task larger than a trivial fix, produce a plan in this format before writing code. Do not proceed past the plan without explicit approval.

## Required plan structure

```
## Goal
<one sentence, the specific outcome>

## Docs read
<list the docs/ files actually read for this task>

## Current state
<what exists in the repo today relevant to this task>

## Proposed approach
<the design, referencing docs/data-model, docs/permissions, docs/api as relevant>

## Files to touch
<explicit list — no "and related files">

## Out of scope
<explicitly what this task will NOT change>

## Risks / open questions
<anything uncertain — including any conflict found between raw example data
and docs/, per the source-of-truth precedence rule>

## Test plan
<what tests get added/updated, referencing docs/testing/quality-gates.md>

## Rollback plan
<for schema changes specifically>
```

## Rules

- One plan per coherent milestone — never "build the whole CRM" as one task.
- A plan must be approved before its corresponding implementation begins.
- If a plan reveals a conflict between two source documents, stop and surface it rather than resolving it silently — update `docs/architecture/decisions/` with a new ADR once resolved, then resume.
- Use a separate Git worktree for independent parallel work; never let two tasks modify the same package/module simultaneously.
- Long-running or multi-phase work should reference the phase numbering in `docs/requirements/v1-scope.md` and the original implementation plan's phase breakdown, so progress stays traceable.


----