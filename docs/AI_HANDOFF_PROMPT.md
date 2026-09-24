# Paste this to the MRF AI

You are implementing the SMART design system in the MRF codebase.

Attached are design handoff documents. Each one is a self-contained spec extracted from the SMART system — reference code, exact class strings, tokens, and motion values are embedded. Implement them in MRF exactly as specified.

## Rules

1. **Use MRF's own content.** The navigation items, table columns, labels, notification rules, actions, and data in the docs are placeholders. Replace them with MRF's real content, data sources, routes, and auth. Do not invent content from the docs.
2. **Keep every visual specification exactly.** Class strings, dimensions, colors/design tokens, radii, spacing, durations, easings, and icon sizes are not suggestions. Do not restyle, "improve", or substitute your own design choices.
3. **Obey the Hard rules / KEEP / DO NOT sections.** These are the review criteria; they exist because those are the most common points of design drift.
4. **Scope: Admin and MRF staff portals only.** Do not modify MRF's student/teacher landing/login page, and do not share components, routes, or styles with it.
5. **The shell is already done.** The sidebar/topbar handoff was delivered earlier and defines the global foundation: DM Sans font, design tokens, icon rules, layout geometry. All other documents build on it — do not redefine those tokens.
6. **Adapt the stack, not the design.** If MRF does not use the same libraries (React/Tailwind/Base UI), implement with MRF's stack but keep every computed value and class recipe identical. The docs include computed values for this reason.
7. **No new primitives beyond what the docs specify.** In particular, MRF has no data-entry forms — do not add labels, checkbox/radio, help tooltips, or validation-layout primitives.

## Order of work

Implement in this order (each document is independently implementable after the first):

1. `AI_HANDOFF_PAGES_BRANDING.md` — page scaffolding, PageHeader, loading gate, runtime branding
2. `AI_HANDOFF_TABLES.md` — DataTable family
3. `AI_HANDOFF_MODALS_DRAWERS.md` — dialogs, AppModal, ConfirmDialog, drawers
4. `AI_HANDOFF_NOTIFICATIONS_FEEDBACK.md` — notification bell, toasts, banners, loaders
5. `AI_HANDOFF_BUTTONS_INPUTS.md` — buttons, inputs, textarea, select
6. `AI_HANDOFF_DATA_DISPLAY.md` — cards, stats, badges, avatars, tabs, menus

## After each document

Run the **Acceptance criteria** checklist at the end of that document and report back:

- items passed
- items not applicable (with why)
- any deviation (with the reason and the exact file/line)

Report per document before moving to the next one. Do not summarize or skip the checklists.

Start with document 1: give me a short implementation plan (files to add/change), then implement.
