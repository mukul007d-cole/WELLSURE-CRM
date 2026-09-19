# User Guide

This guide is for salespeople and anyone who works leads day to day in the Wellsure
CRM — finding Sellers, working the record, moving them through a pipeline, sharing
access, and attaching documents.

It uses a synthetic organisation throughout — **Meridian Wholesale** — with synthetic
people (Priya Nair, Arjun Mehta, Kavita Rao) and synthetic Journeys ("Onboarding",
"Renewals"). None of this is Wellsure's real data.

Several tasks here need an administrator to configure something first (which Journeys
you can see, which Fields, whether a personal setting is even available to you). Where
that's true, this guide links to **[docs/guides/admin-guide.md](./admin-guide.md)**
rather than repeating admin-only steps.

**If something you expect to see is missing** — a lead, a field, a status — jump
straight to **[§10](#10-when-something-you-expect-to-see-is-missing)**. It's the most
useful section in this guide.

---

## Table of contents

1. [Finding and filtering Sellers](#1-finding-and-filtering-sellers)
2. [The Seller record](#2-the-seller-record)
3. [Creating and editing a Seller](#3-creating-and-editing-a-seller)
4. [Moving a Seller between statuses](#4-moving-a-seller-between-statuses)
5. [Moving or adding a Seller to another Journey](#5-moving-or-adding-a-seller-to-another-journey)
6. [Sharing a Seller with someone else](#6-sharing-a-seller-with-someone-else)
7. [Attachments (Document Locker)](#7-attachments-document-locker)
8. [Comments and the activity timeline](#8-comments-and-the-activity-timeline)
9. [Your settings](#9-your-settings)
10. [When something you expect to see is missing](#10-when-something-you-expect-to-see-is-missing)
11. [Known limitations](#11-known-limitations)
12. [Needs confirmation](#12-needs-confirmation)

---

## 1. Finding and filtering Sellers

**Sellers** is the leads list (`/sellers`). Two views cover it: the **list** and the
**Board**.

### 1.1 The Seller List

- **Lead access**: `My leads` / `Shared with me` / `All`. "Shared with me" shows Sellers
  someone has explicitly shared with you (§6), independent of your normal access.
- **Search**: matches name, phone, or email.
- **Journey tabs**: pick a Journey to filter to; leaving no Journey picked shows the
  combined view across every Journey you have access to.
- **Status filter**: only enabled once a Journey is picked.
- **Sort**: Recently updated (default), Recently added, Name A–Z, Name Z–A.
- **Filters** (the funnel/condition builder): build one or more conditions against core
  fields (Name, Phone, Email, Created, Status, Journey) or any custom Field your role can
  see. Conditions are combined with **AND only** — there's no OR or grouping. Multiple
  conditions show a reminder: *"All conditions must match."*
- **Columns**: choose which of Journey / Status / Owner show (Seller itself always
  shows and can't be turned off), plus one column per Field mapped to the Journey
  you've selected. Column choice is remembered in your browser, not synced to your
  account or across devices.

**Filters aren't saved as named views** in this release — they live in the page's URL,
so you can bookmark or share a link to a specific filtered view, but there's no "Save
this view" button anywhere.

**A blank Journey/Status/Owner cell, or the literal word "Unassigned," can mean two
different things** that look identical on screen — see
[§10](#10-when-something-you-expect-to-see-is-missing) for how to tell them apart.

**Export CSV** appears if your role permits it, and exports exactly what's currently on
screen — same filters, search and sort, nothing more, nothing hidden that isn't already
visible to you here.

There is **no bulk-select or bulk-action toolbar** on this screen — every row action
(edit, reassign, share, deactivate) is single-record. If you need to update many
Sellers at once, ask an admin about CSV export/import (admin guide
[§10](./admin-guide.md#10-import-and-export)).

### 1.2 The Board

`/sellers/board` — pick one Journey; each column is one of that Journey's active
Statuses. Cards show name, phone/email, current owner, and a relative "Updated…" label.

The Board always shows the combined "all" view — there's no mine/shared/all toggle here
the way there is on the List.

**Moving a card between columns** — drag-and-drop, or click a card's **Move** button for
a menu of every other status. See [§4](#4-moving-a-seller-between-statuses) for what
happens when a move is refused.

If your role can see the Board but can't edit leads, you'll see a banner explaining that
plainly (*"You can view the board, but moving sellers between statuses needs edit
access"*) and dragging is disabled — cards are still viewable, just not draggable.

---

## 2. The Seller record

Opening a Seller (`/sellers/:id`) — sometimes called "Seller 360" internally — shows a
summary panel down the side and five tabs across the top:

| Tab | What's in it |
|---|---|
| **Activity** | The full history: comments, status changes, reassignments, shares, field edits, deactivation. See [§8](#8-comments-and-the-activity-timeline). |
| **Details** | Every Field value your role can see, grouped by section — read-only. |
| **Documents** | Uploaded files. See [§7](#7-attachments-document-locker). |
| **Repeat lead** | Other active Sellers whose name/phone/email look similar — a plain text search, not real duplicate detection (see below). Only shows a number badge when there's at least one match. |
| **Call history** | Empty in this release — see below. |

The summary panel shows owner, phone/email (with quick Copy/Call/WhatsApp actions),
added/updated dates, which Journey(s) this Seller belongs to with its current status per
Journey, and — if anyone has shared this Seller with someone — a **"Shared with"** list.

**If a Seller belongs to more than one Journey**, a banner near the top lets you switch
which Journey's context you're currently viewing — this determines which Journey's
Activity, Documents, sharing, and record actions (Reassign/Deactivate) you're acting
against.

**There is no visible "ID" or "key" anywhere on this page.** The Seller's internal
identifier only ever appears in the page's own URL and inside API responses — never
printed as text on the page itself.

**Download as PDF** exports exactly what you can see on this page — the same field
visibility rules that hide a Field from your screen also keep it out of the PDF; you
can't export your way around a field you don't have access to.

**Repeat lead, precisely**: the tab tells you directly how it works — *"Matching is a
text search across name, phone and email, so it can catch near misses — and it does not
cover deactivated records."* Treat it as a starting point for a manual check, not an
authoritative duplicate report.

**Call history is intentionally empty in this release.** The tab says so directly:
*"Call history isn't connected yet — Calls will appear here once the Android app starts
reporting them. Nothing in the web app places or logs calls today."* There is no
telephony feature anywhere in the web app to configure — this isn't something you or an
admin can turn on.

---

## 3. Creating and editing a Seller

**New seller** (`/sellers/new`, if your role permits creating) or **Edit seller** on an
existing one opens the same form. Fields render based on each Field's type — text boxes,
a checkbox for booleans, a dropdown for select-type Fields, a textarea for long text.

Every Field shown here is one that's both mapped to the Journey you're creating/editing
against **and** visible to your role — see the admin guide's note on [why a Field might
be missing entirely](./admin-guide.md#32-three-different-reasons-a-field-can-be-missing)
if you expect one and don't see it.

**A Field can appear but be locked from editing**, with an inline hint explaining why
right next to its label:

- *"Computed automatically"* — a calculated Field; it's derived from other values.
- *"Set by the system"* — populated by the platform itself, not by hand.
- *"Locked — cannot be changed once set"* — editable only until it first gets a value.

If you see a Field with none of these hints but still can't type into it, that's a
visibility difference, not one of the above — your role likely has **View** but not
**Edit** access to that specific Field (admin guide [§5.4](./admin-guide.md#54-field-visibility)).

**Name is always required.** Email, if entered, must look like a real email address.
Journey must be chosen. Beyond that, required-ness depends on the Journey's own Field
rules (admin guide [§2.4](./admin-guide.md#24-map-fields-to-a-journey)) — some Fields
become required only once the Seller reaches a particular Status.

Saving takes you to the Seller's own page.

---

## 4. Moving a Seller between statuses

The most direct way is the **Board** (§1.2) — drag a card to another column, or use its
**Move** button. Both do the same thing: a status change with no other field values
touched.

**If a move is refused**, the reason determines what you see:

| What happened | What you'll see |
|---|---|
| You don't have edit rights on this lead | *"You don't have permission to move that seller."* — card returns to its column. |
| A required Field is missing for the destination status | A dialog: *"That move needs more information first — moving [Seller] from [old status] to [new status] needs [Field] filled in first."* with a button straight to the edit form. |
| The status itself was deactivated by an admin in the meantime | *"That status isn't available on this journey any more — the board has been refreshed."* |
| Something else went wrong | A generic error banner; the card returns to its original column either way. |

A rejected move never leaves the Seller in a half-changed state — either the whole move
succeeds, or nothing changes.

---

## 5. Moving or adding a Seller to another Journey

From a Seller's page, two separate icon buttons cover this, and they do genuinely
different things:

- **Move to another journey** — the Seller **leaves** its current Journey and picks up
  the destination Journey's statuses. Its assignments and field values travel with it.
- **Add to another journey** — the Seller **stays** where it is and **also** joins the
  destination Journey. Both memberships end up sharing one set of field values — there is
  only ever one record, not a copy.

Both ask for an optional source Journey (if the Seller is in more than one already), a
required destination Journey, and an optional starting status (defaults to the
destination Journey's own default if left blank).

**One thing worth knowing that the dialog itself doesn't say plainly**: "Add to another
journey" shares field values across both memberships, which means if you're re-adding an
existing lead through this route and change its Name/Phone/Email at the same time, be
careful — this path is built on the same mechanism as creating a brand-new Seller, and
if you leave core fields blank while adding, you risk blanking values that were already
there. If you're just adding an existing Seller to a second Journey without meaning to
change its name/phone/email, leave those fields exactly as they already are.

---

## 6. Sharing a Seller with someone else

Use **Share** in the Seller's summary panel when someone outside your normal access
needs to see (or act on) one specific Seller — rather than asking an admin to widen your
whole role.

A share grants:

- **View** — always included; can't be unchecked.
- **Edit** — optional.
- **Add notes** — optional (this is the "comment" capability under the hood).

**Every share has a duration — exactly one of 7, 30, or 60 days, chosen when you create
it. There is no permanent option.** The expiry is computed automatically from your
choice; it isn't something you can set to a specific date.

The **Current shares** list on the same panel shows everyone a Seller is currently
shared with, their capabilities, and how long until it expires. You can toggle Edit
access or **Revoke** a share entirely from there.

**A share is powerful in one specific way worth knowing**: if this Seller is sitting in
a Status where automatic assignment routing is active (see the [admin
guide](./admin-guide.md#4-assignment-routing-and-lead-visibility--read-this-before-turning-on-routing)),
normally only the current assignee and their manager chain can see it — a share is the
one thing that reaches past that restriction on purpose, for exactly the person you name.
That's what makes sharing the right tool for "this one specific colleague needs to see
this one specific lead," even when that colleague isn't in your management chain.

### Reassignment and the 30-day grace view

If your role has been granted the ability (ask an admin — this is opt-in per role, see
the [admin guide](./admin-guide.md#46-reassignment-grace-and-leadsretain_view_after_reassignment)),
you'll find a setting on your own **Settings** page (§9): *"Keep view-only access for 30
days after a lead is reassigned away from me."* Turn it on, and the moment a Seller is
reassigned away from you — whether someone did it manually or routing did it
automatically — you automatically keep 30 days of view-only access to it, so you can see
how it progresses. If you don't see this setting on your Settings page at all, your role
doesn't currently have it — ask an admin.

The **Reassign** button itself (summary panel, if you can edit the lead) doesn't mention
this — it's purely "pick a new assignee." The grace-view consequence above happens
automatically in the background if your personal setting is on.

---

## 7. Attachments (Document Locker)

The **Documents** tab on a Seller's page. **Upload** takes a name (defaults to the
file's own name if you leave it blank) and a file — no restriction is enforced in the
picker itself, but very large or unusual file types may still be rejected once you try
to upload.

**Download** streams the file through the app itself rather than linking straight to
storage — you'll see a brief "preparing download" moment before your browser's normal
save-as behaviour kicks in. This isn't a bug; it's the app re-checking your access to
this specific document on every single download, rather than handing out a link that
would work for anyone who got hold of it.

**Delete** removes a document from view (if your role allows it) but keeps a record that
it existed — deletion here is a soft delete, matching how the rest of the product treats
removal.

**If this deployment has no document storage connected**, you'll see: *"Document storage
isn't configured — this deployment has no object storage connected, so documents can't
be uploaded or retrieved."* That's an infrastructure setting outside this guide's scope
— ask an administrator.

---

## 8. Comments and the activity timeline

The **Activity** tab is the full, permanent history of a Seller: comments, field edits,
status changes, reassignments, sharing changes, and deactivation, newest first.

**Adding a comment** ("Add notes" elsewhere in the product — the same capability) uses
the composer at the top of this tab, if your role has that permission. It's tracked
separately from general edit access — you can have comment rights without edit rights,
or vice versa.

**If an entry reads "Changed fields your role can't see"** instead of showing what
actually changed: someone edited one or more Fields you don't have visibility into, and
the system is telling you a change happened without revealing values you're not
authorized to see. This is expected behaviour, not a broken entry — the same
field-visibility rule that hides a value on the Details tab hides it here too, even
retroactively in history.

---

## 9. Your settings

**Settings** (top-right, always available) covers:

- **Your profile** — name, email, role; read-only, set by an administrator.
- **Your access** — a read-only summary of what your role currently grants: how many
  Journeys, how many Fields with explicit visibility, and a full breakdown by module if
  you expand it. Useful for checking your own access before asking an admin why
  something's missing.
- **Lead reassignment** — the 30-day grace-view opt-in from [§6](#6-sharing-a-seller-with-someone-else),
  **shown only if your role has been granted the underlying permission**; if your role
  doesn't have it, this whole section is simply absent from the page (not shown disabled
  — just not there).
- **Appearance** — sidebar collapsed by default, table density (Comfortable/Compact).
  These are saved in your browser only, not on your account — they won't follow you to
  another device.
- **Session** — sign out.
- **Change password** — requires your current password; changing it signs out every
  other device you're logged in on.

**Organisation and notification preferences aren't available in this release** — that
line appears at the bottom of the page as a standing note, not a bug.

---

## 10. When something you expect to see is missing

This is the section worth bookmarking. A Seller (or a field on one) can fail to appear
for several independent reasons, and they produce different symptoms — work through them
in this order.

### 10.1 You don't see the Seller at all

1. **Check the Journey and access-mode filters first.** A Seller only shows up under a
   Journey tab if it's actually in that Journey — try "All journeys" (no tab selected)
   and set **Lead access** to **All** before concluding it's genuinely inaccessible.
2. **Do you have access to this Journey at all?** If your role has no access to a
   Journey, Sellers in it don't appear anywhere for you — not greyed out, just absent.
   Ask an admin (your **Settings → Your access** panel shows how many Journeys you
   currently have).
3. **Is it within your data scope?** Depending on your role, you may only see records
   assigned to you (`SELF`), to you and everyone reporting to you (`TEAM`), your whole
   Department, or the whole organisation. If a Seller is assigned to someone outside that
   scope and nobody has shared it with you, you won't see it.
4. **Is the Seller sitting in a Status with automatic routing active?** If so, only its
   current assignee and that assignee's manager chain can see it — regardless of your
   normal scope. See the admin guide's [routing and visibility
   chapter](./admin-guide.md#4-assignment-routing-and-lead-visibility--read-this-before-turning-on-routing)
   for the full rule. This is a common surprise for managers: if you can't see a lead
   your report is working, check with an admin that you're actually set as their manager
   (not just their Team Leader — those are different things, see the admin guide's [Teams
   vs. reporting line note](./admin-guide.md#63-teams--and-why-they-are-not-the-same-thing-as-team-reporting-line-scope)).
5. **Has someone shared it with you specifically?** Try **Lead access → Shared with me**.
   A share reaches past both #3 and #4 above, for exactly the person it names.

### 10.2 You see the Seller row, but Journey / Status / Owner show blank, "—", or "Unassigned"

This is a different situation from §10.1 — the Seller cleared whatever check let it
appear in your list at all (usually a direct share), but the specific piece of it you'd
need to see the Journey/Status/Owner details didn't clear its own, separate check. In
practice this means: you have some form of access to the *lead*, but not to the specific
*process instance* (its membership in a particular Journey, at its current Status) —
often because you don't have access to that Journey, or the same routing-based
restriction from §10.1 step 4 applies to that specific status.

**"Unassigned" is ambiguous on purpose** — it looks identical whether the Seller
genuinely has no owner, or the owner simply isn't something you're allowed to see right
now. If it matters which one it is, ask someone with broader access (or an admin) to
check.

### 10.3 A Field's value is missing on the Details tab or the edit form

See the admin guide's [three-mechanism breakdown](./admin-guide.md#32-three-different-reasons-a-field-can-be-missing) —
as a user, the short version:

- Missing everywhere, for everyone, on this Journey → it's probably not mapped to this
  Journey at all. Ask an admin.
- Missing for you specifically, but a colleague on a different role can see it → it's a
  role-visibility setting. Ask an admin to grant your role View (and Edit, if you need
  it) on that Field.
- Visible but greyed out with a hint like "Computed automatically" or "Set by the
  system" → working as intended; that Field isn't meant to be hand-edited.

### 10.4 A quick summary table

| Symptom | Most likely cause | Who can fix it |
|---|---|---|
| Seller missing from every list, every filter | No Journey access, or out of your data scope, and nobody's shared it | Admin grants Journey access / adjusts scope, or someone shares it with you (§6) |
| Seller visible to you, but not to your manager | Manager chain (`manager_id`) not set correctly, likely combined with an active routing rule | Admin sets the correct Manager field (admin guide §4.3) |
| Row shows, Journey/Status/Owner blank | You have lead-level access (often a share) but not process-instance-level access (Journey/status routing) | Admin grants Journey access, or checks routing/visibility for that Status |
| Field missing everywhere on this Journey | Not mapped to this Journey | Admin maps it (admin guide §2.4) |
| Field missing just for you | Role visibility not granted | Admin grants Field visibility (admin guide §5.4) |
| Field visible but greyed out with a hint | Edit mode (calculated/system/locked) | Working as intended |
| Timeline entry says "Changed fields your role can't see" | Field visibility again, applied retroactively to history | Admin grants Field visibility if you need to see it |

---

## 11. Known limitations

- **No bulk actions.** Every row action on the Seller List and Board is single-record.
- **No saved/named filter views** — filters live in the page URL only.
- **Repeat lead is a plain text search**, not real duplicate detection, and it never
  checks deactivated records.
- **No Tasks or reminders** — nothing in the product currently creates a task or
  follow-up reminder for you automatically, regardless of a Seller's status.
- **No call history.** The Call History tab is a deliberate placeholder — calls are
  meant to arrive from a separate Android app in a future release; nothing in the web
  app places, logs, or displays calls today.
- **Document storage may not be connected** in some deployments — if so, the Documents
  tab will tell you plainly rather than fail silently.
- **No malware scanning** on uploaded documents — files are checked by type, not
  content-scanned.
- **No self-service "Forgot password?"** — if you're already set up but locked out, an
  administrator has to help; there's currently no in-product way to request a new reset
  link yourself once you already have a password.
- **Organisation and notification preferences aren't available yet** — Settings covers
  personal/session preferences only.

---

## 12. Needs confirmation

Nothing in this guide was left undocumented for lack of evidence — everything described
above was confirmed directly against the running UI and its underlying routes. There are
no open items here.
