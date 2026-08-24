# Tally — Frontend Design System

> **Financial control room:** a light-first, audit-oriented interface for inspecting bank-to-books reconciliation decisions.

This document is the visual and interaction contract for the three product surfaces. It is intentionally specific enough to guide future implementation, but it does not prescribe application architecture or introduce frontend code.

## Scope and product surfaces

Implementation technology and current repository state are defined by `AGENTS.md` and the repository itself. This document defines visual and interaction behavior and must not be treated as the source of truth for package or framework state.

The product surfaces are:

| Route | Job to be done | Visual posture |
| --- | --- | --- |
| `/` | Understand a reconciliation run and find records needing attention | Dense operational ledger |
| `/trace` | Reconstruct the real execution path for one decision | Execution debugger / audit trail |
| `/docs` | Explain research, architecture, experiments, and measured results | Editorial engineering report |

The interface is not a marketing site, generic SaaS dashboard, chatbot, or AI showcase. Its visual promise is trust, control, auditability, precision, and operational clarity.

## Design principles

1. **Evidence before spectacle.** Every visual element should help someone inspect a record, compare values, understand a decision, or take a bounded action.
2. **Flat hierarchy.** Use canvas shifts, alignment, whitespace, and hairline rules before cards, shadows, or decoration.
3. **Color carries meaning.** Neutral UI is the default; semantic color is reserved for outcome, verification, exception, selection, and interaction states.
4. **Tables are first-class.** Structured financial data belongs in aligned tables or structured lists, not in a grid of oversized KPI cards.
5. **The system must tell the truth.** `/trace` renders recorded execution events only. Never invent thinking, streaming, chain-of-thought, or decorative pipeline activity.
6. **Density is deliberate.** Compact does not mean cramped: preserve readable row height, clear grouping, and enough whitespace to prevent scanning errors.
7. **Progressive disclosure, not hidden evidence.** Secondary details may live in a drawer or disclosure panel, but the outcome, reason, and next action must remain discoverable.

## Application shell

Use a compact persistent top navigation across all three routes.

- Left: Tally product mark/name.
- Primary navigation: Dashboard, Trace, Docs.
- Right: run context and actions only when relevant.

The navigation consumes minimal vertical space and feels like part of an operational tool, not a marketing navbar. The active route uses text emphasis plus a restrained bottom indicator or subtle background; do not use large navigation pills.

`/trace` may expose the current reconciliation run/record context beneath the global navigation. `/docs` retains the same global shell, with its own secondary documentation navigation inside the page. Prefer this compact top bar over a sidebar: there are only three top-level surfaces, so a sidebar would consume space without enough navigation depth to justify it.

## Visual synthesis from the references

The references are research inputs, not templates:

- [Stripe on Refero](https://styles.refero.design/style/48e5de76-05d5-4c4e-a269-c7c245b291ec) informs financial precision, restrained hierarchy, numerical typography, tables, and hairline separation.
- [Seline Analytics on Refero](https://styles.refero.design/style/7967c6d9-e50c-42b5-b4d1-74003ba41781) informs warm-neutral surfaces, flat analytical composition, and compact dashboard grouping.
- [Linear on Refero](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) informs the trace’s inspector-like density, compact controls, event framing, and technical clarity.

The synthesis for Tally is light-first and warmer than Stripe, more operationally dense than Seline’s editorial dashboard, and less brand-led or dark than Linear’s product presentation. Do not copy any reference’s palette, radii, hero composition, or component defaults.

## Tokens

Token names are implementation-facing recommendations. Keep them centralized in the web app once a styling layer is introduced.

### Color

Use the following small palette. Semantic colors must be paired with text or an icon; color alone never carries a result.

| Token | Value | Role |
| --- | --- | --- |
| `--color-canvas` | `#F7F7F5` | App background; warm off-white, not pure white |
| `--color-surface` | `#FFFFFF` | Table, drawer, and contained surface background |
| `--color-surface-subtle` | `#F1F1EE` | Quiet bands, selected-neutral areas, disabled backgrounds |
| `--color-ink` | `#171817` | Primary text, headings, important values |
| `--color-ink-secondary` | `#4F514E` | Supporting text and descriptions |
| `--color-ink-muted` | `#6F726D` | Labels, metadata, placeholders; not for critical values |
| `--color-border` | `#D9DAD5` | Primary hairline rules and field borders |
| `--color-border-subtle` | `#E8E8E3` | Table row rules and quiet separators |
| `--color-accent` | `#245FA6` | Links, selected controls, informational emphasis, focus ring |
| `--color-accent-soft` | `#E8F0F8` | Selected row/control background and informational callout |
| `--color-success` | `#18794E` | Verified / reconciled |
| `--color-success-soft` | `#E8F4ED` | Success background |
| `--color-warning` | `#9A5B00` | Ambiguous / review required |
| `--color-warning-soft` | `#FFF3DD` | Warning background |
| `--color-danger` | `#B42318` | Exception / failed verification |
| `--color-danger-soft` | `#FDECEA` | Danger background |

Do not add gradients, neon colors, purple AI branding, large accent fills, or decorative chromatic palettes. Verify contrast for every text/background pairing; muted text is for secondary context only.

### Surfaces, borders, and shape

- Page canvas is `--color-canvas`; use white surfaces only where containment improves scanning.
- Prefer a 1px border or a background shift over elevation.
- Default radius is `4px` for controls and contained surfaces. Use `6px` only for larger drawers/dialogs when needed. Avoid giant radii and pill-shaped ordinary UI.
- Pills are reserved for compact status treatments where the shape improves rapid scanning; ordinary labels, filters, and buttons are rectangular.
- Do not use shadows by default. A subtle shadow is allowed only for an overlay that must separate from content, and must remain visually subordinate to its border.

### Spacing and layout

Use a 4px base unit: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64` px. The operational default is 16px internal spacing and 24px between related regions.

- App content max width: `1440px`, with 24px side padding on desktop.
- Minimum interactive target: 36px desktop; 44px touch target where practical.
- Dashboard first viewport: compact run context, summary metrics, outcome distribution, and the beginning of the records table. Do not spend the first viewport on a hero.
- Align page titles, filters, tables, and detail panels to the same content grid.
- Operational surfaces may use the available viewport up to the 1440px application maximum. Do not constrain financial data tables to editorial reading widths.
- Use left alignment for operational content. Center alignment is reserved for empty states or isolated confirmation messages.

## Frontend Styling Implementation Rules

These rules are part of the design system and are mandatory for every frontend task.

### Tailwind CSS is the primary styling system

All page and component styling must be implemented primarily with **Tailwind CSS utility classes**.

Use Tailwind for:

- layout (`flex`, `grid`, spacing, sizing, alignment)
- typography
- backgrounds and surfaces
- borders and radii
- interactive states
- responsive behavior
- tables
- forms
- buttons
- filters
- status treatments

Component/page-specific handwritten CSS should not be the default implementation strategy.

### Global CSS is limited to global concerns

Plain/global CSS may be used only for concerns that genuinely belong at the application level, including:

- Tailwind setup/imports
- design-system CSS custom properties
- font declarations
- document/body defaults
- global reset/base rules
- global accessibility behavior
- exceptional styles that Tailwind cannot reasonably express

Do not create page-specific selectors such as:

```css
.dashboard {}
.run-form {}
.summary-card {}
.result-row {}
```

## Typography

Prefer system/project-available fonts first; do not add a font dependency solely to imitate a reference. Use a readable sans for interface and documentation, with a monospace fallback only for machine identifiers and code.

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
```

| Role | Size / line height | Weight | Treatment |
| --- | --- | --- | --- |
| Page title | 24 / 30px | 600 | Compact, left aligned; no marketing display type |
| Section title | 16 / 22px | 600 | Clear region label |
| Body UI | 14 / 20px | 400 | Default controls, descriptions, and table text |
| Compact body | 13 / 18px | 400 | Dense metadata and secondary table content |
| Label | 11 / 16px | 600 | Uppercase only for short structural labels; letter spacing `0.04em` |
| Numeric value | 20–28 / 1.1 | 600 | Tabular numerals; use only where hierarchy warrants |
| Table amount | 13–14 / 20px | 500 | Right aligned; tabular numerals |
| Reference / ID | 12 / 18px | 400 | Monospace; never use monospace for all UI |
| Trace metadata | 12 / 18px | 400 | Monospace for event IDs/timestamps; sans for labels |
| Docs prose | 16 / 26px | 400 | Article measure 680–760px |
| Code | 13 / 20px | 400 | Monospace in a bordered, scrollable block |

Apply `font-variant-numeric: tabular-nums lining-nums` to amounts, counts, percentages, dates, and metric values. Use sentence case by default. Strong emphasis may use 600; avoid heavy 700 headings and oversized type inside application screens.

## Data-first rules

### Financial data

- Display currency explicitly when a table mixes currencies; use the project’s canonical currency code and locale-aware formatting.
- Amounts are right aligned and use consistent decimal precision within a column. Never align currency symbols by inserting spaces.
- Percentages use one consistent precision per metric; show the `%` sign and do not rely on color to express performance.
- Dates use a consistent human-readable format in primary UI; timestamps include timezone or an explicit timezone label. Machine timestamps may appear in trace metadata.
- IDs, transaction references, event IDs, and structured keys use monospace and may truncate visually only if the full value is available to copy or inspect.

### Tables and dense rows

- Tables are the default for comparable record data. Use a visible header, clear column labels, and a minimum 44px row height; 40px is acceptable for highly dense trace/event tables.
- Align text left, amounts and numeric metrics right, and status/state cells left with icon + text.
- Keep row rules subtle and consistent. Do not alternate strong zebra stripes.
- Headers are 11–12px, 600 weight, muted ink; sortable headers expose a chevron and an accessible sort label.
- Filters should be adjacent to the table, preserve the current query in the URL when appropriate, and show the active filter count.
- Hover changes the row background only. Selection uses `--color-accent-soft` plus a 2px inset/leading accent; do not rely on hover to reveal critical information.
- Exception rows may use a restrained danger/warning edge or soft background, never a full bright fill.
- A selected row opens context in a responsive detail region or drawer; the table stays legible and the selection remains visible.
- Empty states explain why there are no records and provide the next relevant action. Loading states preserve table geometry with quiet skeleton rows; do not animate numbers or simulate AI activity. Error states state what failed, whether existing data is stale, and how to retry.

### Status and confidence

Render the canonical reconciliation outcome states from the contracts package. `DESIGN.md` does not define or rename domain states. Their visual roles should follow:

- successful reconciliation → success treatment;
- explained/review state → warning or neutral treatment as defined by domain semantics;
- discrepancy → danger treatment;
- unresolved → warning or danger treatment according to severity.

Pair each state with an icon and text. Confidence is a supporting signal, not the outcome: show a numeric score with its scale and a short explanation of what it means. Never make a low-confidence match look successful through color or size.

Matched pairs should show bank and ledger references, amounts, dates, and the evidence/rule that connected them. Exception rows should expose the reason code and the next inspection path without requiring hover.

## Route specifications

### `/` — Reconciliation Dashboard

Hierarchy, in order:

1. **Run context:** run identifier, source/batch context, run status, started/completed time, and refresh/re-run affordance if supported.
2. **Summary metrics:** processed, outcome counts, resolution rate, and benchmark/quality metrics such as precision or false-reconciliation rate when available for the current run or evaluation context. Use a compact aligned metric strip or table-like grid, not oversized cards.
3. **Outcome distribution:** a compact bar or segmented distribution with labels and counts. The legend must remain understandable without color.
4. **Records region:** the visual center of gravity. Place search, outcome/type filters, and sort controls above the primary table.
5. **Record detail:** when selected, show evidence, candidate records, applied deterministic rule, agent proposal, verifier result, and final outcome. Use a right-side inspector on wide screens; use a drawer or stacked detail region on narrow screens.

The first viewport should answer: which run, how many processed, how successful, how many need attention, and which records need inspection. Avoid a giant intro, a four-card KPI cliché, or critical information hidden below a decorative section.

### `/trace` — Reconciliation Trace

Use a split trace + inspector layout on desktop: a vertical execution timeline/event stream on the left at roughly 35–45% width and the selected event’s structured details on the right at roughly 55–65% width. On smaller screens, stack the inspector below the event list or open it as a drawer.

Render only recorded events and stop the trace when the actual pipeline stops. Expected stages may include normalization, deterministic rules, candidate generation, agent evaluation, verification, and final outcome; use the event’s canonical stage/type values rather than inventing new domain states.

Each event should be able to show stage, event type, status, timestamp/duration when available, input/output summary, applied rule, candidate information, verifier checks, and final reason. Pipeline stage identity and reconciliation outcome are separate visual dimensions. Do not use success/warning/danger colors simply to distinguish deterministic, agent, and verifier stages. Stage identity should primarily use a stage icon, label, typography, and a subtle neutral/accent marker. Use restrained stage treatment: deterministic rules use neutral graphite; candidate/agent operations use restrained accent blue; verifier uses a neutral treatment with a stronger border or verification icon; final outcome uses the actual semantic outcome color. Semantic green/amber/red remains reserved for the result/status of an event. Do not use fake thinking animations, neural visuals, streaming reasoning, or invented events.

Event expansion is a disclosure interaction with a clear open/closed state. Structured JSON or IDs may use monospace; explanatory text remains sans-serif. The most important terminal outcome remains visible in the trace header or final event.

### `/docs` — Engineering / Research Documentation

Use the same canvas, ink, border, semantic colors, and controls as the application, with a more editorial reading measure.

- Article column: 680–760px; optional 220–240px sticky section navigation on wide screens.
- Page title: 28–32px; section headings: 20–24px; prose: 16px / 26px.
- Keep headings left aligned and use visible hierarchy rather than decorative banners.
- Callouts use a 3px semantic leading rule and a pale semantic surface; they must not look like marketing quote cards.
- Tables support benchmark metrics, case types, and experiment results with the same numeric alignment rules as the dashboard.
- Code blocks use bordered surfaces, horizontal scrolling, copy affordances, and readable line height.
- Diagrams should explain architecture or event flow using the same thin rules and semantic stage colors; no ornamental 3D or glowing graphics.
- Citations/references are compact, readable links with source context. Do not bury research provenance in tooltips.

## Component contract

Treat any future shadcn/ui components as implementation primitives, not as the product identity. Adapt them to these tokens and avoid accepting default rounded/shadow-heavy styling blindly.

- **Buttons:** rectangular, compact, 36–40px high. Primary uses the restrained blue accent for an important action; secondary is white with a hairline border; destructive uses danger only for destructive actions. Text is concise and action-led.
- **Icon buttons:** 36px square with a visible tooltip for unfamiliar icons, accessible name, and a clear hover/focus state. Use Phosphor Icons as the single icon family, with regular/outline treatments at roughly 1.5px stroke.
- **Inputs/selects/dropdowns:** 36–40px high, 4px radius, white surface, 1px border, visible focus ring. Labels are persistent; placeholders are not labels.
- **Tabs:** compact text tabs with a bottom/leading active rule or subtle selected surface; do not turn every tab into a pill.
- **Badges/status indicators:** compact and semantic, icon + text. Reserve pills for statuses or compact filters, not ordinary labels.
- **Tooltips:** supplemental only; never the only place where meaning or evidence is available.
- **Drawers/dialogs:** use for record/event detail when context must be preserved. Strong title, close button, focus trap, escape handling, and clear scroll behavior. No oversized modal artwork.
- **Filters/pagination:** keep controls adjacent to the dataset; show active state, result count, and keyboard-accessible operation. Preserve table headers while paging or virtualizing.
- **Cards/surfaces:** use only to contain a meaningful region such as an inspector, callout, or summary block. Do not wrap every element in a card.
- **Alerts:** concise, semantic, actionable, and dismissible only when dismissal is safe. Include a heading when the message is more than one sentence.
- **Empty/error/loading states:** explain state and next action; retain layout stability and do not imply progress that the system cannot observe.

Use Phosphor Icons consistently throughout the product. Do not mix icon families; keep icon usage subordinate to labels and data, with accessible names for icon-only controls.

## Motion

Motion is functional and quiet: hover/focus transitions, row selection, disclosure expansion, and drawer/dialog entry are allowed. Prefer 120–200ms ease-out transitions. Do not animate financial numbers, add page theatrics, glow, bounce, spring physics, or AI thinking states. Respect `prefers-reduced-motion` by removing nonessential transitions and preserving immediate state changes.

## Accessibility

- Meet WCAG-appropriate contrast for all text and controls; validate semantic foreground/background pairs rather than guessing from swatches.
- Use semantic HTML: headings in order, real buttons/links, table semantics, labelled form controls, and live regions only for meaningful status changes.
- Provide a visible 2px focus indicator using the accent color with sufficient contrast against the current surface.
- Every status has text and/or an icon in addition to color. Green/amber/red must remain distinguishable in grayscale.
- Make table sorting, filtering, selection, disclosure, drawers, and pagination keyboard accessible. Announce selection and important async results to assistive technology.
- Keep targets at least 36px on desktop and aim for 44px on touch layouts.
- Support zoom/reflow without losing table meaning; provide horizontal scrolling or a structured mobile alternative for wide tables.

## Responsive strategy

Desktop prioritizes simultaneous comparison: persistent run context, table, and inspector can share the viewport. At medium widths, reduce side padding and collapse secondary metadata before reducing type. At narrow widths:

- stack run context and metric groups;
- keep the primary table’s most decision-relevant columns visible and move secondary evidence into a row detail view;
- turn the inspector into a drawer or an inline disclosure;
- keep filters usable with horizontal scrolling or a filter sheet;
- preserve amount alignment and reference copyability;
- stack documentation navigation above/alongside the article;
- keep trace stages readable as a vertical list with detail below each selected event.

Never solve responsiveness by simply shrinking critical financial text until it is hard to compare.

## Prohibited patterns

Do not use gradients, glassmorphism, neon AI styling, default purple AI branding, giant hero sections, oversized KPI cards, excessive cards, giant radii, pills for ordinary labels, pervasive shadows, centered operational content, decorative animations, fake loading/thinking states, hidden AI reasoning, fake trace events, or styling chosen only because it looks fashionable.

The recurring anti-pattern to reject is: **four giant KPI cards + purple gradient + huge title + excessive whitespace + pills everywhere**.

## Implementation guardrails

Before feature work begins, create shared tokens and primitives from this document, then verify them on the three route shells. Keep route-specific composition in route components and keep semantic state names aligned with the contracts package. Do not modify business logic, trace recording, outcome semantics, or data contracts as a visual shortcut.

When a new component or visual pattern is proposed, ask:

1. Does it improve inspection, comparison, explanation, or safe action?
2. Is it consistent with the neutral, flat, precise system?
3. Does it preserve semantic status and accessible non-color cues?
4. Does it keep real evidence visible and avoid inventing system behavior?

If the answer is no, omit the pattern or document the functional exception alongside its implementation.
