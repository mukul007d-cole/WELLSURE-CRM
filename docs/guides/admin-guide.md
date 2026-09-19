# Admin Guide

This guide is for whoever configures a Wellsure CRM workspace: setting up Journeys and
Statuses, Fields, Roles, Users, Departments and Teams, routing and notification rules,
Campaigns, the Tools resource library, and data import/export.

It describes the screens as they actually exist today, using the exact labels and
navigation paths in the product. It uses a synthetic organisation throughout —
**Meridian Wholesale** — with synthetic people (Priya Nair, Arjun Mehta, Kavita Rao,
Deepak Shah) and synthetic Journeys ("Onboarding", "Renewals"). None of this is
Wellsure's real data.

If you are working leads day to day rather than configuring the workspace, see
**[docs/guides/user-guide.md](./user-guide.md)** instead. The two guides cross-reference
each other wherever a user-facing task needs an admin to do something first.

Where this guide and a planning document disagree, the running code is what this guide
describes — planning docs describe intent, sometimes revised intent; the product is what
your team actually uses.

---

## Table of contents

1. [Before you start: the permission catalog and your first login](#1-before-you-start-the-permission-catalog-and-your-first-login)
2. [Journeys and Statuses](#2-journeys-and-statuses)
3. [Fields](#3-fields)
4. [Assignment routing and lead visibility — read this before turning on routing](#4-assignment-routing-and-lead-visibility--read-this-before-turning-on-routing)
5. [Roles and permissions](#5-roles-and-permissions)
6. [Users, Departments, Teams, and the reporting hierarchy](#6-users-departments-teams-and-the-reporting-hierarchy)
7. [Notification rules](#7-notification-rules)
8. [Campaigns](#8-campaigns)
9. [Tools (resource library)](#9-tools-resource-library)
10. [Import and export](#10-import-and-export)
11. [Permanently deleting configuration (purge)](#11-permanently-deleting-configuration-purge)
12. [Known limitations](#12-known-limitations)
13. [Needs confirmation](#13-needs-confirmation)

---

## 1. Before you start: the permission catalog and your first login

Every capability in this product is one row in a fixed catalog of `module:action` pairs
(Leads, Fields, Journeys & Statuses, Services, Users & Departments, Roles & Permissions,
Attachments, Campaigns, Tools, Lead Routing, Integrations). A Role is just a named bundle
of these pairs, each with an optional data scope. Nothing you do in **Admin → Roles**
can invent a new capability — if an action isn't in the catalog, granting it does nothing,
by design.

**Your first administrator account was created by a one-time bootstrap step**, not through
the UI. Bootstrap grants that account *almost* the entire catalog — every module and
action **except the five `purge` actions** (Journeys & Statuses, Fields, Services, Teams
under Users, and Roles/Notification Rules). This is deliberate, not a bug: `purge` is the
only truly irreversible action in the product, so the very first administrator does not
carry it silently from minute one. If you try to permanently delete something and get
refused, see [§11](#11-permanently-deleting-configuration-purge) — you need to grant
yourself that permission explicitly, and doing so is itself logged.

One permission bootstrap *does* grant your first admin, unlike `purge`, is
`leads:bypass_status_visibility`. That one is explained in
[§4.4](#44-leadsbypass_status_visibility--the-oversight-backstop) — it exists specifically so
your first admin is never the one who gets locked out of their own leads.

---

## 2. Journeys and Statuses

**Admin → Journeys** (`/admin/journeys`, needs `journeys_statuses:view`).

A **Journey** is a pipeline a Seller can move through (e.g. "Onboarding", "Renewals"). A
Seller can belong to more than one Journey at once.

### 2.1 Create a Journey

**Admin → Journeys → Create Journey** (needs `journeys_statuses:create`). Enter a
**Name** and save. That's the entire creation form — everything else (Statuses, Field
mapping, routing) is configured afterwards on the Journey's own detail page.

A stable **key** is generated from the name automatically the moment you create the
Journey. It is not exposed anywhere at creation time — you never see or set it — but once
the Journey exists, editing it shows a read-only **Stable key** field. That key:

- never changes, even if you rename the Journey later
- is what an admin has to type back, verbatim, to confirm a permanent delete (§11)
- is what a bulk-import CSV can use to identify a Status within this Journey, instead of
  the Status's display name
- appears in API responses, never in the web app's own page URLs (those use an internal
  id, not the key)

### 2.2 Add, order, and configure Statuses

Open **Admin → Journeys → [journey name]**. Statuses live in a **Statuses** card on this
same page — there is no separate "Statuses" tab or screen.

**Create Status** (needs `journeys_statuses:create`) opens a form with:

| Field | What it is |
|---|---|
| Name | Required. |
| Order | A number; controls display order in lists and boards. |
| Outcome | `open`, `closed_won`, or `closed_lost` — drives forecasting/conversion reporting. Shown in the UI as these exact literal values, not friendly labels. |
| Behavior | `default`, `call_later`, `follow_up`, or `archived` — intended to drive automatic task creation and active-view visibility. **In this release, `call_later`/`follow_up` do not actually create a task** — see [§12](#12-known-limitations). |

Existing Statuses can be reordered with the **↑ / ↓** buttons, then **Save Status
order** (or **Reset** to discard). **Set as default** marks which Status a new Seller
lands in when none is chosen on creation — only one Status per Journey can be default, and
the button is hidden once a Status already is.

**If you leave Outcome/Behavior unset:** you can't — both are required selects with no
blank option, so every Status has a definite value from creation. There is no "unset"
state for a Status itself. Outcome and Behavior can both be changed later via **Edit**.

### 2.3 Deactivate a Journey or Status

**Deactivating** is what the **Deactivate** button does everywhere in configuration
screens — it is never a hard delete. A deactivated Journey or Status stops appearing to
end users but its history is kept.

- **Journey**: **Admin → Journeys → [journey] → Deactivate** (needs
  `journeys_statuses:delete`). Acts immediately, with no dialog.
- **Status**: **Admin → Journeys → [journey] → [status row] → Deactivate**. This one
  *does* open a panel first, because leads may currently be sitting in that Status: choose
  a **Replacement Status** (or **No replacement**) that active Sellers get moved to, then
  confirm with **Deactivate Status**. Moving leads this way writes one activity entry per
  affected lead, so it shows up in each Seller's own timeline, not just the admin audit
  log.

**Can it be changed back later?** Re-activating a deactivated Journey or Field is possible
(edit it and it becomes active again through the ordinary edit form/API). **A deactivated
Status is different: once deactivated, it is gone from the UI permanently, with no way
back through any screen.** The read endpoint that powers the Journey detail page filters
out inactive Statuses entirely, so there is no request in the product that ever shows you
an inactive Status to reactivate. Before deactivating a Status, be certain — the practical
effect for admins is closer to a one-way action than "just" a soft delete. (The data
itself is not lost — see [§11](#11-permanently-deleting-configuration-purge) for what
would actually need to happen to remove it for good — but nothing in the UI lets you look
at it again.)

There is **no purge control for an individual Status** anywhere in the UI, even though
`journeys_statuses:purge` is a real, grantable permission and Journeys themselves do
expose a "Delete permanently" button once deactivated. If you need a Status permanently
gone, that currently has to go through the API directly (`POST /statuses/:id/purge`) —
not something this guide can walk you through in the UI, because the control doesn't
exist there yet.

### 2.4 Map Fields to a Journey

Still on the Journey detail page, the **Journey Fields** card is where you decide which
of your organisation's Fields actually show up on *this* Journey's Seller form and
Details tab — a separate mechanism from Field visibility (§3.2) and from the Field itself
existing.

**Attach Field** (needs `fields:edit`) asks for:

| Setting | Options | What it affects | If left unset |
|---|---|---|---|
| Field | Any existing Field (locked once the rule is created — you unmap and re-add rather than repoint) | Which Field this rule governs | N/A — required |
| Requirement | `required` / `optional` / `hidden` | Whether the Field is enforced as required, shown but optional, or not shown at all on this Journey's form | There is no "unset" — you must choose one; `optional` is the natural default to pick |
| Required from Status | Any Status in this Journey, or "No Status condition" | Makes the Field required only once a Seller's process instance reaches that specific Status (exact match — a Status's display order has no bearing on this) | The Field's `required`/`optional` setting applies unconditionally, from creation |

A Field not attached to a Journey at all behaves exactly like `requirement: hidden` for
that Journey — neither shows it. This is one of three separate reasons a Field can fail to
appear; see [§3.2](#32-three-different-reasons-a-field-can-be-missing) to tell them apart.

---

## 3. Fields

**Admin → Fields** (`/admin/fields`, needs `fields:view`).

### 3.1 Create a Field

**Create Field** (needs `fields:create`) asks for:

- **Type** — one of exactly nine supported types: `text`, `textarea`, `email`, `phone`,
  `date`, `select`, `number`, `boolean`, `json`.
- **Edit mode** — `manual`, `locked`, `calculated`, `system`, or `api-only`. This governs
  *who or what is allowed to populate the value*, not who can see it (that's Field
  visibility, §3.3). A `calculated` Field needs its type to be Number (for an arithmetic
  formula) or Text/Textarea (for a template); the editor gives you a template box with
  hint text: *"Click a field below to insert its value — or type `{{field:<id>}}`
  directly."*
- **Source** — `manual`, `system`, `api`, `import`, or `calculated`. This is auto-suggested
  from your Edit mode choice, and you can override it.

**If you leave Type as something the validator doesn't recognise** (see
[§3.4](#34-a-real-defect-unsupported-field-types-are-accepted-silently)), the Field is
created successfully but can never actually hold a value — nothing in the create form
warns you.

**Deactivate** (`fields:delete`) hides the Field going forward; values already stored on
existing leads are preserved. **Delete permanently** (`fields:purge`) only appears once
the Field is already deactivated, and only for roles holding the purge action — see
[§11](#11-permanently-deleting-configuration-purge).

**Reorder fields** controls the Field's display order on the Details tab, the Seller
form, and this admin list — a Section's own position follows its first Field's order.

### 3.2 Three different reasons a Field can be missing

This is the single most common "why can't I see this Field" question, and there are
genuinely three independent mechanisms, any one of which alone is enough to hide a Field.
Check them in this order:

| # | Mechanism | Where you configure it | What "unset" looks like | Who it affects |
|---|---|---|---|---|
| 1 | **Journey field mapping** | Admin → Journeys → [journey] → Journey Fields | Field not attached to this Journey at all, *or* attached with Requirement = `hidden` | Everyone, on this Journey specifically — the Field simply doesn't exist on this Journey's form/Details tab, no matter who's looking or what their role grants |
| 2 | **Field visibility** | Admin → Fields → [field] → Role visibility, *or* Admin → Roles → [role] → Field visibility (same underlying rows, two screens — see §5.4) | No row for a given (Field, Role) pair | Per role — a Field with zero visibility rows is invisible to literally everyone, including the Field's own creator's role, until explicitly granted |
| 3 | **Edit mode** | Admin → Fields → [field] → Edit mode | N/A — always has a value | Doesn't hide the field at all; it disables editing. A `calculated`/`system`/`locked`(-once-set) Field still *shows* on the form, disabled, with an inline hint ("Computed automatically", "Set by the system", "Locked — cannot be changed once set") |

The practical diagnostic: if a Field is missing from **both** the Details tab and the
edit form for everyone, it's #1 (not mapped to this Journey, or mapped hidden). If it
shows for some roles and not others on the same Journey, it's #2. If it shows but is
greyed out with an explanatory hint next to the label, that's #3 and is working as
intended — that Field is populated by something other than a person typing into it.

New Fields start with **zero** visibility rows — hidden from every role, including
Admin's — the same as a brand-new Tools resource (§9) and unlike a Status, which starts
open (§4.2). You must explicitly grant visibility before anyone, including yourself, sees
values in it.

### 3.3 Field visibility (role side)

See [§5.4](#54-field-visibility) — it's documented once, from the Roles side, since the
two screens write the same data.

### 3.4 A real defect: unsupported field types are accepted silently

If you create a Field with a **Type** value other than the nine listed in §3.1 — the
obvious mistake is reaching for something like "currency" — the create form and the API
both accept it without complaint. The Field then exists, is filterable-as-"not
filterable", and **every attempt to actually put a value into it fails validation**,
permanently, with nothing at creation time telling you this will happen. This is a known,
open, recorded defect (not something this guide invented) — if you hit it, the fix is to
recreate the Field with one of the nine supported types; there's no in-place repair.

---

## 4. Assignment routing and lead visibility — read this before turning on routing

This is the interaction most likely to generate a "the CRM is broken" report, so it gets
its own chapter rather than being split across Journeys and Roles.

### 4.1 How assignment routing works

**Admin → Journeys → [journey] → [status row] → Routing** (needs `lead_routing:view` to
see it, `lead_routing:configure` to edit it) configures *automatic assignment*: when a
Seller's process instance enters this Status, who does it get assigned to?

**Add routing rule** asks for:

| Setting | What it does | If left unset |
|---|---|---|
| Assignment type | Free text (e.g. `lead_owner`) naming which assignment slot this rule writes | Required to save |
| Algorithm | **Round robin** (cycles through the pool by user id, wrapping) or **Least loaded** (picks whoever currently holds the fewest *open* leads of this assignment type, organisation-wide) | Required to save |
| Pool | **Named users** (pick specific people) or **A Team** (a Team configured under a Department, §6.3) | Required to save; a Team pool tracks that Team's membership live — if the Team's membership changes, the rule's candidates change with it automatically |

**If a rule's pool is empty, or every candidate in it is inactive or otherwise
excluded**, routing does not fail the status change — it just skips silently, leaves the
existing assignment (if any) untouched, and records why in the lead's own history. A
Seller moving into a routed Status is never blocked by an admin's misconfigured pool.

**If you clear a rule** ("Clear rule" button), the Status goes back to imposing **no**
constraint on assignment or visibility at all — see §4.2. There is no separate
deactivate/reactivate state for a rule; it's either configured or cleared.

### 4.2 What turning on routing does to who can see a lead

**This is the part that isn't obvious from the routing screen alone.** The moment a
Status has an **active** routing rule, visibility of any Seller sitting in that Status
narrows automatically, for *every* role, regardless of that role's own configured data
scope:

> Only the Seller's **current assignee**, plus everyone **above that assignee** in the
> reporting hierarchy (any depth), can see that Seller — on every surface: Seller List,
> Board, Seller 360, search, direct link, activity timeline. Nobody else can, **even a
> role configured for `ORGANIZATION` scope**, and even someone who was looking at that
> exact Seller a moment before the rule went active.

The routing panel says so directly, right where you turn it on — once a rule is active,
you'll see this line under it:

> *"Visible only to the assigned user and their manager chain."*

Concretely, with Meridian Wholesale's people:

- Priya Nair is a Sales Executive. Arjun Mehta is her manager (Team Leader). Kavita Rao is
  Arjun's manager (Sales Manager).
- A Seller is auto-assigned to Priya when it enters "Registration Done" in the Onboarding
  Journey, and that Status has an active routing rule.
- Priya can see it (she's the assignee). Arjun can see it (he's above her). Kavita can see
  it (she's above Arjun, at any depth). **Deepak Shah, an Admin with `ORGANIZATION` scope
  on Leads, cannot see it** — unless Deepak is also somewhere above Priya in the
  `manager_id` chain, or holds the bypass permission in §4.4.

**A Status with no active routing rule imposes none of this** — ordinary data scope and
Journey access decide visibility exactly as you'd expect, with no hierarchy narrowing at
all. This is the default, unrestricted state, matching the fact that every Status already
exists with leads already visible in it before you ever touch routing.

**Before turning on a routing rule for a Status that already has leads in it**, check who
currently has eyes on those leads and confirm they're either the eventual assignee, above
the assignee in `manager_id`, or a role that holds the bypass (§4.4) — otherwise you are
about to remove access from people who have it today, silently, with no warning dialog.

### 4.3 The reporting hierarchy: setting and verifying it

Everything in §4.2 depends entirely on each user's **Manager** field
(`users.manager_id`). This is *not* the same thing as a Team configured under a
Department — see §6.3 for that distinction; the permission engine never reads Team
membership for this.

**Set it:** **Admin → Users → [find the user] → Edit → Manager** (a searchable picker of
any active user in the organisation — not restricted to the same Department). Leaving
Manager as "No manager" makes that person a root of the hierarchy: nobody is above them,
and they will not automatically be brought into any routed lead's visibility as a
manager.

**Verify it:** **Admin → Users → Org Chart** (`/admin/users/org-chart`). This is a
read-only rendering of the reporting tree, built purely from every user's `manager_id`.
It has no drag-and-drop, and no edit control of its own — go back to the Directory
(**Admin → Users**) and edit the user's Manager field to fix anything you see here.
Search by name, email, role, or department to jump straight to someone.

**The gap to know about:** the Org Chart flags a genuine reporting **loop** (a page-level
banner: *"A reporting loop was found between X, Y — they're shown at the top level."*)
and flags a manager whose own manager isn't visible to you (*"N people report to someone
outside the users you can see"*). **It does not flag a plain, ordinary "no manager
set."** Someone who simply has no Manager configured renders as an unlabelled root node —
visually identical to a deliberate top-of-org executive. There is nothing in this screen
that tells you "this person forgot to set a manager" versus "this person is genuinely the
top of a branch." You have to know, independently, who is *supposed* to be a root.

**The practical check for "my manager can't see their team's leads":**

1. Go to **Admin → Users → Org Chart**, search for the manager's name.
2. Confirm they appear *underneath* someone, or are a root you actually intended.
3. Confirm the reports in question appear underneath *them*.
4. If either link is missing, go to **Admin → Users**, open the report or the manager,
   and set the **Manager** field.
5. Remember: the Directory table itself (**Admin → Users**, the list view) does **not**
   show a Manager column — you can only see or verify this via the Org Chart, or by
   opening a specific user's **Edit** form.

### 4.4 `leads:bypass_status_visibility` — the oversight backstop

This permission exists specifically to undo the narrowing in §4.2 for a chosen role,
without touching that narrowing for everyone else. A role that holds it is treated as if
no Status it ever asks about has an active routing rule — full stop, on every request.

**What it does *not* do:** grant any new reach. It only removes the *extra* restriction
routing layers on top of a role's existing data scope. A `SELF`-scoped role with the
bypass still only sees its own assigned leads — the bypass doesn't widen scope, it only
turns off routing's narrowing on top of whatever scope already applies.

**Who should have it:** a small, deliberately-named set of admin/oversight roles —
support, compliance, dispute resolution, the people who need to reach *any* lead
regardless of current assignment, not because they're anyone's manager. Bootstrap grants
this to your very first administrator automatically (unlike `purge`) specifically so that
account is never the one that gets locked out the moment routing goes live. You are free
to remove it from that role later, once you've built out a proper reporting hierarchy and
no longer need the backstop there.

**Why handing it out casually defeats the whole feature:** §4.2's entire point is that
visibility into a routed Status is *earned* by being the assignee or their manager — a
deliberate, structural guarantee, not a convenience. Every role you grant this to is a
role that bypasses that guarantee, org-wide, on every lead, forever (until revoked). Grant
it the way you'd grant `purge` — narrowly, and for a stated reason — even though bootstrap
happens to hand it out more casually than `purge` for the specific reason above.

**In the Role editor, this permission gets no special visual treatment** — it's a plain
checkbox with no warning icon or explanatory tooltip, identical to every other action in
the Leads module. Nothing in the UI will stop you from granting it broadly; this guide is
the warning.

### 4.5 Per-status routing permissions

Below the routing rule editor, if you also hold `roles_permissions:edit`, you'll see a
second, separate table: **Role permissions for this Status** (View / Configure / Operate
per role). This is an *additional* layer on top of the `lead_routing` module permission —
**both are required**. A role needs `lead_routing:configure` (or `:operate`, or `:view`)
granted in Roles & Permissions *and* a checked box here for this specific Status, if this
Status has any rows checked at all.

**If you leave every box unchecked for a Status** (the default, on every Status, until
you touch this table), the module-level permission alone is sufficient — every role
holding `lead_routing:configure`/`:operate`/`:view` can act on this Status. The moment you
check even one box in one column, that column narrows to *only* the roles checked, for
that Status. This mirrors how routing rules themselves default to "no rule = unrouted" —
absence here means unrestricted, not restricted-to-nobody.

Editing this table is gated on **`roles_permissions:edit`**, not on `lead_routing`
anything — a routing administrator who can't edit permissions can't grant routing rights
to their own or any other role.

### 4.6 Reassignment grace and `leads:retain_view_after_reassignment`

When a Seller is reassigned away from someone — manually, or automatically by routing —
the previous holder normally loses access immediately (subject to the ordinary scope and
routing rules above). This permission lets you offer certain roles a personal, opt-in
exception.

**Granting it** (Admin → Roles → [role] → Feature permissions → Leads →
`retain_view_after_reassignment`) does not itself change anything — it only unlocks a
**personal toggle** on the user's own **Settings** page (see the [user
guide](./user-guide.md#9-your-settings)): *"Keep view-only access for 30 days after a
lead is reassigned away from me."* Each user with the permission decides for themselves
whether to turn it on.

Once on, the instant a Seller is reassigned away from that user (manual reassignment or
routing), a **30-day, view-only grant** is created automatically for the person who just
lost the assignment. This is bootstrap-granted by default — it carries no destructive risk
of its own, and the personal opt-in is still required on top of it.

**If you later revoke this permission from a role**, or move a user to a role that never
had it: grants already issued keep working until their natural 30-day expiry. Nothing
retroactively revokes them, and the user's own toggle isn't force-cleared — it goes
dormant and re-activates automatically if the permission comes back.

### 4.7 Lead Sharing as an exception to both scope and status visibility

A **Lead Share** (created from a Seller's own page — see the [user
guide](./user-guide.md#6-sharing-a-seller-with-someone-else)) is a deliberate,
individual-record exception. It's the one thing that reaches past §4.2's narrowing on
purpose: a valid, unexpired share overrides the routing-based hierarchy restriction the
same way it already overrides ordinary data scope. If Priya shares a Seller with Deepak
(who isn't in Priya's management chain and doesn't hold the bypass), Deepak can still see
that specific Seller even while it sits in a routed Status — because the share names him
individually, rather than widening a whole role's reach.

This is the tool to reach for when one specific person needs access to one specific
routed lead outside the hierarchy — not the bypass permission in §4.4, which is a
role-wide, every-lead exemption and a much bigger grant for a narrower need.

---

## 5. Roles and permissions

**Admin → Roles** (`/admin/roles`, needs `roles_permissions:view`) → **Admin → Roles →
[role]** for the editor. A Role is a fully admin-defined bundle — there are no fixed
presets baked into the product; the starting roles you see (e.g. "Sales Executive",
"Team Leader") are ordinary, editable seed data.

The editor has three independent sections, each saved separately, each with its own
**Save** / **Reset** and an **Unsaved changes** indicator.

### 5.1 Feature permissions

Grouped by module (Leads, Fields, Journeys & Statuses, Services, Users & Departments,
Roles & Permissions, Attachments, Campaigns, Tools, Lead Routing, Integrations). Each
action is a plain checkbox — no special styling distinguishes a `purge` action or
`leads:bypass_status_visibility` from an ordinary one; treat every checkbox with the same
care those examples deserve, because the UI itself won't remind you which ones are
higher-stakes.

**The scope selector only appears where a scope actually changes anything.** For most
actions in this catalog, picking `SELF` versus `ORGANIZATION` has **zero effect** — the
route behind that action never checks "whose record is this" in the first place (there's
no Journey, Field, Role, User, Campaign, or routing rule owned by one person the way a
lead is assigned to one). Rather than offer a control that silently does nothing, the
editor shows a real dropdown only for the handful of actions where scope is genuinely
enforced — `leads:view/edit/comment/delete` and `attachments:upload/download/delete` —
and a fixed label, **"Always organization-wide,"** everywhere else, with a tooltip
explaining why.

`leads:export` and `leads:import` deliberately don't get their own scope selector either,
even though you might expect them to — they reuse whichever scope is granted for
`leads:view` instead. A role configured with wide `export` but narrow `view` cannot
export more than it can already see.

The scope options for a real selector are **SELF**, **Team (reporting line)**,
**DEPARTMENT**, **ORGANIZATION**. The label is deliberately "Team (reporting line)," not
just "Team" — a permanent hint above the module list spells out why: *"Team (reporting
line) means everyone reporting to this user through the org chart, at any depth. It is
not related to Teams configured under Departments."* See §6.3 for the full distinction —
this is worth reading once, since the two "Team" concepts are genuinely different things
sharing one English word.

A **"Set all scopes…"** bulk control rewrites the scope on every currently *granted*
row — including unscoped ones, which don't actually use that value. Saving always
normalizes every unscoped action's stored scope back to `ORGANIZATION`, so the data never
stays cosmetically misleading even if you just used the bulk control carelessly.

**If you save a change that would leave zero active users holding
`roles_permissions:edit` anywhere in the organisation, the save is rejected** — this
"last permission administrator" guard exists so you can never lock everyone out of
managing permissions. **The error message you'll actually see is an unhelpful, literal
banner reading "conflict"**, with none of the explanation above — that's a known rough
edge in this release, not a separate failure. If you hit it, the fix is exactly what the
banner doesn't tell you: make sure at least one active user's role still has
`roles_permissions:edit` before you save.

### 5.2 Journey access

A plain checklist of every Journey; a role with a Journey unchecked doesn't see that
Journey anywhere in the product — no greyed-out placeholder, it simply doesn't exist for
them. **Select all / Clear all** toggles the whole list at once.

### 5.3 What "unset" means across this editor

For every axis on this page, "unset" (nothing granted) means **the most restrictive**
outcome: a module/action not checked is refused entirely; a Journey not checked is
invisible; a scope with nothing picked can't be saved in the first place (every scoped
action needs an explicit value). There is no "inherit from elsewhere" default anywhere in
this editor.

### 5.4 Field visibility

**This configuration lives on two screens, writing the exact same underlying rows** — it
is easy to think of it as living in only one place, so worth stating plainly:

- **Admin → Roles → [role] → Field visibility** — one role, every Field, a per-field
  Hidden/View/Edit dropdown (default: Hidden, when no row exists yet).
- **Admin → Fields → [field] → Role visibility** — one Field, every role, two checkboxes
  per role (View / Edit — checking Edit auto-checks View; unchecking View clears Edit).

Both directions write to the same place and both are gated on **`roles_permissions:edit`**
— never on `fields:edit` — deliberately: a Fields administrator who can't edit permissions
must not be able to grant their own role visibility into a Field it's otherwise denied.

**A brand-new Field starts with zero rows — hidden from every role, including whoever
just created it.** Nothing shows until you explicitly grant it. `EDIT` implies `VIEW`;
there is no way to grant edit without view.

---

## 6. Users, Departments, Teams, and the reporting hierarchy

**Admin → Users** (`/admin/users`, needs `users:view`). This module also covers
Department and Team administration — there's no separate Department permission module;
Departments and Teams both ride on `users:view/create/edit` (and, for Teams only,
`users:purge`).

### 6.1 Create a user

**Admin → Users → [Create]** asks for **Name**, **Email**, **Role** (required), and
optionally **Department** and **Manager**. Creating a user sends the existing
password-reset invitation automatically — you never set or see a plaintext password;
the person gets an emailed, expiring, single-use link to set their own.

**If the invited person never completes setup**, their row in the Directory gets a
**Resend invite** button (visible only until they finish — once they have a password, the
button disappears). This is currently the *only* way, anywhere in the product, to issue
someone a fresh reset link — see [§12](#12-known-limitations) for what that means for
someone who already has a password and simply forgot it.

**Deactivate** (needs `users:deactivate`) ends their sessions and removes them from
active use immediately; users are never hard-deleted (there's no purge for Users at all —
see §11).

### 6.2 Departments

**Admin → Departments** (`/admin/departments`). **Create Department** takes just a
**Name**; editing shows the same read-only **Stable key** pattern as Journeys and Fields.

**There is no deactivate control for a Department anywhere in the product**, even though
the Departments list shows an Active/Inactive state column and an Active filter — nothing
ever flips that flag from the UI today. This is a deliberate, recorded gap, not an
oversight you're missing: Departments are excluded from the purge feature specifically
*because* nothing can deactivate one yet, and purge requires deactivation first (see
§11). Departments therefore cannot currently be removed, only renamed or left in place.

### 6.3 Teams — and why they are not the same thing as "Team (reporting line)" scope

Teams live **inside** a Department: **Admin → Departments → [department] → Create
Team**. This is a genuinely different concept from the "Team (reporting line)" data
scope in §5.1, and the product says so twice (once on the Department page, once as a
permanent hint in the Role editor) precisely because the two ideas share the word "Team":

> *"Teams group this Department's Users for organization and lead routing. They do not
> affect what anyone can see — the 'Team (reporting line)' data scope on a role follows
> the org chart instead."*

| | Teams (under a Department) | "Team (reporting line)" data scope |
|---|---|---|
| What it is | A named group you create explicitly | Derived automatically from every user's Manager field |
| Where it's used | Routing pools (§4.1), organisational grouping | A role's data-scope option in the permission engine |
| Membership | Explicit, department-scoped, admin-managed | Implicit — whoever reports to whom |
| Affects visibility? | **No** | **Yes** — this is what actually gates who sees what |

**Creating a Team**: **Name** (required) and a **Members** checklist restricted to that
Department's own active users — you cannot even attempt to add someone from another
Department; the picker simply never offers them. Each candidate has a second checkbox,
disabled until they're checked as a member, labelled **Team Leader** — multiple
co-leaders are explicitly allowed. **An active Team must have at least one Team Leader**;
if you uncheck the last one, Save is disabled and you'll see *"Select at least one Team
Leader."*

**If a Team Leader is deactivated or moved out of the Department**, the invariant above
is preserved automatically rather than blocking that personnel action: their membership
is removed, and if that leaves the Team with zero leaders, the Team itself is
deactivated in the same step. Nobody's deactivation or transfer is ever blocked to
protect a routing configuration.

Teams support **Deactivate**, then (needs `users:purge`) **Delete permanently** — unlike
Departments, Teams can be fully removed once deactivated; see §11.

---

## 7. Notification rules

**Admin → Notification Rules** (`/admin/notification-rules`, needs
`roles_permissions:view` to see the page — rule administration rides on the Roles &
Permissions module). These generate **in-app notifications to Users** — a different
mechanism from Campaigns (§8), which email **Leads**; the two share only their underlying
"something happened" event detection.

**Create rule** asks for:

**Trigger** — one of: **Field edited**, **Status changed**, **Lead reassigned**,
**Shared lead modified**, **Lead deactivated**.

**Recipient resolver(s)** — a rule can have several; results are combined, and someone
matched more than once is still only notified once:

| Resolver | What it does | Extra input needed |
|---|---|---|
| Assignment holder | Whoever currently holds a given assignment type on the lead | Assignment type (a dropdown of types actually in use somewhere) |
| Holder's manager | That holder's direct manager in the reporting hierarchy | Assignment type |
| Previous holder | Read from the reassignment event itself | None |
| Share creator | Whoever granted the share | None — **but this one currently resolves to nobody**, because the form has no way to supply the parameter the resolver actually needs; a known non-functional option, not something you're misconfiguring |
| All shared users except actor | Everyone with an active share on the lead, except whoever made the change | None |
| Feature permission holders | Every active user whose active role holds a chosen permission | Permission module, then permission action |

**There is no scope-configuration control on this screen**, even though the underlying
data model has room for one — deliberately: the server only reads that value for one
trigger type that isn't wired to the form, so a scope control here would do nothing. Don't
go looking for it.

Rules are edited in place, and toggled **Active/Inactive** via the row actions — there is
no separate "just flip the flag" endpoint, so deactivating resends the whole rule
definition unchanged apart from the flag. Like every configuration entity, rules are
never hard-deleted by the ordinary Deactivate action; **Delete permanently** (needs
`roles_permissions:purge`) appears only once a rule is already inactive.

---

## 8. Campaigns

**Admin → Campaigns** (`/admin/campaigns`, needs `campaigns:view`). Campaigns **email
Sellers** — a Notification Rule notifies your own Users; a Campaign mails the lead's
contact.

**Create campaign** asks for a **Name**, **Subject**, and **When to send**:

- **Manually, to everyone matching a filter** — you build a filter (the same
  condition-builder used on the Seller List) describing who receives it, and send it
  on demand.
- **Automatically, when a lead reaches a status** — pick a **Journey**, then a
  **Status**; the campaign fires the first time a lead's process instance reaches that
  exact Status (matched exactly, never by display order).

**Message** is composed with a rich-text body and a variable picker inserting
`{{name}}`, `{{email}}`, `{{phone}}`, or `{{field:<id>}}` tokens for any Field you
personally have view access to — a Field you can't see is refused as a variable, since
one template serves a whole batch of different recipients.

**Saving a campaign and sending it are two separate permissions** — `campaigns:edit`
never implies `campaigns:send`. Composing and editing a campaign is one level of trust;
actually mailing customers is another. A **Send now** button only appears at all when you
hold `campaigns:send` **and** the campaign is a manual, active one — a triggered campaign
never shows a Send button, since it fires on its own.

**Two things this screen doesn't warn you about, so this guide will:**

1. **There is no confirmation dialog before sending, and no recipient preview or count
   beforehand.** Clicking **Send now** fires immediately. The only feedback is a toast
   afterwards: *"Queued N, sent N, failed N."* If you want to know who's about to receive
   a manual campaign before you commit, check the filter's results on the Seller List
   first.
2. **A lead can receive a given campaign at most once, ever** — this is enforced, but the
   UI gives you no indication of it happening. If you send a campaign, then send it again
   later expecting a resend to leads who already got it, those leads are silently skipped;
   the only sign is that your `sent` count doesn't climb the way you'd expect. There is no
   "already sent" flag shown per recipient and no built-in way to force a resend to a
   specific lead through the UI — it would require removing that lead's send record
   directly.

Campaigns deliberately have **no unsubscribe, consent, or suppression-list support** in
this release — see [§12](#12-known-limitations) before using this feature for anything
beyond internal/testing sends.

---

## 9. Tools (resource library)

**Admin → Tools**, or the **Tools** nav item with a **Manage Tools** toggle if you hold
`tools:create`/`edit`/`delete` (same page regular users browse — see the [user
guide](./user-guide.md)). This is a company resource library: internal links and files,
each gated per role.

**Add resource** asks for **Name**, **Description**, **Category** (free text with
autocomplete of existing categories), **Type** (**Link** or **File**), and, for a Link,
a required absolute http(s) **URL**; for a File, the file itself (label reads "Replace
file" when editing one that already has a file attached). **Usage instructions** is a
rich-text field.

**File limits, since the product itself won't tell you these numbers** — the upload form
only says "size- and type-limited; see the Tools admin guide," so here they are:

- **Maximum file size: 25 MB.**
- **Allowed types**: PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint
  (.ppt/.pptx), ZIP, PNG, JPEG, GIF, CSV, and plain text. Every binary type in that list
  is checked against its actual file signature, not just its declared extension or MIME
  type, so renaming a disallowed file won't get it past the check. HTML, SVG, and
  anything executable are explicitly excluded — they're the formats most likely to be
  used to attack a browser that opens them.

**Role access** — a fieldset in the same editor, not a separate screen. Per-role
checkboxes, plus **Grant to all** / **Clear all**, gated on `roles_permissions:edit` (not
`tools:edit`, for the same self-escalation reason as Field visibility). **The UI does
state this plainly, so there's no surprise here**: *"Roles left unchecked cannot see or
access this resource at all. New resources start hidden from every role."* — a brand-new
Resource is invisible to everyone, including its own creator's role, exactly like a
brand-new Field, until you check at least one box.

**If object storage isn't configured for this deployment** (see
[§12](#12-known-limitations)), downloading a file-type resource shows a friendly message
explaining storage isn't connected. **Uploading one, however, currently shows the raw
error code instead of a friendly explanation** — if you see the literal text
`storage_not_configured` when trying to add or replace a file, that's this same
condition, just with a rougher message than the download path gets.

---

## 10. Import and export

### 10.1 Import

**Import leads** (`/import`, needs `leads:import` — **in addition to** `leads:create`;
holding import alone never lets you create anything a single-record create couldn't).
Four steps: **Upload → Map columns → Preview → Result**. *"Nothing is created until you
confirm a preview."*

**Upload**: CSV only, up to **5,000 rows and 5 MB per file**.

**Map columns**: for each column, choose where it goes — **Skip**, a core Lead detail
(Name/Phone/Email/Status by name), an existing Field, or an assignment-by-email column.
Every column needs an explicit choice, including Skip. Separately, choose the **Journey**
(required, applies to the whole file), a **Starting status** (defaults to the Journey's
own default if left unset), and an **Owner type**/**Owner** for rows with no owner
column of their own.

**Duplicate matching** is its own card: check zero or more of your mapped targets
(Name/Phone/Email/a Field) as match keys. *"Off unless you choose at least one. A row
matches only when every chosen value is filled in and identical."* **Leaving every box
unchecked turns matching off entirely — every row creates, including exact repeats.**
This is always shown, not a warning that appears only when you've made a mistake — read
it before your first import.

A checkbox labelled **"Import nothing unless every row is valid"** is the all-or-nothing
toggle — checked, one bad row cancels the whole file (after evaluating every row, so you
still see the full problem list); unchecked (the default), valid rows are created and
invalid/duplicate rows are reported individually, with nothing silently dropped.

**One thing to know about permissions here**: the column-mapping screen does not stop you
from mapping a Field you personally can't edit — that check only happens when you click
**Preview import**, and if it fails, you'll see a generic "forbidden" banner rather than
a message naming which column is the problem. If preview fails immediately with no
row-level detail, check that every Field you mapped is one your own role can actually
edit.

**Preview** runs the real creation logic and rolls it back — nothing is written yet.
Three clickable count tiles (Will be created / Skipped as duplicates / Cannot be
imported) filter the row table. Rejected rows are grouped by reason in an expandable
list. A duplicate match outside your own data scope shows *"Matches an existing record
you do not have access to"* rather than naming the record — matching itself runs across
the whole organisation regardless of your scope, but disclosure of *which* record it
matched respects your scope.

**Result**: final created/skipped/rejected counts, with the same rejected-rows-by-reason
breakdown as Preview.

### 10.2 Export

**Export CSV** on the Seller List (needs `leads:export`) exports exactly what's currently
on screen — same search, filters, sort. The gate to export is its own permission, but the
actual rows and columns you get are bounded by your **`leads:view`** scope and field
visibility, not by any scope you might configure on `export` itself — a role can't be
configured to export more than it can already see. A Field you can't view is left out of
the CSV header entirely (not shown blank in every row), so the export doesn't disclose
that the Field even exists to someone who can't see it.

---

## 11. Permanently deleting configuration (purge)

**Purge is the one genuinely irreversible action in this product.** It hard-deletes a
configuration entity from the database; nothing short of a database backup can bring it
back afterward.

**What can be purged, and what governs it:**

| Entity | Governing permission | Reachable from the UI? |
|---|---|---|
| Journey | `journeys_statuses:purge` | Yes — Admin → Journeys, once deactivated |
| Status | `journeys_statuses:purge` | **No** — API only, no UI control exists |
| Field | `fields:purge` | Yes — Admin → Fields, once deactivated |
| Service | `services:purge` | **No** — Services have no admin page at all; API only |
| Team | `users:purge` | Yes — Admin → Departments → [department], once deactivated |
| Role | `roles_permissions:purge` | Yes — Admin → Roles, once deactivated |
| Notification Rule | `roles_permissions:purge` | Yes — Admin → Notification Rules, once deactivated |

Leads, Users, and Departments **cannot be purged at all** — there is no such action in
the catalog for any of them. Leads and Users carry legal/audit weight that makes
deactivation the correct, permanent-enough operation. Departments are excluded for a more
mechanical reason: purge requires an entity to already be deactivated, and (as noted in
§6.2) nothing can deactivate a Department yet.

**None of the five purge permissions are granted by bootstrap** — see §1. You (or another
administrator already holding `roles_permissions:edit`) must grant them deliberately in
**Admin → Roles**, and doing so is itself an audited, timestamped act.

**The confirmation flow**, everywhere purge is exposed: a dialog states plainly that the
action is permanent and cannot be undone, and requires you to **type the entity's stable
key** (not its display name, which can repeat or change) to confirm. If the entity still
has real dependents — leads referencing a Field's values, an active Campaign filter
referencing a Journey, and so on — the dialog shows exactly what's blocking it (e.g.
`leads: 3, campaigns: 1`) rather than a generic failure. Purely relational/mapping rows
(a Field's visibility grants, a Journey's role access list, and similar) are cascaded and
removed along with the entity, not counted as blockers — they're recorded in the audit
log first, so what was removed can be reconstructed by hand if truly necessary, just not
restored automatically, and under a new id.

---

## 12. Known limitations

These are gaps the product itself documents as deliberate or currently unaddressed — not
guesses.

- **Object storage (documents and Tools files) is optional per deployment.** If it isn't
  configured, uploading or downloading a file anywhere (Document Locker, Tools file
  resources) fails with a "storage not configured" condition. Tools shows a friendly
  message for downloads; uploads currently show the raw error code instead (§9).
- **No malware/virus scanning on uploaded files**, anywhere. Mitigated by a strict
  file-type allow-list with signature checking (§9) and by every download being forced to
  save-as rather than opened inline in the browser — but genuinely not scanned.
- **No file version history.** Replacing a file (an Attachment or a Tools resource)
  keeps only the current version; there's no way to browse or restore a prior upload
  through the UI.
- **Services have no admin screen at all** — creating, editing, and purging a Service is
  API-only in this release.
- **A deactivated Status cannot be viewed or reactivated from the UI, ever** (§2.3) —
  effectively a one-way action from an admin's perspective, even though the underlying
  data isn't destroyed.
- **Departments cannot be deactivated or removed** (§6.2) — no control exists anywhere in
  the product for this.
- **No self-service "Forgot password?" flow.** The only way to issue someone a fresh
  password-reset link is the admin's **Resend invite** button, and that only appears for
  a user who has *never* completed setup. A user who already has a password and simply
  forgot it currently has no path — self-service or admin-initiated — to get a new reset
  link through the UI.
- **No bulk lead actions.** Bulk reassign and bulk status-change were removed from the
  permission catalog after shipping with no route behind them; there is no bulk-action
  UI anywhere on the Seller List or Board today. Only single-record actions and CSV
  import/export exist for working with many leads at once.
- **No saved/named filter views.** Seller List filters live only in the page's URL — they
  aren't named, saved, or shareable as a named view, even though they can be bookmarked
  or pasted as a link.
- **Reporting beyond the Dashboard's own tiles is not implemented.** There's no pipeline
  value report, conversion-by-status report, rep leaderboard, or forecast — the Dashboard
  derives its counts directly from Seller List totals, not a dedicated reporting engine.
- **No Tasks or reminders.** A Status's "Call later"/"Follow up" behavior is stored and
  shown in configuration, but does not currently create any task or reminder for anyone.
- **Finance (invoices, payments) is not implemented**, despite being part of the intended
  scope.
- **Campaigns have no unsubscribe, consent, or suppression-list handling.** Treat this
  feature as internal/transactional-adjacent rather than compliant outbound marketing
  until that changes.
- **Creating a Field with an unsupported type is accepted silently** (§3.4) — a currently
  open, recorded defect, not something you're misconfiguring.

---

## 13. Needs confirmation

Items that appear in the data model or planning docs but that could not be confirmed as
reachable through the UI, and are therefore left out of the task-oriented sections above:

- **Designations** (job-title-like values such as "Sales Executive," "Sales Manager")
  exist as a database concept but do not appear anywhere in the User create/edit form or
  any other screen explored for this guide — there is currently no way to set one through
  the UI. Confirm with engineering whether this is planned for a future release before
  telling users to expect it.
