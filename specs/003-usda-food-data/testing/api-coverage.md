# Feature 003 — `/v1/foods/*` API test-coverage audit

Status: **COMPLETE** — integration + e2e layers fully cover every `/v1/foods/*` endpoint and every
async flow. A production auth bug found while wiring the e2e (§4) was fixed in `fc8974d`; the full-stack
e2e is now wired and green. Date: 2026-06-30. Branch: `003-rebaseline-source-agnostic` (PR #53).

This audit maps EVERY `/v1/foods/*` endpoint × {integration, e2e} × {happy path, each status code,
auth 401/403, validation 400, lifecycle}. "Integration" = booted Nest + real Postgres with
`@kitchensink/clerk-verify` and `@kitchensink/usda-client` **mocked** (deterministic auth + no USDA
network) — `tests/foods-api.integration.test.ts`. "E2E" = booted Nest + real Postgres + manually-driven
worker `drain()` with a **real minted RS256 Clerk JWT** (no auth mock) and a **programmable stub
`FoodSourceAdapter`** — `tests/e2e/foods-api.e2e.test.ts`.

---

## 1. Endpoints under test

| #   | Method | Path                        | Purpose                                                |
| --- | ------ | --------------------------- | ------------------------------------------------------ |
| 1   | GET    | `/v1/foods/{id}`            | Golden-record read (lifecycle status codes)            |
| 2   | GET    | `/v1/foods/{id}/status`     | Lifecycle poll (never fetches)                         |
| 3   | GET    | `/v1/foods/{id}/candidates` | Disambiguation candidate set                           |
| 4   | GET    | `/v1/foods/search`          | Local fuzzy/substring + barcode/external-key crosswalk |
| 5   | POST   | `/v1/foods`                 | Add-by-name → 202 + id                                 |
| 6   | POST   | `/v1/foods/batch`           | Batch add-by-name (≤100)                               |
| 7   | PATCH  | `/v1/foods/{id}`            | Resolve from candidate pick                            |
| 8   | POST   | `/v1/foods/{id}/refetch`    | Admin-scoped manual re-enqueue                         |

Status-code precedence enforced everywhere: **401 → 403 → 400 → 404/202/200/409/503** (FR-051).

---

## 2. Coverage matrix

Legend: ✅ covered · ➕ added by this slice · n/a not applicable.

### Integration (`tests/foods-api.integration.test.ts` — mocked auth, real Postgres)

| Endpoint               | Happy 200/202                                                                                                                                                                            | Lifecycle codes                                                                           | 400 validation           | 401                 | 403                                 | 404                   | 409                                        | 503                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------ | ------------------- | ----------------------------------- | --------------------- | ------------------------------------------ | --------------------------------- |
| GET `/{id}`            | ✅ 200 RESOLVED (golden record, per-field provenance, per-100g nutrient, **no `fdcId`**)                                                                                                 | ✅ 202 PENDING · ✅ 202 UNRESOLVED · ✅ 404 NOT_FOUND (+status) · ✅ 404 FAILED (+status) | ✅ malformed ULID        | ✅                  | n/a                                 | ✅ unknown id         | n/a                                        | n/a                               |
| GET `/{id}/status`     | ✅ 200 RESOLVED (+food) · ✅ 200 PENDING (no food)                                                                                                                                       | ➕ 200 NOT_FOUND/FAILED/UNRESOLVED status-only                                            | n/a                      | ✅                  | n/a                                 | ✅ unknown id         | n/a                                        | n/a                               |
| GET `/{id}/candidates` | ✅ 200 UNRESOLVED set (**no `fdcId`**) · ✅ 200 RESOLVED empty                                                                                                                           | n/a                                                                                       | n/a                      | ✅                  | n/a                                 | ➕ unknown id         | n/a                                        | n/a                               |
| GET `/search`          | ✅ ranked match · ✅ fuzzy misspelling · ✅ external_key crosswalk · ✅ no-match empty · ➕ barcode crosswalk · ➕ empty query → empty                                                   | n/a (never a source call)                                                                 | n/a                      | ✅                  | n/a                                 | n/a                   | n/a                                        | n/a                               |
| POST `/v1/foods`       | ✅ 202 + id + 1 queue row · ✅ dedup re-add · ➕ re-add RESOLVED → inline, no fresh enqueue                                                                                              | n/a                                                                                       | ✅ empty/whitespace name | ✅ (no side-effect) | n/a                                 | n/a                   | n/a                                        | ✅ depth ceiling · ✅ flood-shed  |
| POST `/v1/foods/batch` | ✅ per-item partial · ✅ intra-batch dup collapse                                                                                                                                        | n/a                                                                                       | ✅ >100 names            | ✅                  | n/a                                 | n/a                   | n/a                                        | (service-shed)                    |
| PATCH `/{id}`          | ✅ valid pick → 200 + cleared · ✅ idempotent 200 on RESOLVED · ✅ proceeds at 90% pause                                                                                                 | n/a                                                                                       | ✅ malformed body        | ✅                  | n/a                                 | ➕ unknown id         | ✅ non-member · ➕ NotResolvable (PENDING) | ✅ window cap → 503 + Retry-After |
| POST `/{id}/refetch`   | ✅ 202 admin re-enqueue                                                                                                                                                                  | n/a                                                                                       | (id after scope)         | ✅                  | ✅ no scope · ✅ precedence 403>400 | ➕ unknown id (admin) | n/a                                        | n/a                               |
| **Auth matrix**        | ✅ no token → 401 (no DB/queue effect) · ✅ invalid → 401 · ✅ forged `x-debug-sub`/`x-authorizer-context` ignored · ✅ **M2M accepted** · ✅ precedence 401>400 · ✅ precedence 403>400 |                                                                                           |                          |                     |                                     |                       |                                            |                                   |

Integration result: **140 passed** (was 132; +8 added — marked ➕).

### E2E (`tests/e2e/foods-api.e2e.test.ts` — real minted JWT + stub adapter + worker drain)

| Flow / endpoint behaviour                                                                                                                                                                                                                                                                                                     | Specs | Status |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| Auth: every endpoint (all 8) rejects no token → 401; malformed + expired token → 401; unauthenticated POST creates **no** food/queue row; M2M token accepted (sub used for provenance); `/refetch` without `food:admin` → 403, with scope → 202                                                                               | 5     | ✅     |
| Add-by-name → resolve: POST → 202+id + 1 `fetch_queue` row; PENDING read → 202; drain; stub 1 candidate → RESOLVED; GET `/{id}` → 200 golden record (per-100g `Protein`, portions, provenance `name→usda`, **no `fdcId`/externalKey leak**); `/status` PENDING→RESOLVED (+food); `FoodFetchCompleted` emitted; + dedup re-add | 2     | ✅     |
| UNRESOLVED → pick: stub >1 distinct candidate → UNRESOLVED; GET `/{id}` → 202; GET `/{id}/candidates` → the set (no `fdcId`); PATCH non-member → 409 (status unchanged); PATCH valid pick → 200 RESOLVED + set cleared; PATCH on RESOLVED → idempotent 200                                                                    | 1     | ✅     |
| NOT_FOUND: 0 hits → NOT_FOUND tombstone; GET `/{id}` → 404 (status retrievable); `/status` → 200 NOT_FOUND; `FoodFetchCompleted` only, no `FetchFailed` (DSN-9)                                                                                                                                                               | 1     | ✅     |
| Batch: mixed (worker-resolved + new) → per-item partial (1 inline RESOLVED + 2 PENDING); intra-batch dup collapse; >100 → 400 (nothing enqueued)                                                                                                                                                                              | 3     | ✅     |
| Search: worker-resolved seeds; fuzzy/substring ranked (chicken, not beef); external_key crosswalk; barcode crosswalk; no-match → empty + **zero source calls asserted**                                                                                                                                                       | 1     | ✅     |
| FAILED: stub 5xx past the retry budget → FAILED tombstone + `FetchFailed` (attempts=5) + `FoodFetchCompleted` FAILED; GET → 404                                                                                                                                                                                               | 1     | ✅     |
| Backpressure: seed to `FOOD_MAX_QUEUE_DEPTH` → POST → 503 + Retry-After                                                                                                                                                                                                                                                       | 1     | ✅     |

All 15 e2e specs run against the **real** `FoodAuthGuard` → `@kitchensink/clerk-verify` with
genuinely-signed RS256 tokens (no auth mock). E2E file total: **17 passing** (15 new + 2 pre-existing
health). T-190 satisfied.

---

## 3. E2E harness (`tests/e2e/foods-api.e2e.test.ts` + `tests/support/`)

1. **App + worker over one Postgres.** `@nestjs/testing` is not in the tree, so instead of
   `overrideProvider` the suite **module-mocks** `../../src/sources/usda/usda.adapter.js` so the real
   `FoodsModule` factory registers `StubSourceAdapter` (its `source` is `'usda'`) in place of
   `UsdaSourceAdapter`. The app boots via `NestFactory.create(AppModule)` on `listen(0)`. The worker is a
   `FoodConsumerService` built from the app's OWN DI instances — `app.get(SourceAdapterRegistry)`,
   `app.get(RollingWindowLimiter)`, `app.get(MergeAndPersistService)`, `app.get(FoodDao)`,
   `new FetchQueueDao(app.get(DrizzleProvider))` — so the SAME stub instance backs the HTTP app
   (PATCH-resolve re-fetch) and the worker (fan-out). Flows are driven with `consumer.drain()`; the
   FAILED path clears the failure-backoff gate between passes (a deterministic stand-in for elapsed
   time). No `LISTEN/NOTIFY`, no timers, no `waitForTimeout`.
2. **Stub source adapter** (`tests/support/stub-source-adapter.ts`): a module-level `stub` controller
   programs, per normalized name, `programResolve` (1 candidate → RESOLVED), `programUnresolved`
   (>1 distinct → UNRESOLVED), `programNotFound` (0 hits), or `programSearchError` (5xx → FAILED).
   It returns canonical candidates directly (per-100g nutrients, portions, optional barcode) and tracks
   `searchByName`/`fetchByKey` call counts so the search-never-calls-a-source invariant is assertable.
3. **Real JWT minting** (`tests/support/jwt.ts`): `generateClerkKeypair()` makes a throwaway 2048-bit
   RSA SPKI keypair; its public PEM is `CLERK_JWT_KEY` (Clerk's local JWK loader strips the fixed SPKI
   prefix and assumes `e=AQAB`, so a Node SPKI PEM is consumed verbatim). `mintToken()` signs
   `header.payload` with `crypto.sign('RSA-SHA256', …)`; `public_metadata.scopes` carries `food:admin`
   for the admin token; the M2M token uses a distinct allowlisted `azp`; an expired token is minted with
   a negative TTL. Verified end-to-end against the real `verifyClerkToken` (post-`fc8974d`).

---

## 4. Auth bug found here — FIXED (`fc8974d`)

While wiring the e2e, minting a valid RS256 token surfaced that `@kitchensink/clerk-verify.verifyClerkToken()`
rejected EVERY valid token against the installed `@clerk/backend@1.34.0`: `verifyToken` returns the bare
JWT payload on success (not a `{ data, errors }` wrapper), but the wrapper treated the absent `data` as a
failure. `FoodAuthGuard` would have returned `401` to every request — including real Clerk tokens — in
production. It was invisible to every prior suite because each mocked at exactly that seam (integration
mocked the whole `verifyClerkToken`; the clerk-verify unit mocked `verifyToken` with the legacy shape).

**Fix (committed `fc8974d`, not by this test slice):** `clerk-verify` AND identity's `ClerkAuthService`
now accept both the legacy `{ data, errors }` and the bare-payload return, with regression-guard tests
using the real bare-payload shape. Blast radius (food + identity) closed. Post-fix, a real minted token
passes the guard and all 15 e2e flows are green.
