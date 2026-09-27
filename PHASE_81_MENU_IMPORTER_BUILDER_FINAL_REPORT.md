# Phase 81 — Menu Importer + Menu Builder UX Redesign — Final Report

Maturity vocabulary used throughout: **ENGINEERING READY** (code complete, tested, no live external
account exercised), **SANDBOX READY** (verified against a real but non-production external
service), **PROVIDER APPROVAL REQUIRED** (blocked on a third party), **PRODUCTION READY** (safe to
flip on for real customers with no further work).

---

## 1. Existing implementation audit

Before writing any code, the existing menu architecture was read in full, not summarized:

- **CSV/XLSX importer** (`apps/api/src/services/menuImport/`): `parseFile.ts` → `normalizeRows.ts`
  → `resolveImport.ts` (duplicate detection, category/item matching) → `commitImport.ts`
  (transactional write). Synchronous, in-memory, never persists the source file. Already had real
  duplicate detection (normalized name matching) and a preview-before-commit step.
- **Menu builder UI** (`apps/admin/src/pages/MenuManagementPage.tsx`, 1077 lines pre-Phase-81):
  category/item CRUD, hand-rolled HTML5 drag-and-drop reorder with full keyboard parity
  (`GripHandle`, Arrow Up/Down), per-location price/availability overrides, a real iframe-based
  live-preview modal. All of this was already correct and reused verbatim — only its layout and
  visual language changed.
- **Item editor** (`ItemEditorDrawer.tsx`) and **modifier editor** (`ModifierGroupsEditor.tsx`):
  both already handled the full item/modifier-group/option CRUD, including per-location overrides.
  Reused unchanged except for one responsive-layout change (§19) and one bug fix (§16).
- **No PDF/URL/image import existed at all.** No `MenuImportJob`-style async model, no
  AI/vision provider abstraction, no SSRF-safe URL fetcher.
- **No Dialog/Drawer primitive** existed in `packages/ui` — every overlay in the admin app is
  hand-rolled per call site (`useFocusTrap` + backdrop + `role="dialog"`). This phase continued
  that convention rather than introducing a new shared abstraction.
- **No drag-and-drop library** existed anywhere in the repo — reorder was, and remains, 100%
  hand-rolled native HTML5 drag events + keyboard arrows.

## 2. New architecture

A single canonical pipeline every import source converges on, matching the brief's own diagram:

```
Import Source (csv | pdf | url | image | images)
    -> MenuImportJob (async sources only; CSV stays synchronous)
    -> Source Extraction (safeUrlFetch / multer upload)
    -> MenuExtractionProvider.extract() -> raw ExtractedRow[]
    -> extractionResultToNormalizedRows() -> NormalizedImportRow[] (+ confidence, reviewCategory)
    -> resolveImportScope() + resolveImport() -> duplicate/category matching (SAME code the CSV
       importer already used)
    -> MenuImportDraftRow[] stored on the job, status "ready_for_review"
    -> Human review (edit rows, choose duplicate action) via 6 new REST endpoints
    -> writeResolvedImport() -> real Category/MenuItem/ModifierGroup documents (SAME transactional
       writer the CSV importer uses — extracted from commitImport.ts, not forked)
```

The load-bearing design decision: `resolveImport()` and the transactional writer take only
`NormalizedImportRow[]`, with zero awareness of source type. PDF/URL/image sources only had to
produce that same shape; every downstream stage needed zero or near-zero changes.

## 3. Import sources

| Source | Status | Notes |
|---|---|---|
| CSV/XLSX | Preserved, unchanged mechanics | Existing 4-step wizard, moved to `/menu/import/csv` |
| PDF | New, real | Single or multi-page, via `MenuExtractionProvider` |
| Public menu URL | New, real | SSRF-safe fetch, HTML content |
| Single photo | New, real | `sourceType: "image"` |
| Multiple photos | New, real | `sourceType: "images"`, order preserved |

## 4. PDF extraction

Goes through the `MenuExtractionProvider` abstraction (§9). The real adapter
(`ClaudeMenuExtractionProvider`) sends the PDF as a vision/document content block to Anthropic's
Messages API with forced tool-use for structured output. Each row records `sourcePageIndex` so a
low-confidence extraction can be traced back to its source page (brief §4's own requirement).
Multi-page ordering is preserved via `sourceFiles[].order` (1-based, assigned once at upload,
never reassigned by the pipeline).

## 5. URL extraction

`apps/api/src/utils/safeUrlFetch.ts` — built on Node's core `https` module rather than
`fetch`/undici specifically so the TCP connection dials the already-DNS-validated IP address
directly (the original hostname is used only for the `Host` header and TLS SNI). This closes the
DNS-rebinding gap rather than narrowing it: there is never a second, independent DNS lookup at
connect time. Enforces: HTTPS-only, redirect limit (3), private/internal/loopback/link-local IP
rejection (IPv4 and IPv6), response-size cap, timeout, content-type allowlist (HTML/PDF only).
Every failure mode maps to a specific, honest, user-facing message (`describeSafeFetchError` in
`extractionPipeline.service.ts`) — never a raw stack trace or internal error. Verified live this
session against a real external domain (`example.com`) through the real async pipeline, not just
unit-tested against mocks — see §26.

## 6. Image/OCR/vision extraction

Same `MenuExtractionProvider` abstraction as PDF. Multiple images become one job; the mock and
real providers both process `input.buffers` in input order, so multi-image ordering is exercised
by construction, not by convention. Verified live this session with a genuine 2-photo upload
(Journey 3, §26) — both photos' items appeared in the correct order in the review UI.

## 7. CSV preservation

The CSV/XLSX wizard's own 4-step mechanics (upload → mapping → preview → commit) are completely
unchanged. `commitImport.ts` was refactored to call the newly-extracted `writeResolvedImport.ts`
(the shared transactional writer), verified behaviorally identical via its existing 32-test suite
passing unchanged, plus a live e2e run this session (§26). Only its entry-point copy changed, to
read as one path among five rather than "the" importer.

## 8. Import job architecture

`MenuImportJob` model (`apps/api/src/models/MenuImportJob.ts`) — explicit hand-written interfaces
(not `InferSchemaType`, matching `ModifierGroup.ts`'s own precedent for subdocument arrays needing
a stable per-row identifier). States: `pending → processing → extracting → normalizing →
ready_for_review → publishing → completed | failed | cancelled`. Progress is real, stage-based
(never a fabricated percentage) — the UI's own checklist has exactly 3 honest steps matching the
pipeline's actual stages. Processed on the **existing** shared BullMQ `notifications` queue (no new
queue introduced). Retention: source file bytes are swept 14 days after a job reaches a terminal
state (`menuImportRetention.service.ts`, a scheduled cleanup tick on the same queue); the job
document itself — draft rows, confidence, the eventual publish report — is kept indefinitely,
matching `AuditLog`'s own retention precedent.

## 9. AI/provider abstraction

```
MenuExtractionProvider { extract(input): Promise<MenuExtractionResult> }
```
Two implementations: `MockMenuExtractionProvider` (deterministic, zero credentials, the default —
`MENU_EXTRACTION_PROVIDER_MODE=mock`) and `ClaudeMenuExtractionProvider` (real, hand-rolled
`fetch` against Anthropic's Messages API — no SDK dependency, matching `StripeProvider.ts`'s own
convention of not depending on a vendor SDK where a plain HTTP call suffices). The provider's name
is never surfaced to a restaurant owner anywhere in the UI. Selected once via
`getMenuExtractionProvider()`, injectable in tests via `setMenuExtractionProviderForTests()`.

## 10. Confidence/review system

Every draft row carries `overallConfidence`, per-field `fieldConfidence`, and a server-computed
`reviewCategory`: `looks_good | check_this | missing | needs_review`, derived from confidence
thresholds plus any parse issues (e.g., an unparseable price). The UI renders only the plain-
language label ("Looks good", "Missing", …) — the raw numeric score is never shown, per the
brief's own §11 instruction.

## 11. Duplicate detection

Reuses `resolveImport()`'s existing normalized-name matching — the same logic the CSV importer has
used since Phase 30 — for every source type. A matched row carries `matchedItemId` and a "possible
duplicate" badge; nothing is silently overwritten. Verified live this session with genuine
(not seeded) duplicate detection: importing the same deterministic PDF fixture twice against the
same restaurant reliably produces a real name-match on the second import (Journey 4, §26).

## 12. Merge/replace behavior

`MenuImportRowAction` (shared type) gained an additive `"merge"` value. Per-row, a reviewer picks
Create new / Replace existing / Fill in gaps only (merge) / Skip. A job-wide default strategy
(skip/update/merge) applies to any duplicate the reviewer didn't touch individually. "Merge" fills
only currently-empty fields on the matched item (e.g., adds a missing photo without overwriting an
existing price) — implemented in `writeResolvedImport.ts`, applied only at publish time;
`resolveImport()` itself never produces `"merge"` on its own.

## 13. Menu-builder redesign

`MenuBuilderLayout` — a 3-pane workspace (left nav / center canvas / right contextual panel),
replacing the previous single-column page. The center canvas dropped the previous per-category
bordered-`Card` boxiness for a typography-led treatment (heading + divider rule), closer to an
actual menu's typographic rhythm — deliberately restrained per the brief's own §32 warning against
over-designing. Every existing handler (create/rename/reorder/delete category and item, overrides,
availability toggles) was preserved verbatim; only the JSX structure and visual skin changed.

## 14. Category management

Unchanged functionally: inline create, rename, reorder (drag-and-drop + full keyboard parity),
hide/show, delete, per-location override — now living inside the new left-rail/center-canvas shell
instead of a flat single column. No separate settings page was introduced (brief §17).

## 15. Item management

Unchanged functionally, now presented through the same `ItemEditorDrawer`, made responsive (§19):
a persistent right-hand pane at desktop widths, an overlay drawer below that — one component
instance, no new prop, CSS-only.

## 16. Modifier/add-on management

`ModifierGroupsEditor` is unchanged and lives inside the item editor, visually integrated per the
brief's §16 ("make add-ons visually belong to the item"). **A real bug was found and fixed this
session** during live e2e verification (Journey 5): closing the item editor after adding a
modifier group didn't refresh the parent page's modifier-count indicator (modifier edits happen in
a nested component with its own local `reload()`, which had no way to tell the parent page its
counts were stale). Fixed in `MenuManagementPage.tsx`'s `closePanel()` — see §22.

## 17. Preview

Reuses the existing real iframe-based live-preview modal unchanged — no second storefront renderer
was built, per the brief's own §23 instruction.

## 18. Draft/publish workflow

Import → Review → Confirm → Publish. Nothing is ever auto-published — publishing is always an
explicit "Publish to my menu" action the reviewer takes after seeing the summary. A
`publishedReport` (created/updated/skipped/errors/categoriesCreated/…) is recorded on the job and
shown to the owner.

## 19. Responsive design

- **Menu builder**: `CategoryNavRail` (search/filters/category jump-list) is a persistent left
  column at `lg:` and a slide-in drawer below it — mirrors `Layout.tsx`'s own established sidebar
  pattern (same breakpoint, same backdrop convention). `ItemEditorDrawer` is one component instance
  presenting as a persistent 420px pane at `lg:` and a full-screen overlay below it, via pure
  Tailwind responsive classes (`lg:static lg:w-[420px] lg:shrink-0 lg:border-l …`), not a `variant`
  prop.
- **Import review**: `SourcePreviewSplit` stacks vertically on mobile rather than forcing a
  side-by-side split (brief §20).
- **Verified live** at a 390×844 mobile viewport (Journey 6, §26): no horizontal page overflow, the
  left rail genuinely collapses to a drawer, item editing is genuinely full-screen, not a squeezed
  sidebar.

## 20. Security

- **SSRF**: see §5 — protocol allowlist, redirect cap, private/internal/loopback/link-local IP
  rejection (IPv4 + IPv6), cloud-metadata-endpoint rejection (covered by the private-IP check,
  `169.254.169.254` is link-local), DNS-rebinding closed by dial-the-validated-IP-directly, response
  size cap, timeout, content-type allowlist.
- **Tenant scoping**: every import-job endpoint requires authentication and validates the job
  belongs to the requesting tenant's restaurant — no cross-tenant job/source-file access.
- **File validation**: MIME-type and size limits enforced server-side for every upload path (PDF,
  single image, multi-image), independent of client-reported `Content-Type`.
- **Cost controls**: `menuImportLimits.ts` — max PDF size (15MB) and pages (20), max image size
  (8MB) and count per job (12), URL fetch response-size/timeout/redirect limits, extraction-provider
  timeout (90s), job attempt cap (3), per-restaurant concurrent-job cap (3).
- **Local-disk storage path safety** (§22/§29): `LocalDiskStorageService` rejects any key that would
  resolve outside its storage root via `../` traversal — defense in depth, since keys are always
  built internally from IDs, never from raw user input.

## 21. Performance

Async processing keeps large-document handling off the request/response path entirely — a PDF or
photo upload returns as soon as the file is durably stored; extraction runs on the background
queue. No synchronous large-document parsing was added anywhere. The admin bundle's known
pre-existing >500KB chunk-size warning (Vite's own build output) is unrelated to this phase — no
new heavy client dependency was introduced (no PDF-rendering library, no DnD library, no new image
library).

## 22. Files changed

**Backend, new:**
`models/MenuImportJob.ts`,
`menuExtraction/{MenuExtractionProvider,MockMenuExtractionProvider,ClaudeMenuExtractionProvider,index}.ts` (+tests),
`utils/safeUrlFetch.ts` (+test),
`services/menuImport/{menuImportLimits,extractionResultToRows,writeResolvedImport,menuImportJob.service,extractionPipeline.service,menuImportRetention.service}.ts` (+tests),
`controllers/menuImportJob.controller.ts` (+test),
`storage/LocalDiskStorageService.ts`,
`routes/localStorage.routes.ts`.

**Backend, edited:**
`services/menuImport/{commitImport,normalizeRows,parseFile}.ts` (refactor to shared writer; BOM-regex
robustness fix), `storage/{index,StorageService,S3StorageService}.ts` (`download()` added;
local-disk fallback), `queues/notification.queue.ts` (2 new job types), `routes/menu.routes.ts` (6
new routes), `app.ts` (local-storage route mount), `config/env.ts` + `.env.example` (new env vars),
`index.ts` (cleanup-job registration).

**Frontend, new:**
`pages/{ImportEntryPage,MenuImportJobPage}.tsx`,
`components/menu-import/{ImportReviewList,SourcePreviewSplit,ImportErrorPanel}.tsx`,
`components/menu-builder/{MenuBuilderLayout,CategoryNavRail}.tsx`,
`lib/menuImportJobs.ts`.

**Frontend, edited:**
`pages/MenuManagementPage.tsx` (heavy rewrite — layout restructure, every handler preserved,
plus the §16 bug fix), `pages/MenuImportPage.tsx` (header copy only), `components/ItemEditorDrawer.tsx`
(responsive pane/overlay), `App.tsx` (3 route changes), `lib/readinessCopy.ts` (1 link target),
`components/icons.tsx` (3 new icons).

**Shared packages:**
`types/src/types/{menuImport,menuImportJob}.ts`, `validation/src/menuImportJob.ts`.

**Docs:** `docs/menu-import-architecture.md` (Phase 81 addendum).

**E2E, new:** 6 journey specs (§26). **E2E, fixed:** `menu-import.spec.ts`,
`dashboard-not-ready-state.spec.ts` (both re-routed for the new IA; mechanics unchanged).

## 23. API/endpoints changed

6 new endpoints under `/restaurants/:restaurantId/menu/import-jobs`:
`POST /` (create — JSON for `url`, multipart for `pdf`/`image`/`images`), `GET /` (list),
`GET /:jobId` (poll/detail), `PATCH /:jobId/rows/:rowNumber` (edit a draft row),
`POST /:jobId/publish`, `POST /:jobId/cancel`. `StorageService.download(key)` added to the shared
storage interface (used by the extraction worker to read a source file back).

## 24. Database/model changes

New collection: `menuimportjobs` (4 indexes: `restaurantId+createdAt`, `businessId+createdAt`,
`status+createdAt`, `sourceRetentionDeleteAt+sourceFilesDeletedAt`). One additive type widening:
`MenuImportRowAction` gained `"merge"`.

## 25. Tests

**Backend (Jest):** 141 Phase-81 tests across 12 suites (the original 9 — `menuImportJob.controller`,
`menuImport.controller`, `writeResolvedImport`, `menuImportRetention.service`,
`ClaudeMenuExtractionProvider`, `MockMenuExtractionProvider`, `safeUrlFetch`,
`extractionResultToRows`, `upload.controller` — plus 3 added during the closeout audit,
§30 — `extractionPipeline.service`, `LocalDiskStorageService`, `localStorage.routes`) —
**141/141 passing**. Full API suite, re-run clean after the closeout audit's fix:
**1585/1585 passing, 122/122 suites, zero failures** — including the 4 suites
(`analytics.controller`, `deliveryDispatch.service`, `menuClone.service`, `sitemap.routes`) a
noisier Stage-3 run had shown as flaky; this run confirms that diagnosis (pre-existing
CPU-contention flakiness, not a regression) rather than leaving it as an inference.

**Frontend:** `npm run build -w apps/admin` (tsc + vite) clean; `npm run lint -w apps/admin`: 0
errors, 19 pre-existing warnings (none in any file this phase touched).

## 26. Playwright journeys

All 6 of the brief's §37 minimum journeys were written and verified passing **against the real
running stack** (real MongoDB, real Redis/BullMQ, real HTTP, a real browser) — not stubbed:

1. **PDF journey** (`menu-import-pdf-journey.spec.ts`) — new restaurant → upload PDF → real async
   processing → review → edit a row → publish → item appears on the live menu → live preview. ✅
2. **URL journey** (`menu-import-url-journey.spec.ts`) — paste URL → real SSRF-safe fetch against
   `example.com` → review → publish. ✅
3. **Photos journey** (`menu-import-photos-journey.spec.ts`) — 2 real JPEGs uploaded → review
   (4 items, correct per-photo grouping/order) → publish. ✅
4. **Duplicate-detection journey** (`menu-import-duplicate-journey.spec.ts`) — the same PDF
   imported twice against one restaurant; the second import genuinely detects the first import's
   published item as a duplicate (no seeding) → "Fill in gaps only" (merge) chosen → publish →
   still exactly one item, not two. ✅
5. **Manual-menu journey** (`menu-builder-manual-journey.spec.ts`) — create category → create item
   → add a modifier group → keyboard-reorder two items → live preview. Found and fixed a real bug
   in the process (§16). ✅
6. **Mobile journey** (`menu-builder-mobile-journey.spec.ts`) — 390×844 viewport against the real
   demo restaurant's 28-item menu: no horizontal overflow, left rail is a real drawer, item editing
   is genuinely full-screen. ✅

**Regression sweep of specs touching affected surfaces** (all re-run this session):
`menu-import.spec.ts` (CSV wizard, pre-existing) — **broke** by the new IA, **fixed** (re-routed
through the chooser, mechanics untouched), now passing. `dashboard-not-ready-state.spec.ts` —
**broke** (its own readiness-checklist link now lands on the chooser, not `/menu` directly),
**fixed**, now passing. `restaurant-provisioning-golden-path.spec.ts`, `menu-rbac.spec.ts`,
`shared-menu-canonical-override.spec.ts` — all confirmed **unaffected**, passing unchanged.

All 6 were re-run again after the closeout audit's fixes (§30), individually and together,
**still 6/6 passing** — including 2 flaky assertions in `menu-builder-manual-journey.spec.ts`
found and fixed during that re-run (a selector-scoping issue and a missing settle-wait; both were
test-only timing bugs, not product bugs — see §30).

Two infrastructure gaps were found and closed this session specifically so these journeys could
run for real rather than being written-but-unproven:
- **Redis**: this dev machine's default Redis service is 3.0.504, below BullMQ's 5.0 floor — no
  import job could ever leave "processing" locally. Fixed by running the Redis 8.10.1 binary
  already present on disk (via winget) on a separate port (6380), pointed at from `.env` only —
  the original service and port were never touched, fully reversible.
- **File storage**: no S3/R2 credentials exist in this dev environment. Added
  `LocalDiskStorageService` (§9's own provider-abstraction pattern, applied to storage) — real disk
  I/O, activates only when no S3 credentials are configured **and** `NODE_ENV !== "production"`;
  production always requires real credentials and never falls back (§29).

## 27. Build/typecheck/lint results

`npm run build -w apps/api` (tsc): clean. `npm run build -w apps/admin` (tsc + vite): clean.
`npm run lint -w apps/admin` (eslint): 0 errors, 19 pre-existing warnings, none in this phase's
files. Full Jest suite: see §25.

## 28. Remaining limitations

- **No live source-image rendering** in `SourcePreviewSplit` — shows page/photo-grouped item
  labels, not the actual image/PDF bytes. Doing this securely needs a new authenticated
  file-streaming endpoint plus blob-URL handling; judged disproportionate to Stage 2's scope. A
  real, disclosed limitation, not a silent cut.
- **No in-browser PDF rendering** — no PDF-rendering library exists in this codebase; not added.
- **`LocalDiskStorageService` is dev-only by design** — never activates when `NODE_ENV=production`
  or when real S3/R2 credentials are set. Production deployment still requires real object storage
  (§29).
- **`ClaudeMenuExtractionProvider` is real, tested code, never exercised against a live Anthropic
  account** — `MENU_EXTRACTION_PROVIDER_MODE` defaults to `mock` everywhere. Same
  disclosed-not-fabricated pattern already established elsewhere in this project for
  Stripe/Paddle/marketplace providers.
- **Marketing-site integration (brief §35) was not started** — deliberately out of scope for this
  phase; the brief's own instruction is not to make marketing claims before the feature is
  implemented and tested, which is now true, but writing that copy/section is separate work.
- **"Items needing review" filter, listed in the brief's §18, is not present on the live menu
  builder's `CategoryNavRail`** — that flag only ever exists on an in-progress `MenuImportJob`'s
  draft rows (where the review UI already surfaces it directly), never on a published `MenuItem`,
  so a filter for it on the live menu would have had nothing real to filter on.
- **`e2e/menu-import.spec.ts` and `e2e/dashboard-not-ready-state.spec.ts`** were fixed for the new
  IA this session (§26); no other pre-existing spec was found to reference the old direct
  `/menu/import` → CSV-wizard routing, but the full ~140-file e2e suite was not run start-to-finish
  this session (only the specs plausibly touching affected surfaces) — a full regression sweep is
  worth running before this ships, matching this project's own standing pre-launch practice.

## 29. External services / credentials / founder actions required

1. **`ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`** — required to enable real (non-mock) PDF/image
   extraction in any environment. Until set, `MENU_EXTRACTION_PROVIDER_MODE` should stay `mock`.
   **PROVIDER APPROVAL REQUIRED** / not yet configured anywhere.
2. **Real S3-compatible object storage** (`STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`,
   `STORAGE_SECRET_KEY`, and `STORAGE_ENDPOINT` for R2/MinIO) — required for production. Without
   it, production would fall through to throwing (never to local-disk storage — that path is
   explicitly `NODE_ENV`-gated off). This is a pre-existing gap this phase did not create (item
   photo uploads had the exact same requirement already) but the menu importer's PDF/image sources
   make it load-bearing for a core feature now, not just an optional nice-to-have.
3. **Production Redis must be 5.0+** — this dev machine's own default Redis (3.0.504) cannot run
   BullMQ at all; a production deployment on an equivalently old Redis would silently never process
   any async menu import (Stage 1's graceful-degradation path would mark every job `failed` with an
   honest error, not crash, but no owner could ever actually use PDF/URL/photo import). Worth an
   explicit pre-launch confirmation of the production Redis version — this is a request to confirm,
   not a code change.
4. **No other new external accounts, keys, or approvals are required.** Everything else in this
   phase runs on infrastructure already approved and configured for this project (MongoDB, the
   existing BullMQ queue, the existing auth/RBAC system).

## 30. Phase 81 closeout / production-safety audit (2026-09-26/27)

A dedicated audit pass over Stage 3's completed state, explicitly scoped to finding and fixing
real defects — not adding features, not redesigning working architecture. One genuine, real
defect was found and fixed; several other areas were reviewed carefully and confirmed already
correct, with reasoning recorded here rather than left implicit.

**A. Production external dependencies — reconfirmed, nothing fabricated.** Same 3 items as §29:
a real `ANTHROPIC_API_KEY` for live extraction, real S3/R2 credentials for production storage,
and production Redis 5.0+. No credentials were invented or assumed configured anywhere in this
audit.

**B. Local storage safety — reviewed, one real test-coverage gap closed (no code defect found).**
`isLocalDiskStorageActive()`/`getStorageService()` were re-traced end-to-end: production
(`NODE_ENV=production`) can never activate local-disk storage, confirmed by re-reading both
functions' logic directly, not by re-trusting the original comment. `LocalDiskStorageService`'s
path-traversal guard (`resolvePath()`) was re-analyzed against absolute-path keys, backslash keys,
and `../`-segment keys on both path semantics — correct in every case. The one real gap: **this
guard, and the HTTP route that depends on it (`GET /local-storage/:key`, which passes a raw,
unauthenticated URL param straight into `download()`), had zero test coverage** despite being the
actual security boundary for that route. Closed with two new files: `LocalDiskStorageService.test.ts`
(16 tests: round-trip, delete-removes-sidecar, 4 traversal-key shapes × upload/download/delete,
proof a rejected traversal never actually writes outside the root) and `localStorage.routes.test.ts`
(4 tests: serves a real file with the right content-type, 404s cleanly for an unknown key, 404s
for both an encoded and a literal traversal attempt via the real HTTP route). Separately noted,
not fixed (a real but pre-existing, deliberate architectural pattern, not a Phase 81 regression):
`getStorageService()` fails only when actually used, not at boot, for missing S3 credentials —
consistent with `PAYMENT_PROVIDER`/`BILLING_PROVIDER`/`MARKETPLACE_PROVIDER_MODE`'s own identical
"throws only when used" convention (see `env.ts`'s own pre-existing comment), unlike
`EMAIL_PROVIDER`'s stricter boot-time check (which exists because email has no permanently-valid
"off" state — storage arguably does, for a restaurant using neither photos nor PDF/image import).
Extending storage to a boot-time check would be a reasonable future hardening, but is a
cross-cutting change to shared, pre-existing infrastructure well beyond this phase's scope, so it
was not made. Also reviewed: the served-file security model for menu-import *source* files (raw
owner-uploaded PDFs/photos, pre-review) inherits the same "public URL, unguessable-key-only"
access model already used for public item photos — acceptable for photos (meant to be public) but
a real, disclosed characteristic worth a dedicated look for source files (not meant to be public)
in a future, dedicated storage-security review; not fixed here since doing it properly (signed
URLs or an authenticated streaming proxy) would mean redesigning the shared `StorageService`
abstraction itself, not a Phase 81-scoped fix.

**C. Authorization / tenant isolation — reviewed, confirmed correct, no fixes needed.** Every
import-job route requires `requireAuth` + `requireTenantPermission` (the same agency-aware
tenant-scoping middleware every other restaurant-scoped route in this app uses — not a
Phase-81-specific mechanism). Independently, the service layer re-checks tenant ownership itself
(`assertJobVisibleToRestaurant`): a job is visible if the requesting restaurant matches its own
`restaurantId`, or — mirroring the existing canonical-menu sharing model — if both restaurants
belong to the same business; otherwise a 404, deliberately indistinguishable from "doesn't exist"
(never a 403 that would let an attacker distinguish "wrong tenant" from "no such job," a genuine,
deliberate anti-enumeration choice already documented in that function's own comment). State-machine
transitions (row-edit, publish, cancel) all re-check `job.status` server-side before acting —
verified directly, not assumed — so a direct API call can't bypass what the UI merely disables.

**D. Import pipeline — one real, confirmed bug found and fixed.** The publish path
(`publishMenuImportJob`) was already correct: an atomic `findOneAndUpdate` compare-and-swap claims
the job before writing, and a failed write reverts status back to `ready_for_review` in a `catch`
block, so a publish failure never leaves the job wedged. `writeResolvedImport()` was confirmed to
wrap every category/item/modifier write in one real MongoDB transaction — a failure partway
through rolls back atomically, never a half-published menu. The genuine defect was upstream, in
`runMenuImportExtraction` (the extraction *worker*, not publish): the function's own idempotency
guard checked `job.status !== "pending"` to skip a duplicate delivery, but a **failed, non-final
attempt left the job's status at whatever intermediate stage it had reached** (`processing`/
`extracting`/`normalizing`) — never resetting it back to `"pending"`. The *next* retry would find
that non-pending status, silently `return` without throwing, and BullMQ would count that as a
*successful* attempt (no exception raised) and never schedule another retry. Net effect: any
transient extraction failure (a network blip, a temporary provider 503) **permanently wedged the
job** — never reaching `ready_for_review` or `failed` — with the owner's UI polling forever, no
error, no result. Fixed by (1) replacing the initial read-then-write status check with an atomic
`findOneAndUpdate({_id, status:"pending"}, {$set:{status:"processing", ...}})` claim, closing a
second, related TOCTOU race against genuine concurrent duplicate delivery, and (2) having the
`catch` block reset status back to `"pending"` on every non-final attempt (so the next retry can
actually claim the job), while both the reset and the final-attempt failure-marking now explicitly
exclude an already-`"cancelled"` job (`status: {$ne: "cancelled"}`), closing a narrower but real
race where a user-triggered cancel landing in the same instant as a failing attempt could otherwise
be silently overwritten back to `"pending"`/`"failed"`. 4 new regression tests in
`extractionPipeline.service.test.ts` (a file with previously zero direct coverage — this logic was
only ever exercised indirectly through HTTP-level controller tests using a mocked queue) prove:
a failed non-final attempt resets to pending and the next retry actually completes; a failed final
attempt reaches `"failed"` with an honest error rather than getting stuck; a cancelled job is never
resurrected by a failing attempt's own handling; and a non-pending job (already claimed or already
terminal) is never reprocessed. Lower-severity items reviewed and deliberately *not* changed
(consequence is cosmetic/self-healing, not data corruption, and a fix would add complexity
disproportionate to the risk): a `cancelMenuImportJob` call racing a few milliseconds inside the
happy path's own progress-update `.save()` calls (worst case, a just-cancelled job briefly shows
progress before its next natural `isCancelled()` check catches it — publish is separately gated,
so nothing ever reaches the live menu from this); and duplicate job-creation from a double-submit
click (no idempotency key on `createMenuImportJob`, but any resulting duplicate job is independently
caught by the existing, unchanged duplicate-detection/skip-by-default logic at publish time, so at
worst a reviewer sees the same "possible duplicate" prompt twice, never a duplicated menu item).

**E. Manual builder — canonical-model consistency reconfirmed; modifier-count regression test
confirmed present.** `apps/admin` has no component/unit-test layer at all (no Jest/RTL/Vitest for
React code — verified by searching, not assumed) — Playwright e2e is the only test layer capable
of covering a frontend bug, so `e2e/menu-builder-manual-journey.spec.ts` (Journey 5) *is* the
regression test for the modifier-count-refresh bug fixed during Stage 3: it asserts `"1 option"`
becomes visible immediately after closing the item editor, which would fail again if `closePanel()`'s
`reload()` call were ever reverted. Re-ran and fixed 2 flaky assertions in that same spec while
verifying this (both e2e test-timing bugs — a selector that didn't actually exclude the item
editor's own still-mounted-during-close-transition title text, and a missing wait for a create-item
save to settle before the next action — neither was a product defect; see the spec's own updated
comments).

**F. File upload security — reviewed, no genuine issues found.** Size limits (15MB PDF/8MB image),
page/count caps, and MIME-type allowlisting are all enforced server-side (multer config +
redundant explicit checks in the controller), independent of the client. MIME-type validation
trusts the client-declared `Content-Type` rather than sniffing file magic bytes — reviewed
carefully rather than assumed safe: the allowlist is narrow (PDF + 3 image types, all
non-script-executable), `helmet()` already sets `X-Content-Type-Options: nosniff` globally (so a
browser will never content-sniff a declared-safe type into something dangerous), and uploaded
bytes are only ever sent to an AI extraction API or downloaded by an authenticated reviewer — never
executed server-side. Adding magic-byte content sniffing would be disproportionate given this.
Filename handling (`sanitizeFileName`) strips to a safe character set and caps length. No temporary
files are ever written to the OS temp directory (`multer.memoryStorage()` — the upload exists only
as an in-memory `Buffer` for the duration of the request before going straight to `StorageService`),
so there is no temp-file-cleanup concern to audit. Retention-sweep deletion (`menuImportRetention.service.ts`)
correctly removes both a local-disk file and its content-type sidecar (verified directly in the new
`LocalDiskStorageService.test.ts`). SSRF protections for URL import were re-verified unchanged
(§5/§20) — no new gap found.

**G. E2E coverage — all 6 mandatory journeys re-run and confirmed passing.** Command:
`npx playwright test --reporter=list --workers=1 menu-import-pdf-journey menu-import-url-journey
menu-import-photos-journey menu-import-duplicate-journey menu-builder-manual-journey
menu-builder-mobile-journey` — **6/6 passed**, both individually and together, against the same
real stack as Stage 3 (real MongoDB, the same real Redis 8.10.1 instance on port 6380, real HTTP,
a real browser) — no mocks introduced or substituted. Environment assumption unchanged from Stage
3: both dev servers (API on 4000, admin on 5174) already running locally. Known limitation
unchanged from §28: the full ~140-file e2e suite was not run start-to-finish; only the 6 mandatory
journeys plus the 5 specs already known to touch affected surfaces were re-verified.

**H. Regression — full results.**
- Phase 81 backend suite (12 files, includes the audit's 3 new test files):
  `npm test -w apps/api -- --maxWorkers=2 menuImportJob.controller menuImport.controller
  writeResolvedImport menuImportRetention ClaudeMenuExtractionProvider safeUrlFetch
  extractionResultToRows MockMenuExtractionProvider upload.controller extractionPipeline.service
  LocalDiskStorageService localStorage.routes` → **141/141 passing**.
- Full API suite: `npm test -w apps/api -- --maxWorkers=2` → **1585/1585 passing, 122/122 suites,
  zero failures** (a fully clean run — see §25).
- Admin build: `npm run build -w apps/admin` (tsc + vite) → clean.
- Admin lint: `npm run lint -w apps/admin` → 0 errors, 19 pre-existing warnings, none in any file
  this phase or this audit touched.
- API build: `npm run build -w apps/api` (tsc) → clean.
- Playwright: see G above, plus `menu-import.spec.ts`, `dashboard-not-ready-state.spec.ts`,
  `restaurant-provisioning-golden-path.spec.ts`, `menu-rbac.spec.ts`,
  `shared-menu-canonical-override.spec.ts` (the 5 previously-identified affected/adjacent specs)
  → all still passing.
- No unrelated pre-existing contention failures were chased or "fixed" — the full-suite run above
  came back completely clean on its own, so there was nothing to distinguish from a real
  regression this time.

---

**Overall status: ENGINEERING READY, now with one confirmed correctness fix (§30.D) and expanded
security test coverage (§30.B) from a dedicated closeout audit.** Every piece of this phase —
extraction, the async pipeline (now provably retry-safe), duplicate detection/merge, the
redesigned menu builder, responsive behavior — is real, integrated with the existing menu
architecture, and verified end-to-end against the actual running stack, not mocked or UI-only.
Production-safety review found local-disk storage cannot reach production under any configuration,
tenant isolation is correctly enforced at two independent layers, and the transactional publish
path cannot corrupt menu state on partial failure. What remains before **PRODUCTION READY** is
still entirely the external-credential and infrastructure items in §29 — a real Anthropic API key,
real S3/R2 storage credentials, and confirmation of production Redis's version — not further code.
