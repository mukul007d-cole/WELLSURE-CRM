# UI modernization delivery tracker

This tracker records implementation progress against the approved incremental UI modernization plan. It does not change Falcon's canonical data model or permissions.

| Phase | Status | Delivered | Remaining dependency or work |
| --- | --- | --- | --- |
| 1. Design system | In progress | Wellsure `#FFF200` palette, interaction tones, neutral working surfaces, measured contrast for focus/controls/accents | Component-state visual regression sweep |
| 2. Shell and navigation | In progress | Light workspace top bar, responsive Seller search, permission-aware quick create, shortcut help, skip link | Command-style Seller results require an approved search endpoint; broader quick create waits on implemented modules |
| 3. Seller list | In progress | URL-backed filters, access modes, export, density, responsive rows, server sorting, and browser-persisted core column visibility | Shared/synced saved views, dynamic-field columns, and bulk actions require approved persistence/metadata/bulk contracts |
| 4. Seller 360 | In progress | Explicit Journey context selection for multi-Journey records and contextual actions | Configurable highlight metadata and Tasks APIs are not available |
| 5. Journey board | In progress | Accessible drag/drop, Move fallback, responsive columns, permission handling, and factual last-updated context | Next-action, overdue, and SLA signals require authoritative task/SLA timestamps |
| 6. Dashboard and analytics | Blocked by API | Permission-safe existing counts and recent records | Action queues and outcome metrics require authoritative aggregate/Tasks endpoints |
| 7. Administration | In progress | Existing permission-aware editors remain intact; Journey, Field, Role, and Campaign editors protect browser-level exits, and only when the draft actually differs from what was loaded | Shared editor layouts, in-app route blocking, and focused editor regression work |
| 8. Interaction/responsive polish | In progress | Responsive shell/search, reduced-motion behavior, one `Popover` primitive behind every anchored menu | Toast/drawer primitives and device-matrix review |
| 9. Final QA | Not started | Existing unit, integration, permission, and accessibility foundations | Full WCAG 2.2 AA, role matrix, performance, visual regression, and device/browser acceptance |

## Colour rules the yellow makes load-bearing

`#FFF200` is 1.17:1 against white. That is fine for a surface carrying ink text
(16.8:1) and disqualifying for anything that has to be *seen* on a light ground,
so the palette splits the brand into three jobs:

| Token | Job | Measured |
| --- | --- | --- |
| `--color-gold` | a fill with ink text on it, or any mark on the ink sidebar | 16.8:1 against ink text |
| `--color-gold-foreground` | the brand as a mark on a light ground — active-tab underline, spinner, selected-journey rail, meter fill | 6.6:1 on `surface` |
| `--color-focus-ring` | focus, which is ink on light and yellow on the ink sidebar | 19.7:1 on `surface`, 16.8:1 on ink |

`--color-control-border` is split out of `--color-line-strong` for the same
reason: a decorative hairline may be faint, but the edge of an input, select,
textarea, checkbox or secondary button is information (WCAG 1.4.11) and owes
3:1. It measures 3.54:1 on `surface`, 3.30:1 on `paper`, 3.18:1 on
`surface-sunken`.

## Guardrails

- Seller/Lead remains the canonical record; no Contacts, Companies, Accounts, or Deals were introduced.
- Status remains the single configurable state inside a Journey process instance.
- The UI never derives authoritative metrics, tasks, financial values, or attention signals from incomplete list data.
- New list, aggregate, saved-view, preview, and bulk surfaces must remain permission-safe at the API layer.
- No business configuration name is hardcoded into application behavior.
- Yellow is never a foreground, a focus indicator, or the sole carrier of a
  state on a light surface.
- Every anchored panel closes on Esc, on an outside press, and on focus leaving
  it, and returns focus to its trigger — `Popover` provides that once rather
  than each site providing a different subset.
