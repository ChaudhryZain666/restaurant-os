# Menu Import Architecture (Phase 30)

Onboarding speed was the real product problem this phase closes: a restaurant with an existing
menu of dozens or hundreds of items had no way to get it into the platform except one item at a
time through the admin editor. This is a bulk CSV/Excel importer built entirely on top of the
existing menu domain (`MenuItem`/`Category`/`ModifierGroup`) — no schema changes, no new write
model, no parallel authorization system.

## Supported file types

- **CSV** — any standard comma-separated file, UTF-8 (a leading BOM is stripped automatically).
- **Excel (.xlsx)** — only the **first worksheet** is read. A workbook with additional sheets
  imports successfully but reports the ignored sheet names back in the preview
  (`extraSheetsIgnored`) — never silently merged, never silently dropped without telling the user.
- Both produce the exact same internal `NormalizedImportRow` shape before anything else happens —
  see "Future importer architecture" below for why this matters.
- Files over 5,000 data rows are rejected outright with a clear error, before any parsing work
  begins.

## Supported columns

Column headers are matched case- and formatting-insensitively — `Category`, `category_name`, and
`CATEGORY NAME` all resolve to the same field. Recognized column names, by field:

| Field | Required | Recognized header variants |
|---|---|---|
| Category | **yes** | category, category name, section, menu section |
| Item name | **yes** | item name, item, name, product name, title, menu item |
| Description | no | description, desc, details, item description |
| Price | **yes** | price, cost, item price, amount |
| Available | no | available, is available, availability, in stock, active |
| Sort order | no | sort order, order, sort, position, display order |
| Image URL | no | image, image url, photo, picture, img, image reference |
| Modifier group | no | modifier group, modifier group name, option group, variant group |
| Modifier option | no | modifier option, modifier option name, option name, variant name |
| Modifier price | no | modifier price, option price, modifier amount, variant price |
| Modifier min select | no | modifier min, modifier min select, min select, min |
| Modifier max select | no | modifier max, modifier max select, max select, max |

If a file's headers don't auto-match, the wizard's **column mapping** step lets the user manually
assign each source column to one of the fields above (or "Ignore this column") before continuing —
required fields left unmapped block progress with a specific, named error rather than a guess.

A downloadable sample template (`apps/admin/public/menu-import-template.csv`) demonstrates the
full column set, including one item with two modifier groups.

## Value normalization

- Whitespace is trimmed and collapsed; category/item names beyond that are never mutated.
- Price accepts an optional leading currency symbol (`$`, `£`, `€`, `Rs`, `PKR`) and thousands
  commas, then requires a clean non-negative number — anything else is a validation error, never a
  guess. `"12.99"`, `"$12.99"`, `"1,200.00"` all parse; `"12.99.99"` and `"-5"` do not.
- Availability accepts `true/false`, `yes/no`, `y/n`, `1/0`, `available/unavailable`,
  `"in stock"/"out of stock"` (case-insensitive); left blank, an item defaults to available. Any
  other value is a validation error.
- Sort order, if given, must be a non-negative whole number. Left blank, items are auto-numbered
  within their category, continuing after the highest explicit value already used there.

## Modifier format

`ModifierGroup` remains item-specific in this schema (Phase 30 deliberately did not introduce a
reusable/shared modifier template system — see "Explicitly deferred" below). The importer's
supported layout mirrors that directly:

```
category,item_name,price,modifier_group,modifier_option,modifier_price,modifier_min,modifier_max
Burgers,Deluxe Burger,10,Size,Small,0,1,1
,,,Size,Large,2,,
,,,Extras,Cheese,1,0,2
,,,Extras,Bacon,2,,
```

A row that has BOTH a category and item name defines (or re-defines) the current item — one such
row per item. A row with a blank category AND blank item name, but a modifier group/option filled
in, is a **continuation row**: it attaches that option to the group named on the most recently
defined item's row, creating the group the first time its name appears and adding options to it on
every later row that repeats the same group name. `modifier_min`/`modifier_max` only need to be
given once per group (its first row) — repeating them on later option rows for the same group is
ignored. A continuation row with no preceding item is a row-level error, not a silent no-op or a
crash.

Modifier groups are only ever created for brand-new items (`action: "create"`). An `update` on an
existing item touches only its own scalar fields (price/description/availability/sort
order/image) — its existing modifier groups are left untouched. Re-importing modifiers onto an
already-existing item isn't supported this phase; deleting/recreating the item's modifiers through
the normal admin editor remains the way to change them.

## Duplicate detection

Two distinct kinds, both reported with actionable, row-numbered messages — never a bare "import
failed":

- **In-file duplicates**: two rows resolving to the same (category, item name) pair after
  normalization. The first occurrence is kept; every later one is flagged as an error and excluded
  from the import.
- **Existing-item duplicates**: a row matching a MenuItem that already exists in the same resolved
  category. Matching is exact after trim/whitespace-collapse/case-fold only — never fuzzy, so
  genuinely different items are never accidentally merged. The default strategy is **skip**
  (safest — nothing about an existing item is ever touched without being asked); an explicit
  **update** strategy is available, applied uniformly to every detected duplicate in one import,
  and the preview shows the exact before/after values (price, description, availability, sort
  order, image) before the user confirms. There is no per-row override in this phase — see
  "Explicitly deferred."

## Category resolution

A category name is matched against existing categories in the same scope (see "Where items are
written" below), trimmed/whitespace-collapsed/case-folded — `" Burgers "` matches `"Burgers"`,
never creating a duplicate. A name with no match is created once per import (never once per row
that references it), in first-seen file order, and — critically — a category is only actually
created if at least one row referencing it ends up with a real `create` action; a category whose
only rows all errored out never leaves an empty, orphaned category behind.

## Where items are written (canonical vs. legacy)

`MenuItem`/`Category`/`ModifierGroup` support two scoping shapes: a `businessId`-scoped
**canonical** document (shared across every location of that business, since Phase 20/21) and an
older `restaurantId`-scoped **legacy** document (one location only). The real, live admin editor
(`MenuManagementPage.tsx`) writes exclusively through the canonical endpoints today — it never
creates a legacy document. That fact drives the importer's scope decision
(`resolveImportScope.ts`), which is deliberately NOT the same check the read paths use:

1. The business already has a canonical item → import canonical. Matches today's behavior exactly.
2. No canonical item yet, but the restaurant already has real legacy items → import legacy, to
   avoid orphaning them (the read path switches to canonical-only reads the instant any canonical
   item exists for that business, which would make pre-existing legacy items invisible).
3. Neither exists yet (a genuinely empty menu — the common "fast onboarding for a brand-new
   restaurant" case this importer exists for) → import canonical, matching what the very first
   item created through the normal admin editor would be anyway.

This is not a schema redesign — both write paths already exist and are already fully supported;
the importer just picks whichever one keeps the result visible and consistent with how the rest of
the product actually operates, rather than reviving a write path current real usage never
exercises.

## Image handling

The importer accepts an explicit `image` column carrying a real image URL (already-hosted, e.g.
copied from an existing product photo host) — no filename-matching / bulk-upload association was
built this phase. Building that safely (normalizing filenames, surfacing unmatched/ambiguous
matches for review, preventing a wrong association) is real, additional work explicitly deferred —
see below. The existing single-file upload endpoint
(`POST /restaurants/:id/uploads`) and its owner/manager-scoped write is untouched.

## Preview vs. commit — server authority

**Preview never writes anything.** Both preview and commit re-run the exact same
parse → normalize → resolve pipeline (`buildPreview.ts`/`commitImport.ts` share
`normalizeRows.ts`/`resolveImport.ts` verbatim) against the CURRENT live database state — commit
does not trust, and does not accept, any client-computed result from an earlier preview call. The
browser holds onto the same `File` object across the wizard and re-uploads it at commit time along
with the confirmed column mapping and duplicate strategy; the server is the sole authority for
what actually gets parsed, validated, and written. This is why commit re-uploads the file instead
of referencing a stored "import session" — no server-side session/temp-file state is needed at all.

## Transactional commit

All category, item, and modifier-group writes for one commit happen inside a single MongoDB
transaction (`mongoose.startSession()` + `withTransaction`) — either every intended change commits,
or the database is left exactly as it was before the request (proven by a real forced-failure test
that spies on the item-creation call mid-transaction and confirms the earlier category creation in
the SAME transaction rolls back too, not just the failing step). Bulk document creation uses
`Model.create(docs[], { session, ordered: true })` — the `ordered: true` flag is required by
Mongoose whenever `create()` is given both a session and more than one document. 5,000 rows (the
import's own hard cap) comfortably fits inside MongoDB's transaction size/time limits for documents
this small; no batching/chunking was needed to stay safely within them.

## Import report & history

After commit, a full report (rows created/updated/skipped/errored, categories/modifier
groups/options created) is returned immediately and also recorded as a new `AuditLog` entry
(`action: "menu.imported"`, `targetType: "menu_import"`) — reusing the platform's existing audit
mechanism rather than a new collection. `GET /restaurants/:id/menu/import/:importId` fetches that
one entry back by its generated id. The uploaded file itself is never stored — only the summary.

## Authorization / multi-tenant safety

The three import routes are mounted on the existing `menuRouter`
(`/restaurants/:restaurantId/menu/import/...`) and gated by `requireTenantMatch()` +
`requireTenantPermission("restaurant.menu.write"|"restaurant.menu.read")` — the agency-aware
variant (`middleware/tenant.ts`), not the plain `requirePermission` the rest of this router's
existing CRUD routes still use. This is a deliberate, narrow choice: it gives an
`agency_owner`/`agency_admin` (who already hold `restaurant.menu.write` in `AGENCY_ROLE_GRANTS`)
the ability to import a managed location's menu, and correctly denies `agency_staff` (a read-only
role everywhere in this platform, not a menu-specific carve-out) — without silently widening the
existing menu CRUD routes' own, separately-decided (Phase 26) agency boundary. Every write is
scoped by the same `restaurantId`/`businessId` filter the rest of the menu domain already uses;
malformed/cross-tenant IDs fail the same way every other tenant-scoped route already does. See
`menuImport.controller.test.ts` for the full authorization test matrix (owner, staff, agency
owner/admin/staff, cross-agency, cross-restaurant IDOR, malformed import ids).

## Explicitly deferred

- **Per-row duplicate resolution** — today's `duplicateStrategy` (skip/update) applies uniformly to
  every detected duplicate in one import; choosing differently per row is a real, useful future
  enhancement, not built this phase.
- **Bulk image association by filename** — a real feature, deliberately not faked; the current
  `image` column only accepts an already-hosted URL.
- **Reusable/shared modifier templates** — `ModifierGroup` stays item-specific, matching the
  existing schema; a template system that lets one "Size" group be reused across many items is a
  genuinely bigger feature, not attempted here.
- **PDF / image (OCR) / AI-assisted menu extraction** — see below.

## Future importer architecture (PDF / OCR / AI)

The parser boundary was built specifically so a future source never needs its own validation,
duplicate-detection, category-resolution, preview, or commit logic:

```
CSV parser ──┐
XLSX parser ─┼──▶ NormalizedImportRow[] ──▶ same resolveImport() ──▶ same preview/commit
(future) PDF parser ─┤
(future) OCR parser ─┤
(future) AI parser ──┘
```

A PDF/OCR/AI extractor's only job would be producing the same `NormalizedImportRow[]` shape
(`apps/api/src/services/menuImport/normalizeRows.ts`) that `normalizeRows()` already produces from
a parsed spreadsheet — everything downstream (`resolveImport.ts`, `buildPreview.ts`,
`commitImport.ts`, the wizard UI) is already source-agnostic and needs no changes to support it.
No AI/PDF/OCR extraction exists yet — this section documents the seam, not a built capability.
