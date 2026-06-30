# Feature 003 — `/v1/foods/*` API test-coverage audit

Status: **BLOCKED on a production auth bug for the e2e layer** (see §4). Integration layer fully
covered and extended. Date: 2026-06-30. Branch: `003-rebaseline-source-agnostic` (PR #53).

This audit maps EVERY `/v1/foods/*` endpoint × {integration, e2e} × {happy path, each status code,
auth 401/403, validation 400, lifecycle}. "Integration" = booted Nest + real Postgres with
`@kitchensink/clerk-verify` and `@kitchensink/usda-client` **mocked** (deterministic auth + no USDA
network) — `tests/foods-api.integration.test.ts`. "E2E" = booted Nest + real Postgres + worker drain
with a **real minted Clerk JWT** and a **stubbed `FoodSourceAdapter`** — `tests/e2e/*.e2e.test.ts`.

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

Legend: ✅ covered · ➕ added by this slice · 🚫 BLOCKED (auth bug §4) · n/a not applicable.

### Integration (`tests/foods-api.integration.test.ts` — mocked auth, real Postgres)

| Endpoint               | Happy 200/202                                                                                                                                                                                                                                                   | Lifecycle codes                                                                           | 400 validation                              | 401                           | 403                                                             | 404                   | 409                                             | 503                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------- | --------------------------------------------------------------- | --------------------- | ----------------------------------------------- | --------------------------------------------------- |
| GET `/{id}`            | ✅ 200 RESOLVED (golden record, per-field provenance, per-100g nutrient, **no `fdcId`**)                                                                                                                                                                        | ✅ 202 PENDING · ✅ 202 UNRESOLVED · ✅ 404 NOT_FOUND (+status) · ✅ 404 FAILED (+status) | ✅ malformed ULID                           | ✅ (auth gate)                | n/a                                                             | ✅ unknown id         | n/a                                             | n/a                                                 |
| GET `/{id}/status`     | ✅ 200 RESOLVED (+food) · ✅ 200 PENDING (no food)                                                                                                                                                                                                              | ➕ 200 NOT_FOUND/FAILED/UNRESOLVED status-only                                            | n/a                                         | ✅                            | n/a                                                             | ✅ unknown id         | n/a                                             | n/a                                                 |
| GET `/{id}/candidates` | ✅ 200 UNRESOLVED set (**no `fdcId`**) · ✅ 200 RESOLVED empty                                                                                                                                                                                                  | n/a                                                                                       | n/a                                         | ✅                            | n/a                                                             | ➕ unknown id         | n/a                                             | n/a                                                 |
| GET `/search`          | ✅ ranked match · ✅ fuzzy misspelling · ✅ external_key crosswalk · ✅ no-match empty                                                                                                                                                                          | n/a (never a source call)                                                                 | n/a                                         | ✅                            | n/a                                                             | n/a                   | n/a                                             | n/a                                                 |
| ↳ added                | ➕ **barcode crosswalk** hit · ➕ empty/whitespace query → empty (zero source calls)                                                                                                                                                                            |                                                                                           |                                             |                               |                                                                 |                       |                                                 |                                                     |
| POST `/v1/foods`       | ✅ 202 + id + exactly 1 queue row · ✅ dedup re-add → same id                                                                                                                                                                                                   | n/a                                                                                       | ✅ empty/whitespace name (nothing enqueued) | ✅ (no row/queue side-effect) | n/a                                                             | n/a                   | n/a                                             | ✅ queue-depth ceiling · ✅ flood-shed heavy sub    |
| ↳ added                | ➕ re-add already-RESOLVED → inline RESOLVED, **no fresh enqueue** (FR-028a no-burn)                                                                                                                                                                            |                                                                                           |                                             |                               |                                                                 |                       |                                                 |                                                     |
| POST `/v1/foods/batch` | ✅ per-item partial (inline RESOLVED + PENDING) · ✅ intra-batch dup collapse                                                                                                                                                                                   | n/a                                                                                       | ✅ >100 names (nothing enqueued)            | ✅                            | n/a                                                             | n/a                   | n/a                                             | (shed via service)                                  |
| PATCH `/{id}`          | ✅ valid pick → 200 RESOLVED + candidates cleared · ✅ idempotent 200 on RESOLVED · ✅ proceeds at 90% pause                                                                                                                                                    | n/a                                                                                       | ✅ malformed body (no candidateIds)         | ✅                            | n/a                                                             | ➕ unknown id         | ✅ non-member pick · ➕ NotResolvable (PENDING) | ✅ window cap → 503 + Retry-After, stays UNRESOLVED |
| POST `/{id}/refetch`   | ✅ 202 admin re-enqueue (queue row → pending)                                                                                                                                                                                                                   | n/a                                                                                       | (id checked after scope)                    | ✅                            | ✅ valid token w/o scope · ✅ precedence 403>400 (malformed id) | ➕ unknown id (admin) | n/a                                             | n/a                                                 |
| **Auth matrix**        | ✅ no token → 401 (no DB/queue side-effect) · ✅ invalid/garbage → 401 · ✅ forged `x-debug-sub`/`x-authorizer-context` ignored, verified `sub` used for provenance · ✅ **M2M azp-allowlisted token accepted** · ✅ precedence 401>400 · ✅ precedence 403>400 |                                                                                           |                                             |                               |                                                                 |                       |                                                 |                                                     |

Integration result after this slice: **140 passed** (was 132; +8 added — marked ➕). The integration
auth matrix is comprehensive **but exercises a mocked `verifyClerkToken`**, so it cannot and does not
detect the real-verification bug in §4.

### E2E (`tests/e2e/*.e2e.test.ts` — real minted JWT + stub adapter + worker drain)

| Flow / endpoint behaviour                                                                                                                                                                                                                          | Planned (T-190)                                             | Status                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| Auth: every endpoint rejects no/invalid token → 401 **before** any DB/queue effect (assert no row/no queue row); M2M accepted; `/refetch` without `food:admin` → 403                                                                               | required                                                    | 🚫 BLOCKED                           |
| Add-by-name → resolve: POST → 202+id + 1 `fetch_queue` row; drive worker; stub returns 1 candidate → RESOLVED; GET `/{id}` → 200 golden record (per-100g, per-field provenance, no `fdcId`); status PENDING→RESOLVED; `FoodFetchCompleted` emitted | required                                                    | 🚫 BLOCKED                           |
| UNRESOLVED → candidate pick: stub returns >1 distinct candidate → 202 UNRESOLVED; GET `/{id}/candidates` → the set; PATCH valid pick → RESOLVED + cleared; PATCH non-member → 409; PATCH on RESOLVED → idempotent 200                              | required                                                    | 🚫 BLOCKED                           |
| NOT_FOUND: stub returns 0 hits → NOT_FOUND tombstone; GET `/{id}` → 404 with status retrievable                                                                                                                                                    | required                                                    | 🚫 BLOCKED                           |
| Batch: mixed (seeded RESOLVED + new) → per-item partial; >100 → 400; intra-batch dup collapse                                                                                                                                                      | required                                                    | 🚫 BLOCKED                           |
| Search: seed RESOLVED; fuzzy/substring ranked; barcode/external_key crosswalk; no-match empty (zero source calls)                                                                                                                                  | required                                                    | 🚫 BLOCKED                           |
| FAILED: stub throws 5xx repeatedly → after retry budget FAILED tombstone + `FetchFailed`; GET → 404                                                                                                                                                | required                                                    | 🚫 BLOCKED                           |
| Backpressure: flood/queue-depth → POST → 503 + Retry-After                                                                                                                                                                                         | required (else cover at integration; already covered there) | 🚫 BLOCKED at e2e; ✅ at integration |

Every e2e flow above is gated on a single prerequisite — an authenticated request that survives the
`FoodAuthGuard`. With a real Clerk JWT and the as-installed `@clerk/backend@1.34.0`, **no request
survives the guard** (see §4), so the entire e2e suite would be red. Per the task ("STOP and report
rather than paper over it with a weak test or a silent code change") the e2e files were **not**
written against a mocked `verifyClerkToken`, because doing so would (a) contradict the explicit
"mint a real Clerk JWT" requirement and (b) hide the production bug behind a green test.

---

## 3. E2E harness design (ready to land once §4 is fixed)

The harness is fully designed and the two hard parts are proven to work in isolation; only the guard
gate blocks wiring them into green tests.

1. **App + worker boot (one Postgres).** Boot the real app via
   `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(SourceAdapterRegistry)`
   `.useValue(stubRegistry)` → `createNestApplication()` → `listen(0)`. Construct a
   `FoodConsumerService` manually over the **same** `pg` pool with the **same** `stubRegistry`,
   `FetchQueueDao`, `FoodDao`, `RollingWindowLimiter`, `MergeAndPersistService` (real
   `GoldenRecordMergeEngine(stubRegistry)`), and a **capturing `EventBus`** (`putEvent` pushes to an
   array) wrapped in `FoodEventEmitter`. Drive it deterministically with `await consumer.drain()`
   after each enqueue — no `LISTEN/NOTIFY`, no timers, no `waitForTimeout`.
2. **Stub source adapter** (`tests/support/stub-source-adapter.ts`): implements `FoodSourceAdapter`
   with `source: 'usda'` (the only `food_source` enum value, so it registers in place of USDA and
   `SOURCE_PRIORITY` resolves it). Per-test programmable: `searchByName` returns N canonical
   `SourceCandidate`s (0 → NOT_FOUND, 1 → RESOLVED, >1 distinct → UNRESOLVED) or throws
   `SourceApiError('usda', 503, …)` (FAILED path); `fetchByKey`/`fetchByKeys` return canned
   `CanonicalCandidate`s (per-100g nutrients, portions, optional barcode). No real network.
3. **Real JWT minting** (`tests/support/jwt.ts`): `crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })`.
   Set `CLERK_JWT_KEY` = the SPKI public PEM (the `@clerk/backend` `RSA_PREFIX`
   `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA` is exactly the 2048-bit SPKI prefix, so the PEM is
   consumed as-is) and `CLERK_AUTHORIZED_PARTIES` = the test `azp`. Mint by signing
   `base64url(header).base64url(payload)` with `crypto.sign('RSA-SHA256', …, privateKey)`; header
   `{ alg: 'RS256', typ: 'JWT', kid: 'local' }`; payload `{ sub, azp, iat, nbf, exp, public_metadata: { scopes, permissions } }`.
   **Verified working**: `@clerk/backend`'s raw `verifyToken` accepts this token and rejects a
   wrong-`azp` token. An admin token sets `public_metadata.scopes = ['food:admin']`; an M2M token
   sets `azp` to the service-client party. (The blocker is the `clerk-verify` wrapper, NOT the mint.)

---

## 4. STOP — production auth bug found (blocks the e2e layer)

**`@kitchensink/clerk-verify.verifyClerkToken()` rejects EVERY valid token against the installed
`@clerk/backend@1.34.0`. The food-service `FoodAuthGuard` would therefore return `401` to every
request (including real Clerk session tokens) in production.**

### Root cause

`@clerk/backend@1.34.0` `verifyToken(token, { jwtKey, authorizedParties })` returns the **bare JWT
payload** on success (e.g. `{ sub, azp, iat, nbf, exp, public_metadata }`) and signals failure via a
`{ errors: [...] }` object — it does **not** wrap success in `{ data, errors }` (the package's own
`.d.ts` type `JwtReturnType<JwtPayload>` is inconsistent with the runtime success shape).

`packages/shared/clerk-verify/src/clerk-verify.ts:114` does:

```ts
if (result.errors || !result.data) {
    // success: errors=undefined, data=undefined
    throw new ClerkVerificationError(); // → ALWAYS throws on a valid token
}
const payload = result.data as unknown as Record<string, unknown>; // would be undefined
```

On a valid token `result.errors` is `undefined` and `result.data` is `undefined`, so `!result.data`
is `true` and it throws `ClerkVerificationError` → the guard maps that to `401`.

### Reproduction (run in `packages/services/food-service`, Node v24)

Generate a 2048-bit RSA keypair, set the public SPKI PEM as the key, mint and sign a token, then call
the real wrapper:

- `@clerk/backend` raw `verifyToken(token, { jwtKey: pubPem, authorizedParties: ['https://app.example.com'] })`
  → **returns** `{ sub, azp, iat, nbf, exp, public_metadata }` (success), and **throws** on a wrong `azp`.
- `@kitchensink/clerk-verify` `verifyClerkToken(token, { jwtKey: pubPem, authorizedParties: ['https://app.example.com'] })`
  → **throws `ClerkVerificationError`** for the _same valid token_. ← the bug.

### Why every existing suite is green despite this

The bug lives in the adaptation of `verifyToken`'s return shape, and every test mocks at or above that
seam:

- `food-service` integration (`foods-api.integration.test.ts`) mocks the **whole** `verifyClerkToken`
  → the real `result.data` check never runs.
- `clerk-verify` unit (`packages/shared/clerk-verify/src/__tests__`) mocks `verifyToken` to return the
  **legacy `{ data, errors }`** shape → it asserts the wrapper against a shape the installed runtime no
  longer produces.

A real minted JWT (the e2e's entire purpose) is the first thing to exercise the real path — and it 401s.

### Blast radius

- **food-service** `FoodAuthGuard` (`src/auth/food-auth.guard.ts`) — every `/v1/foods/*` route → 401.
- **identity-service** carries the identical pattern independently in
  `packages/services/identity/src/auth/clerk-auth.service.ts:84` (`result.errors || !result.data`). If
  it resolves to `@clerk/backend@1.34.0` at runtime it has the same defect. (Memory notes prior auth
  success on an earlier `@clerk/backend`; `clerk-verify`'s `package.json` pins `^1.27.0`, so a minor
  bump to 1.34 silently changed `verifyToken`'s success shape — a dependency-drift regression.)

### Recommended fix (NOT applied here — out of scope for a test slice; production change)

In `clerk-verify.ts`, branch on the runtime shape instead of assuming `{ data }`:

```ts
if (result && typeof result === 'object' && 'errors' in result && result.errors) {
    throw new ClerkVerificationError();
}
const payload = (result && 'data' in result && result.data ? result.data : result) as Record<string, unknown>;
if (!payload || typeof payload !== 'object') {
    throw new ClerkVerificationError();
}
```

Then update the `clerk-verify` unit test to assert the bare-payload success shape (and ideally pin
`@clerk/backend` to an exact version). Mirror the fix in `identity`'s `clerk-auth.service.ts`. This
should be owned by **`be-1`/`staff-engineer`** with a **`sec-aud-1`/`ssec-1`** review (auth boundary),
because it is a cross-service auth-path change with a privilege-escalation-adjacent surface.

Once fixed, wire §3's harness into `tests/e2e/foods-api.e2e.test.ts` to satisfy T-190.
