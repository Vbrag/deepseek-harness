---
name: dsh-visualize
description: Decide when a visual is warranted, choose the smallest composition that answers the question, and route authoring to the owning DeepSeek Harness surface — Univer Units for charts, dashboards, decks, diagrams and maps, dsh-client-ui-ux for in-app UI, record-browser-gif for demos. Use when asked to show, compare, explain, preview, or explore something visually, and when choosing between a table, chart, map, diagram, mockup, or deck.
---

# Choosing and routing a visualization

This skill owns **judgment**: whether a visual is warranted, which composition is smallest, and which existing DSH surface authors it. It does not own rendering. Load the owning skill and follow its workflow; do not re-implement rendering, styling, or responsive behavior here.

## When to visualize

Create a visual when the reader must **see** a relationship that prose would obscure: shape over time, distribution, composition, geographic position, spatial or structural relationships, or a proposed interface they will evaluate. A visual is warranted when it materially improves a decision or an explanation.

Do **not** create one when:

- A plain Markdown table answers it — return the table.
- Labeled nodes and edges fully explain a static structure — use a fenced Mermaid block in the response.
- The request is for a project file, site, or app change rather than an explanation. That is ordinary authoring work, not a visualization task.
- The request merely mentions data, a chart, or an interactive page while asking for something else.

State the purpose of each visual in one line. A visual without a stated question it answers is decoration.

## Choose the smallest composition

Prefer the least machinery that answers the question, and stop there.

| Question shape | Smallest composition |
|---|---|
| Exact values, few rows/columns | Markdown table in the response |
| Static structure with labeled nodes and edges | Fenced Mermaid in the response |
| Magnitude, trend, distribution, correlation | One native chart |
| Composition or part-to-whole | One stacked or share chart |
| Position or region | One map |
| Relationships, flows, hierarchy, sequence, UML | One Board diagram |
| A proposed screen, dialog, or control to evaluate | One mockup |
| Several views that must stay comparable together | One dashboard, composed by embedding |
| Ordering of events across time with duration | One timeline, waterfall, or flame-style chart |

Rules that keep the composition small:

- One visual per question. Do not duplicate the same data as a chart and a table and a heatmap.
- Prefer interaction detail over permanent toolbars, repeated legends, and stacked panels.
- Add only controls the request implies. Never invent search, filter, reset, or variant-switcher chrome.
- Show only measures that explain the requested behavior. No decorative metric cards or fact grids to fill space.
- Stack independent views vertically rather than forcing them side by side past the available width.

## Route to the owning surface

Each surface owns its own workflow, tools, and verification. Load the owning skill by name and follow it; never restate its rules here.

| Deliverable | Owning surface |
|---|---|
| Chart, table, pivot, editable data | `univer-sheet`, loaded after `univer` |
| Deck, page-by-page presentation | `univer-slide`, loaded after `univer` |
| Diagram, flowchart, mind map, relationship or UML sketch | `univer-board`, loaded after `univer` |
| Document with rich tables and narrative | `univer-doc`, loaded after `univer` |
| Structured records, views, formulas | `univer-base`, loaded after `univer` |
| Dashboard composing several Units | `univer-embed`, loaded after `univer` |
| Cross-Unit formula or live chart reading another Unit | `univer-cross-unit-formula` |
| The DSH product's own in-app UI | [dsh-client-ui-ux](../dsh-client-ui-ux/SKILL.md), with [dsh-responsive-ui](../dsh-responsive-ui/SKILL.md) for width and touch behavior |
| A recorded demo of a GUI workflow | [record-browser-gif](../record-browser-gif/SKILL.md) |

Start every Univer deliverable by loading `univer` and calling `univer_status`; it owns the worktree, tool, and handoff sequence. This skill only decides *which* Unit kind to ask for.

## Method guidance for any visual

These are cross-cutting quality rules. Where a surface already publishes a rule — Univer's palettes and chart APIs, or [dsh-client-ui-ux](../dsh-client-ui-ux/SKILL.md) and the web styling reference it names — that surface wins.

**Data integrity.** Preserve values, precision, units, grain, population, and denominators. Numbers stay numbers; a missing value is unknown, a measured zero is zero. Never invent, silently round, or drop data to make a chart look cleaner. Keep series and category mappings stable across filters and states. Recompute counts and rates together after any filter. Show a gap when a denominator is missing or zero, and do not infer counts from a rounded rate.

**Color.** Let the owning surface supply theme tokens; never hardcode light or dark palettes, and never write a literal white, black, or slate value. Encode a category or series consistently on the marks, not only in the legend, and pair color with a label, shape, or line style so meaning survives grayscale and color-vision differences. Keep large fills subtle, keep values and axis text in the surface's foreground or muted tokens, and reserve accent colors for genuine identity or state rather than decorating peers differently.

**Typography and structure.** One concise visible heading for a self-contained visual; do not restate the prompt. Use tabular figures for changing or aligned numbers. Keep chart grids and inactive structure thin and neutral. Use one mechanism per state rather than layering a tooltip, a badge, and a caption for the same fact.

**Accessibility.** Use semantic elements, native controls, and keyboard-reachable interaction. Announce dynamic results and selections with a polite live region; reserve alerts for validation errors. Keep essential content and actions available without hover. Maintain readable contrast on the actual background, not an assumed one. Provide a non-visual alternative — a concise table or text summary — for any chart that carries a decision.

**Layout.** Keep the top-level surface unframed and let it fill the available width. Design for the narrow case first, then widen; stack side-by-side content when it no longer fits. Every label, control, and value must fit without overlap or clipping at the narrowest supported width. Avoid fixed outer widths, internal scrolling, and viewport-height layouts when the host sizes to content.

**Maps and spatial views.** Use sourced geometry and a stated projection, keep the data's own coordinate system, and label scale or orientation. Never invent coastline, boundaries, or positions to fill a frame.

## Verify before handing off

A visual is not done when the file is written; it is done when it has been inspected.

- **Univer deliverables:** inspect with `univer_inspect`, run `univer_lint` on every changed Slide page, and capture `univer_screenshot` to confirm the rendered result. Export with `univer_export` or print with `univer_print_pdf` only after the render is verified.
- **In-app UI:** apply the verification loop [dsh-client-ui-ux](../dsh-client-ui-ux/SKILL.md) requires, including the affected rendered states.
- **Recorded demos:** follow [record-browser-gif](../record-browser-gif/SKILL.md) and check the resulting frames.

Report what the visual lets the reader see or decide, briefly. Do not narrate which surface, tool, file, or markup produced it.

## One owner per rule

This skill owns: the decision to visualize, the smallest-fit choice, the routing matrix, and the cross-cutting method rules above. It delegates artifact authoring and its palettes, chart APIs, and render verification to the `univer-*` skills; in-app UI design, tokens, and responsive behavior to [dsh-client-ui-ux](../dsh-client-ui-ux/SKILL.md) and [dsh-responsive-ui](../dsh-responsive-ui/SKILL.md); and demo capture to [record-browser-gif](../record-browser-gif/SKILL.md). When guidance here and an owning surface disagree, the owning surface wins and this file should be corrected.
