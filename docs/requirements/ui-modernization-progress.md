# UI modernization delivery tracker

This tracker records implementation progress against the approved incremental UI modernization plan. It does not change Falcon's canonical data model or permissions.

| Phase | Status | Delivered | Remaining dependency or work |
| --- | --- | --- | --- |
| 1. Design system | In progress | Wellsure `#FFF200` palette, interaction tones, neutral working surfaces | Complete component-state visual regression and contrast audit |
| 2. Shell and navigation | In progress | Light workspace top bar, responsive Seller search, permission-aware quick create, shortcut help, skip link | Command-style Seller results require an approved search endpoint; broader quick create waits on implemented modules |
| 3. Seller list | In progress | URL-backed filters, access modes, export, density, responsive rows, server sorting, and browser-persisted core column visibility | Shared/synced saved views, dynamic-field columns, and bulk actions require approved persistence/metadata/bulk contracts |
| 4. Seller 360 | In progress | Explicit Journey context selection for multi-Journey records and contextual actions | Configurable highlight metadata and Tasks APIs are not available |
| 5. Journey board | In progress | Accessible drag/drop, Move fallback, responsive columns, permission handling, and factual last-updated context | Next-action, overdue, and SLA signals require authoritative task/SLA timestamps |
| 6. Dashboard and analytics | Blocked by API | Permission-safe existing counts and recent records | Action queues and outcome metrics require authoritative aggregate/Tasks endpoints |
| 7. Administration | In progress | Existing permission-aware editors remain intact; long-running Journey, Field, Role, and Campaign editors protect browser-level exits with unsaved work | Shared editor layouts, in-app route blocking, and focused editor regression work |
| 8. Interaction/responsive polish | In progress | Responsive shell/search and established reduced-motion behavior | Consistent toast/drawer/menu primitives and device-matrix review |
| 9. Final QA | Not started | Existing unit, integration, permission, and accessibility foundations | Full WCAG 2.2 AA, role matrix, performance, visual regression, and device/browser acceptance |

## Guardrails

- Seller/Lead remains the canonical record; no Contacts, Companies, Accounts, or Deals were introduced.
- Status remains the single configurable state inside a Journey process instance.
- The UI never derives authoritative metrics, tasks, financial values, or attention signals from incomplete list data.
- New list, aggregate, saved-view, preview, and bulk surfaces must remain permission-safe at the API layer.
- No business configuration name is hardcoded into application behavior.
