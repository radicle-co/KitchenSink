# 02 — Food (ingredient) service, client, schema package and workers

REVIEW of `packages/services/food-service/**`, `packages/clients/food-service/**`,
`packages/schemas/food/**`, and the food workers (admission, fan-out, change-refresh, bulk seed) on
branch `chore/code-quality-enforcement-phase-1-2` @ `4a979422` (working tree clean).

## Governing decisions read before forming an opinion

- `CLAUDE.md` → _"The 'food' service is really the INGREDIENT service…"_: `food_*` reads as
  `ingredient_*`, and **"the food DB keeps a SINGLE writer, the USDA/source pipeline"**. No finding below
  proposes a rename or a recipe write-back.
- `docs/architecture/decisions/0014-service-owned-api-contracts.md` + `docs/CODING_STANDARDS.md` §15 +
  `specs/governance-rules.md` GR-015 — the service authors the zod, `packages/schemas/food` is a literal
  generated copy, clients never redeclare a wire shape.
- `docs/architecture/decisions/0015-input-validation-at-every-boundary.md` — a bus payload and an HTTP
  body are both untrusted input.
- `docs/architecture/decisions/0019-recipe-import-spine.md` §4/§5 — superseding per-entity status
  messages with **"a monotonic sequence carried in the envelope, not by arrival order"**, and food
  **shell entries**, with the standing prohibition quoted verbatim: _"A shell entry is NOT a recipe
  written into the food database… The food database still has exactly one writer."_
- `docs/CODING_STANDARDS.md` §7 / §7.1 test-tier matrix.
- Source docstrings quoted in place below, including
  `packages/services/food-service/src/config/env.schema.ts:196-215` and
  `packages/services/food-service/src/foods/dao/food-sources.dao.ts:147-160`, both of which govern
  findings here.

**Nothing in the governing set is contradicted by any fix proposed below.** Two of the four
suspicions handed to me are refuted by those same documents plus the code (see _Suspicions refuted_).

---

## F-F1

**Severity**: High (unauthenticated remote memory exhaustion, in the DoS-defence component itself)

**File**: `packages/services/food-service/src/auth/auth-load-shedder.ts:62`, `:139-143`, `:146-163`;
reached from `packages/services/food-service/src/auth/food-auth.guard.ts:116-149`

**What breaks**: `AuthLoadShedder.failures` is a `Map<string, number[]>` keyed by an
**attacker-controlled string** with no size bound and no global sweep. The key is the leftmost
`X-Forwarded-For` hop (`sourceKey`, `:79-87`); the shared ALB _appends_ the real client IP, so a client
that sends its own `X-Forwarded-For` fully controls the leftmost value.

Concrete sequence — every request unauthenticated, no credential needed:

1. Attacker sends `POST /api/v1/foods` with `Authorization: Bearer <garbage>` and
   `X-Forwarded-For: 1.2.3.<n>` where `<n>` is fresh each request.
2. `food-auth.guard.ts:123` — `shouldShed(key)` returns `false` (fresh key, zero failures).
3. `:134` acquires a verification slot; `:141` runs the CPU-bound `verifyClerkToken` and throws.
4. `:145` `recordFailure(key)` → `auth-load-shedder.ts:140-142` **unconditionally** creates a new Map
   entry holding one timestamp.
5. Nothing ever removes it. Pruning lives only in `recentFailures` (`:146-163`), which is reached only
   from `shouldShed(sourceKey)` **for that same key**. A key that is never asked about again is never
   pruned, and by construction the attacker never reuses a key.

Two consequences, the second the serious one:

- The per-source `401`-rate cap (FR-052 defence #2) **never engages** — every request is a fresh bucket,
  so every request pays a full RSA verification. The module's own docstring (`:16-19`) anticipates the
  spoofing but only reasons about shedding efficacy: _"spoofing it only spreads an attacker's own flood
  across buckets, against which the global concurrency bound still holds."_ True for CPU; it says
  nothing about memory.
- Memory grows monotonically with **distinct spoofed values**, not with request rate. At ~80–120 bytes
  per entry (interned key string + one-element array + Map slot), ~10M distinct values ≈ 1 GB. The
  Fargate task has a hard memory limit, so the outcome is OOM-kill → restart → the attacker resumes.
  The unbounded structure is inside the component whose stated purpose (FR-052) is bounding this
  exact attack.

**Why it happens**: the design is a per-source sliding window, and a sliding window's pruning is
naturally _lazy on read_. That is correct when the key space is bounded (real client IPs behind an
ALB). Here the key space is caller-supplied and effectively unbounded, so lazy-on-read pruning never
runs for the keys that matter. The invariant "a source that has fully aged out holds no state" is
stated in the docstring (`:13-14`, _"The window self-heals… no cooldown bookkeeping"_) but is only
enforced for keys that are queried again.

**Smallest fix**: bound the map from the write side, in `recordFailure`. Two lines of intent, no API
change and no semantic change (a key whose entire ring is outside the window carries zero information):

```ts
/** Sweep every source whose failures have all aged out. Amortised: runs once per SWEEP_EVERY writes. */
private sweep(): void {
    const cutoff = this.now() - this.shedWindowMs;
    for (const [key, ring] of this.failures) {
        if (ring[ring.length - 1]! <= cutoff) { this.failures.delete(key); }
    }
}
```

Call it from `recordFailure` every `SWEEP_EVERY` (e.g. 1,000) writes, **and** add a hard
`MAX_TRACKED_SOURCES` (e.g. 50,000) above which `recordFailure` sweeps immediately and, if still over,
declines to add a new key — declining is safe because a brand-new key's count is below the threshold
anyway, so the shed decision is unchanged. Both bounds belong in this class, not the guard: the guard
already has one responsibility.

**Verified (how)**: read `auth-load-shedder.ts` in full and `food-auth.guard.ts:105-165`; traced the
call order `sourceKey → shouldShed → tryAcquire → verify → recordFailure → release`.
`rg -n "maxSources|MAX_SOURCES|maxTrackedSources|size >" packages/services/food-service/src/auth/`
returns nothing — **absence of any cap proven**. The seven cases in
`src/auth/__tests__/auth-load-shedder.test.ts` and the five in `__tests__/food-auth.guard.dos.test.ts`
cover threshold, isolation, self-heal, concurrency and key derivation; **none exercises key
cardinality**, which is why this survived. `grep -rl "LoadShedder" packages/*/*/src` shows the class is
food-only — no sibling service to compare against or to fix in step.

---

## F-F2

**Severity**: High (backpressure permanently corrupts food rows; blocks ADR-0019 §5)

**File**: `packages/services/food-service/src/foods/foods.service.ts:208-216` (`addByName`) and
`:264-294` (`batchAdd`)

**What breaks**: the row is created and **committed** before admission is consulted, so shedding leaves
an orphan.

```ts
// foods.service.ts:208 — commits a PENDING row (own transaction, food.dao.ts:284)
const result = await this.foodDao.createByName({ normalizedName: normalizeName(name), displayName: name });

if (result.created || result.reactivated) {
    await this.admission.admit(requesterId);   // :211 — throws FetchUnavailableError → 503
    await this.enqueue.publishFoodRequested({ /* … */ });   // :212 — never reached
```

Inputs → state → wrong behaviour, case 1 (fresh add at the ceiling):

- `fetch_queue` active depth ≥ `FOOD_MAX_QUEUE_DEPTH` (`admission.service.ts:62`).
- `POST /api/v1/foods {"name":"kale"}` → `createByName` inserts `food{status:'PENDING'}` and commits.
- `admit` throws → `503`. **No `fetch_queue` row, no `fetch_requesters` row exists.**
- The next add for `kale`, at any later time including long after the queue drains, takes the
  `result.created === false` / `reactivated === false` branch, falls through to `:221`, reads
  `status === 'PENDING'`, skips the `UNRESOLVED` re-fan-out arm at `:228`, and **returns
  `{id, status:'PENDING'}` at `:235` with no enqueue**. The food is stuck `PENDING` forever.
- Downstream: `GET /api/v1/foods/{id}` answers `202 PENDING` forever (`:97-102`);
  `GET /{id}/status` reports `PENDING` with `estimatedWaitSeconds: 30` forever (`:127-129`), which is
  an outright lie — no worker will ever see it. Only an admin `POST /{id}/refetch` recovers it, and only
  if an operator knows to look.

Case 2 is worse — it destroys committed state:

- `kale` is a `NOT_FOUND` tombstone past `FOOD_NOT_FOUND_TTL_DAYS`.
- `createByName`'s `ON CONFLICT DO UPDATE` (`food.dao.ts:255-273`) sets `status = 'PENDING'` and
  **clears `tombstoned_at`** — irreversibly, in its own committed transaction.
- `admit` then throws. The valid `404` tombstone is gone, replaced by a permanent `202 PENDING`, and the
  TTL anchor that would have let it re-tombstone is `NULL`.

`batchAdd` magnifies it: `:264` creates up to `FOOD_MAX_BATCH_NAMES` (default 100) rows in a loop and
calls `admit` once at `:287`, **after** all of them. One shed batch strands up to 100 rows.

No recovery exists. `FoodConsumerService.reapStaleLeases` (`worker/food-consumer.service.ts:409`)
reverts `in_flight` **`fetch_queue`** rows to `pending`; it has no notion of a `food` row with no queue
row. `rg -n "reap|orphan|stranded|requeue"` across `src/` finds no such sweep.

**Why it happens**: `admit` is positioned as a gate on _enqueueing_, and `createByName` is read as
"resolve the id" rather than as the mutation it is. But `createByName` is a committing write with two
side effects the 503 path leaves behind (a `PENDING` row, and a cleared tombstone), and the check-then-
act sequence has no compensating action. The backpressure tests
(`tests/foods-api.integration.test.ts:804-820`) assert only `res.status === 503` and the presence of
`retry-after` — they never assert what happened to the `food` row, so the orphan is invisible to the
suite. That is precisely the mutation-lens gap `CLAUDE.md` names: the test still passes with the bug.

**Smallest fix**: admit **before** the write, in both methods. `admit` reads only `fetch_queue` /
`fetch_requesters` and needs nothing from `createByName`:

```ts
public async addByName(name: string, requesterId: string): Promise<AddResponse> {
    await this.admission.admit(requesterId);          // gate FIRST — no row is written on a shed
    const result = await this.foodDao.createByName({ /* … */ });
```

This changes one observable behaviour and it is a strict improvement: an add for an **already-RESOLVED**
food would now be shed at the ceiling where today it is served from the local store. That is a real
regression to avoid, so the correct minimal shape is a cheap pre-read: look the food up by normalized
name first (`FoodDao.getById` via a `findByNormalizedName`, or reuse the existing search DAO), return the
existing non-terminal status with no write when one exists, and admit **before** `createByName` only on
the create/reactivate path. Either way the invariant to restore is one line: **no `food` row is written
on a request that will answer 503.** Add an assertion to `tests/foods-api.integration.test.ts:804` that
the shed name has no `food` row afterwards — that is the test that would have caught it.

**Verified (how)**: read `foods.service.ts` in full, `food.dao.ts:224-300` (the `createByName`
transaction and its `ON CONFLICT` clauses), `admission.service.ts` in full, and
`tests/foods-api.integration.test.ts:800-822`. Traced the second-add path line by line
(`:221 → :222 → :228 (UNRESOLVED-only, not taken) → :235`) to confirm no enqueue. Proved absence of an
orphan reaper by search.

---

## F-F3

**Severity**: High (confirms the suspicion — no real EventBridge adapter exists anywhere)

**File**: `packages/services/food-service/src/worker/main.ts:64`;
`packages/services/food-service/src/events/food-event-emitter.ts:202-215`;
`packages/services/food-service/infra/lib/food-service-stack.ts:263-268`, `:284`, `:366`, `:431`, `:492`,
`:814-816`

**What breaks**: `FoodFetchCompleted` and `FetchFailed` are written to **stdout**, never to a bus.

```ts
// worker/main.ts:64 — the ONLY production composition of the emitter
events: new FoodEventEmitter(new ConsoleEventBus(), undefined, (error, detailType) => …),
```

```ts
// events/food-event-emitter.ts:212-214 — what ConsoleEventBus does
public async putEvent(input: EventBusPutInput): Promise<void> { this.log(input); }
```

The infra half is fully built and entirely inert: `FoodEventBus` (`kitchensink-food-{stage}`) is
provisioned at `:266`, its name is injected as `FOOD_EVENT_BUS_NAME` at `:284`, `grantPutEventsTo` is
called for the API, worker and change-refresh task roles at `:366`/`:431`/`:492`, and the name is
exported as a `CfnOutput` at `:814`. **`FOOD_EVENT_BUS_NAME` is read by nothing** — the only occurrence
outside the stack that sets it is the stack's own test assertion. Three IAM roles hold a permission
that is never exercised, and an EventBridge bus exists per stage with zero publishers.

Concrete failure this causes today: **DSN-9's alarm never fires.** `spec.md:535` defines `FetchFailed`
as _"Fargate consumer worker -> CloudWatch/SNS on a **`FAILED`** tombstone only — a real retried source
failure"_. In production, a food that exhausts its retry budget against USDA emits a `console.info` JSON
line into an ECS log group with no subscription filter and no metric filter. Nobody is paged. A
sustained USDA outage or an expired `USDA_API_KEY` produces silently-accumulating `FAILED` tombstones —
users see `404`s and the operator sees nothing.

Two supporting facts that make the gap definitive rather than "wired later":

- **No EventBridge SDK is installed anywhere in the repo.**
  `grep -rl "client-eventbridge" --include='package.json' packages/` → no matches;
  `grep -rn "aws-sdk/client-eventbridge" packages/services/food-service` → no matches. Neither
  `package.json` nor `prod.package.json` carries it, so the real adapter cannot merely be unwired — it
  does not exist and could not run in the shipped image.
- **The emitter's docstring cites a CDK construct that was deleted.**
  `food-event-emitter.ts:8-9` and `:20` both say the `detailType` matches _"the deployed CDK
  `FoodFetchCompletedRule`"_. `grep -rn "FoodFetchCompletedRule" packages/` matches **only those two
  comment lines** — the stack itself records at `:264-266` that _"there is deliberately NO rule consumer
  on the bus right now (the prior search-indexer rule was removed…)"_. So the module documents a
  contract against a construct that no longer exists.

**Why it happens**: the seam is correct — `EventBus` (`food-event-emitter.ts:39-47`) is a clean port
and `ConsoleEventBus` is a legitimate no-AWS **test/local** adapter. The defect is that the no-op
adapter became the _production_ composition, and the comment at `worker/main.ts:5-7` ("the real
EventBridge bus is wired with the infra slice") recorded that as a plan rather than as an outstanding
gap. The infra slice then shipped the bus and the grants but never the client.

**Smallest fix**: add the real adapter and select it by configuration, leaving `ConsoleEventBus` as the
local/test fallback:

1. Add `@aws-sdk/client-eventbridge` to `package.json` **and** `prod.package.json`.
2. `src/events/eventbridge-event-bus.ts` — an `EventBus` implementation that wraps `PutEventsCommand`
   with `EventBusName` from `settingFromEnv('FOOD_EVENT_BUS_NAME')`, `Source: 'kitchensink.food'`,
   `DetailType: input.detailType`, `Detail: JSON.stringify(input.detail)`; it translates, it adds no
   behaviour (Adapter contract).
3. Register `FOOD_EVENT_BUS_NAME` in `FOOD_SETTING_SCHEMAS` (`config/env.schema.ts`) as
   `z.string().min(1).optional()` so the boot check validates it and `settingFromEnv` is the one reader.
4. `worker/main.ts:64` — `settingFromEnv('FOOD_EVENT_BUS_NAME')` present ⇒ `EventBridgeEventBus`, absent
   ⇒ `ConsoleEventBus`. One ternary; no other call site changes, because the seam already exists.
5. Re-add the CloudWatch alarm target for `FetchFailed` in the stack, or delete the bus, the three
   grants and the `CfnOutput` — one or the other, but not the current state where the infra asserts a
   capability the code does not have.
6. Correct `food-event-emitter.ts:8-9` and `:20` to name what actually consumes the event.

**Verified (how)**: read `food-event-emitter.ts` and `worker/main.ts` in full; `rg -n
"ConsoleEventBus|EventBusPutInput|EventBridgeClient|PutEvents|FoodEventEmitter"` across the repo —
every non-test construction of `FoodEventEmitter` outside `tests/` is `worker/main.ts:64` with
`ConsoleEventBus`; two dependency greps prove the SDK's absence; one grep proves
`FoodFetchCompletedRule` exists only in comments; read `food-service-stack.ts:250-300`, `:360-370`,
`:425-435`, `:485-495`, `:810-820`.

---

## F-F4

**Severity**: Medium (confirms the suspicion — the `safeJson` gap is real, and the same bug was already
diagnosed and fixed in the sibling client)

**File**: `packages/clients/food-service/src/client.ts:349`

**What breaks**:

```ts
// client.ts:317-337 — the try/catch/finally ENDS here
} catch (error) {
    throw new FetchUnavailableError(undefined, 'Food service request failed or timed out', error);
} finally { clearTimeout(timeout); }
// …
return {
    status: response.status,
    body: text.length > 0 ? JSON.parse(text) : undefined,   // :349 — OUTSIDE the try
```

A non-JSON body throws a raw `SyntaxError` out of `send()`, past every typed-error path.

Inputs → wrong behaviour: the shared internet-facing ALB answers `502`/`503`/`504` with an **HTML** page
during every deploy, and its default rule answers an unmatched host with **`404 text/plain`**
(ADR-0003). Either response makes `JSON.parse(text)` throw. The caller — the recipe service's
ingredient path, or a web component — receives a `SyntaxError`, so `isFetchUnavailableError(err)` is
`false`, `isNotFoundError(err)` is `false`, and every recovery branch a consumer wrote is skipped. A
routine, self-healing deploy blip surfaces as an unrecoverable generic crash.

The sharp edge is that **this client's own docstring claims to handle exactly this case and cannot**.
`toError`'s doc at `:442-443` states: _"or not our envelope at all — the shared internet-facing ALB
serves an HTML page for `502`/`503`/`504` during every deploy (ADR-0003). Both degrade to 'map by
status alone', which `errorForStatus` still does correctly."_ `errorForStatus` **would** do it
correctly; it is unreachable, because `send()` throws two frames earlier.

**Why it happens**: the body read was deliberately moved inside the armed deadline (`:325-328` — a
correct and well-reasoned change), but the _parse_ stayed on the return statement below the `finally`.
The 2xx path wants a strict parse; the error path must not have one. The sibling client already draws
that distinction and records why: `packages/clients/recipe-service/src/client.ts:254-286` defines
`safeJson` and splits `response.ok ? JSON.parse(text) : safeJson(text)`, with a docstring stating
_"Parsing that strictly used to throw a raw `SyntaxError` that escaped `toError` entirely… Soften the
error-body parse so `toError` maps by status (B16)."_ **The fix was applied to one client and not the
other**, which is also a DRY breach: one rule ("a non-2xx body may not be JSON") now has one
implementation and one omission.

**Smallest fix**: mirror the sibling exactly — add the same four-line `safeJson` to
`clients/food-service/src/client.ts` and change `:349` to:

```ts
body: text.length > 0 ? (response.ok ? JSON.parse(text) : safeJson(text)) : undefined,
```

Better still, extract `safeJson`/`normalizeResponse` once; but that is a second change, and the
one-line correction is what closes the defect. (Note `contractSkew.ts:239` has the same bare
`JSON.parse` and is **not** a defect: `checkContractSkew:138-148` wraps it in a total `catch`, so a
non-JSON `/health` resolves to silence exactly as its rule 2 requires. Verified by reading both.)

**Verified (how)**: read `client.ts` in full; confirmed the `try` block's extent at `:317-337` and that
`:349` is outside it. `rg -n "safeJson|JSON\.parse" packages/clients/` shows `safeJson` exists in
`recipe-service/src/client.ts:254` and **nowhere** in `food-service/src/`. Read
`recipe-service/src/client.ts:252-287` for the fixed form and its B16 rationale, and
`recipe-service/src/__tests__/client.transport.test.ts:191` which names the same failure.

---

## F-F5

**Severity**: Medium (coverage theatre — the test that claims F-F4's case cannot produce it)

**File**: `packages/clients/food-service/src/__tests__/client.test.ts:277-297`, with
`stubFetch` at `:51-55`

**What breaks**: the suite contains a test whose docstring is precisely F-F4 —

```
/**
 * The ALB case (ADR-0003): during every deploy the shared internet-facing load balancer answers `502`/`503`/
 * `504` with an HTML page, and its default rule answers an unmatched host with `404 text/plain`. None of that
 * is our envelope, and the error mapper must still produce the right typed error rather than throwing.
 */
it('maps a body that is not our envelope at all by status, without throwing', async () => {
    fetch: stubFetch(503, { html: '<html>503 Service Temporarily Unavailable</html>' }, { 'retry-after': '5' }),
```

— but the harness it uses **cannot emit a non-JSON body**:

```ts
// :51-55
function stubFetch(status: number, body?: unknown, headers: Record<string, string> = {}): typeof fetch {
    const init = body === undefined ? undefined : JSON.stringify(body);
    return vi.fn(async () => new Response(init, { status, headers })) as unknown as typeof fetch;
}
```

The wire body is `{"html":"<html>503 Service Temporarily Unavailable</html>"}` — **valid JSON**. The
test exercises "an envelope-shaped object with unrecognised keys", passes, and asserts nothing about
the HTML/`text/plain` case its own comment describes. It would still pass with `client.ts:349`
arbitrarily broken for non-JSON input, which is the mutation-lens failure `CLAUDE.md` forbids counting
toward the test mandate.

**Why it happens**: `stubFetch` is a good single-purpose helper for JSON bodies, and the author reused
it for a case that is defined by _not_ being JSON. The abstraction silently converted the input into
the thing the test was meant to exclude.

**Smallest fix**: add a sibling helper and a case that actually sends the bytes —

```ts
/** A `fetch` double returning a RAW (non-JSON) body — the ALB's HTML 503 / text-plain 404 (ADR-0003). */
function stubRawFetch(status: number, body: string, headers: Record<string, string> = {}): typeof fetch {
    return vi.fn(async () => new Response(body, { status, headers })) as unknown as typeof fetch;
}

it('maps a non-JSON error body (the ALB HTML page) by status, without throwing', async () => {
    const client = new FoodServiceClient({
        baseUrl: BASE,
        fetch: stubRawFetch(503, '<html><body>503 Service Temporarily Unavailable</body></html>', {
            'retry-after': '5',
            'content-type': 'text/html',
        }),
    });
    const error = await client.addByName('kale').catch((caught: unknown) => caught);
    expect(isFetchUnavailableError(error)).toBe(true);
});
```

Add the `404 text/plain` variant too (ADR-0003's default-rule response) and, per §7.1, keep the existing
JSON case — it covers a different thing. This test is red before F-F4's fix and green after, which is
the correct red→green ordering.

**Verified (how)**: read `client.test.ts:1-60` (harness) and `:255-300` (the two non-envelope cases);
confirmed `stubFetch` `JSON.stringify`s unconditionally, so no case in the file's 30 `it(` blocks can
reach `client.ts:349`'s throwing branch. `rg -n "html|text/plain|SyntaxError"` over the file returns only
the two lines quoted above.

---

## F-F6

**Severity**: Medium (change-refresh covers a fixed prefix of the catalogue forever)

**File**: `packages/services/food-service/src/foods/dao/food-sources.dao.ts:168-193`, consumed at
`packages/services/food-service/src/worker/change-refresh/change-refresh.consumer.ts:115` with
`DEFAULT_SCAN_LIMIT = 1000` (`:41`)

**What breaks**: the scan has no cursor, no offset and no rotation — every run selects the _same_
prefix.

```sql
SELECT fs.food_id, fs.source, fs.external_key, fs.item_version
  FROM food_sources fs JOIN food f ON f.id = fs.food_id
 WHERE f.status = 'RESOLVED' AND f.origin <> 'bulk'
 ORDER BY fs.food_id
 LIMIT ${limit}
```

`food.id` is a **ULID** (`db/ulid.ts`), which sorts lexicographically by creation time. So `ORDER BY
fs.food_id LIMIT 1000` is "the 1,000 oldest live-origin RESOLVED backing items", deterministically, on
every pass. The EventBridge rule runs the task **every 6 hours**
(`infra/lib/food-service-stack.ts:534-537`).

Once the live catalogue exceeds 1,000 backing items:

- items 1..1000 are re-fetched from USDA **4× per day, forever** — ~4,000 calls/day against a shared
  1,000/hr per-IP window, all of them re-checking the same rows;
- item 1001 onward is **never** re-checked. FR-032's guarantee ("detect that the external item changed
  upstream") silently stops applying to every food created after the 1,000th, and the newest foods —
  the ones most likely to be actively used — are exactly the ones excluded.

There is no signal for this. `ChangeRefreshResult` reports `{enqueued, expiredCandidateRows, scanned}`;
`scanned` reads a healthy 1,000 every run whether coverage is complete or 2% of the catalogue.

**Why it happens**: `limit` was correctly introduced as a _budget_ bound (the docstring at `:157-166`
explains the `origin <> 'bulk'` and `status` exclusions carefully, and notes _"the limit applies AFTER
the filters, so a large bulk catalog can never starve the live foods out of a pass"_). The word
"paging" appears — _"Ordered by `food_id` for stable paging"_ — but **nothing pages**: no caller passes
an offset or a cursor, and `runOnce` exits after one page. A stable order is a _precondition_ for
paging, not paging.

**Smallest fix**: order by staleness instead of by id, so each run picks up where the last left off and
the knob that already exists gets a consumer (see F-F7):

```sql
 WHERE f.status = 'RESOLVED' AND f.origin <> 'bulk'
   AND (fs.fetched_at IS NULL OR fs.fetched_at < now() - make_interval(days => ${staleThresholdDays}))
 ORDER BY fs.fetched_at ASC NULLS FIRST
 LIMIT ${limit}
```

`food_sources.fetched_at` is already written on every `upsertSource` (`food-sources.dao.ts:66-71`), so
this needs no schema change — but it does need the refresh path to touch `fetched_at` even when the
version was **unchanged**, otherwise an unchanged item is re-selected forever; that is a one-line
`FoodSourcesDao.markScanned(id)` called from `change-refresh.consumer.ts` after the compare. Add an
index on `(fetched_at)` for the access path. Also report `remaining` alongside `scanned` in
`ChangeRefreshResult` so incomplete coverage is observable rather than inferred.

**Verified (how)**: read `food-sources.dao.ts:140-195` (the full statement and its docstring),
`change-refresh.consumer.ts` in full, `db/schema/food.ts:75-130` (ULID `id`, `origin` is
`notNull().default('live')` so `origin <> 'bulk'` has no NULL hole), and
`infra/lib/food-service-stack.ts:525-552` for the 6-hour cadence. Confirmed by
`rg -n "scanLimit|offset|cursor"` that no caller supplies an offset and no cursor exists.

---

## F-F7

**Severity**: Low (an operator-facing knob that is validated, defaulted, documented and tested — and
read by nothing)

**File**: `packages/services/food-service/src/config/env.schema.ts:82-84`

**What breaks**:

```ts
// Change-driven-refresh staleness threshold in days (FR-032) — how old a RESOLVED food may be before
// the scheduled refresh re-checks it for upstream changes.
FOOD_STALE_THRESHOLD_DAYS: z.coerce.number().int().positive().default(30),
```

`grep -rn "FOOD_STALE_THRESHOLD_DAYS" --include='*.ts' --include='*.yaml' --include='*.json' packages/
.github/` returns **exactly two lines**: this definition, and
`src/config/__tests__/env.schema.test.ts:80` asserting its default is 30. **No production code reads
it.** It is in `FOOD_SETTING_SCHEMAS`, so it is boot-validated (a malformed value correctly fails the
process) — an operator who tunes it therefore gets _no error and no effect_, which is the worst of the
three possible outcomes. The comment's claim ("how old a RESOLVED food may be before the scheduled
refresh re-checks it") is a description of behaviour that does not exist: F-F6 shows the scan applies no
age predicate at all.

Note this is _not_ simply dead config to delete. `specs/003-usda-food-data/tasks.md:158` records that
the earlier age-based knob was removed on purpose — _"The old single-source `USDA_n_DAYS` is
**removed** (refresh is change-driven, not age-based)"_ — so a reader could reasonably conclude this
variable is a re-introduction of a rejected idea. It is worth resolving explicitly rather than either
deleting or wiring on a coin-flip.

**Smallest fix**: two acceptable resolutions, and the choice belongs to the owner.

- **Wire it** as the staleness predicate in F-F6's fix. This is the reading its own docstring asserts,
  it gives F-F6 a natural bound, and it does not resurrect age-_based_ refresh — the refresh is still
  change-driven; the threshold only decides _which rows are eligible to be compared this pass_.
- **Delete it** from `FoodOperationalConfigSchema` and its test, and add one line to
  `food-sources.dao.ts`'s scan docstring saying the scan is deliberately unfiltered by age.

Do not leave it as-is: a boot-validated knob with no consumer is a documented lie, and
`env.schema.ts:196-215` already records that this exact class of variable
(`FOOD_NOT_FOUND_TTL_DAYS`) was previously _"boot-validated and documented, with NO consumer at all"_ —
the same trap, caught once and repeated here.

**Verified (how)**: the `grep -rn` above, restricted to code/config extensions, across `packages/` and
`.github/` — two matches, both non-production. Cross-read `food-sources.dao.ts:168-193` to confirm no
age predicate, `change-refresh.consumer.ts:89-98` to confirm the constructor reads only
`FOOD_UNRESOLVED_TTL_DAYS`, and `tasks.md:158` for the historical ruling.

---

## F-F8

**Severity**: Low (a wire-boundary `Number()` with no finiteness guard; no consumer reads the field
today, which is the only reason this is not Medium)

**File**: `packages/clients/food-service/src/client.ts:350`, reaching
`:501` and `:547`

**What breaks**:

```ts
retryAfterSeconds: retryAfter !== null && retryAfter.length > 0 ? Number(retryAfter) : undefined,
```

`Retry-After` is legally either delta-seconds **or an HTTP-date** (RFC 9110 §10.2.3), and the header
arrives from an ALB/CDN this client does not control. `Number('Wed, 21 Oct 2015 07:28:00 GMT')` is
`NaN`, and `NaN` is neither `null` nor `undefined`, so it survives the nullish coalesce at `:501`:

```ts
return new FetchUnavailableError(res.retryAfterSeconds ?? body.details.retryAfterSeconds, body.message);
```

A malformed **header** therefore beats a perfectly valid `retryAfterSeconds` in the service's own
envelope — the failure is not "we lose the hint", it is "we replace a correct hint with `NaN`". A
consumer doing `setTimeout(fn, err.retryAfterSeconds * 1000)` schedules on `NaN`, which the timer
coerces to `0` and fires immediately: a client that believes it is backing off is instead hot-looping
against a service that just told it it was overloaded. `errors.ts:139-152` stores the value verbatim and
adds no guard.

Honest scoping: `grep -rn "retryAfterSeconds" packages/apps packages/services/recipe-service/src`
returns **nothing**, so no shipped consumer reads it today. This is a latent defect in a published field
of the client's typed contract, not a live outage.

**Why it happens**: `Number()` on an untrusted string is the same NaN class the _service_ side already
hardened against — `env.schema.ts:196-215` documents at length that _"`NaN` does not tighten a guard,
it DELETES it"_. That lesson was applied to config reads and not to header parsing.

**Smallest fix**: one line, plus the parallel guard in `errorForCode`:

```ts
const parsedRetryAfter = retryAfter !== null && retryAfter.length > 0 ? Number(retryAfter) : Number.NaN;
// …
retryAfterSeconds: Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0 ? parsedRetryAfter : undefined,
```

With `undefined` restored for a malformed header, `:501`'s `??` correctly falls through to the
envelope's value. Add one unit case with an HTTP-date `Retry-After` asserting the envelope's
`retryAfterSeconds` wins.

**Verified (how)**: read `client.ts:339-352`, `:479-519`, `:534-551` and `errors.ts:130-155`; confirmed
no `Number.isFinite` anywhere in the package; confirmed absence of consumers by grep across
`packages/apps` and `packages/services/recipe-service/src`.

---

## Suspicions refuted — the code is correct, and says so

Two of the four items handed to me are **not** defects. Recording that explicitly, because both were
real defects historically and the fixes are documented in place.

**Config read as NaN silently disabling a ceiling — REFUTED, for both variables.**
`FOOD_MAX_QUEUE_DEPTH` (`admission.service.ts:44`) and `FOOD_UNRESOLVED_TTL_DAYS`
(`change-refresh.consumer.ts:96`) both resolve through `settingFromEnv`
(`config/env.schema.ts:216-235`), which `safeParse`s against the _same_ `FOOD_SETTING_SCHEMAS` node the
boot check uses and **throws** on a malformed value (`:227-232`), naming the variable and quoting the
offending string. `AdmissionService`'s constructor comment (`:39-43`) and `settingFromEnv`'s docstring
(`:196-215`) both describe the exact `depth >= NaN` / `pending > NaN` failure and record that it is why
the reader exists. The change-refresh consumer explicitly has no `ConfigModule` — that is precisely why
`settingFromEnv` is called in its constructor rather than at the composition root
(`change-refresh.consumer.ts:67-72`), and the guard is proven by
`tests/change-refresh.consumer.integration.test.ts:296-298`, which asserts `build(...)` throws
`/FOOD_UNRESOLVED_TTL_DAYS/` for the value `'thirty'`. `rg -n "Number\(process\.env|parseInt\(process\.env"`
across `src/` finds no surviving hand-rolled numeric env read.

**`ApiExceptionFilter` logging nothing for unclassified throwables — REFUTED.**
`common/filters/api-exception.filter.ts:269-323`: `catch()` calls `this.record(...)` **before** writing
the response; `logLevelForStatus(500)` returns `'error'` (`:191-197`); `record` builds a context
carrying `status`, `code`, method/path/`requestId`, `errorName`, `errorMessage` and — for a 5xx only —
the stack (`:305-317`), and emits it through the `WorkerLogger` port. A sink failure degrades to the
pre-built `LOG_FAILURE_LINE` (`:320-322`) rather than being swallowed. The class docstring at `:248-253`
records that this hole existed and was closed under T-151. Two deliberate non-logging cases are correct,
not gaps: a sub-400 status (the `202 FOOD_PENDING` raised on the first read of every newly-requested
food) is a success travelling as an exception, and a 4xx logs at `warn` without a stack.

---

## ADR-0019 assessment — can this service host shell entries and superseding per-item status?

Assessed independently, against `docs/architecture/decisions/0019-recipe-import-spine.md` §4/§5 and the
single-writer rule in `CLAUDE.md`.

**Verdict: yes for §5 (the durable half is already built and does not breach single-writer); no for §4
(the message half has no emit path, no per-transition emission, and no supersession key).**

### The single-writer rule is NOT threatened, and the durable shell already exists

`POST /api/v1/foods {name}` → `FoodDao.createByName` inserts `food{status:'PENDING'}` and returns
`202 {id, status, estimatedWaitSeconds}` (`foods.service.ts:207-218`). **That row is already a shell
entry**: a stable ULID a recipe can reference before any substance exists. `food.status` is a five-value
`pgEnum` (`db/schema/food.ts:44`) governed by a guarded transition set — `LEGAL_PRIORS`
(`food.dao.ts:183-189`) applied as a conditional `UPDATE … WHERE status IN (…)` so an illegal
transition matches no row and throws (`:303-320`). That is a real State machine, not a status column,
and it is the right thing to hang ADR-0019's status on. `GET /api/v1/foods/{id}/status`
(`foods.service.ts:116-132`) is exactly the mid-import read §5 requires: _"A client that connects
mid-import renders correct state from a read."_

Single-writer holds, and the seam is already the one ADR-0019 §5 describes. The recipe service supplies
a **name** and receives an **id**; every byte of substance — `name`, `description`, `kind`, nutrients,
portions, per-field provenance — is written only by the USDA fan-out path through
`MergeAndPersistService`, and `food.origin` is `live | bulk`, both USDA
(`db/schema/food.ts:75`). The only other writer in the service is `UserErasureService`
(`foods/user-erasure.service.ts:52-56`), which deletes `fetch_requesters` rows and touches no food
content. So a recipe-driven shell is a **request**, not a write — precisely §5's framing (_"a shell is a
food in a pending state, created and advanced by the food service's own resolution pipeline… because a
recipe referenced an ingredient it had not yet resolved"_). **Nothing needs to change to preserve the
single-writer rule.** Worth stating so nobody "fixes" it: the `fetch_requesters` row an import creates
is the user↔ingredient linkage, and it is already covered by the erasure leg.

### What would have to change

1. **Fix F-F2 first — it is a blocker, not an adjacent bug.** A 1,000-recipe import (§1) is exactly the
   load that reaches `FOOD_MAX_QUEUE_DEPTH`. Under F-F2 every shed add-by-name strands a permanently
   `PENDING` shell, and the recipe holds a placeholder reference to it forever. §5's guarantee — "status
   is readable from the database at any time" — degrades into "reads `PENDING` forever", which is worse
   than a dangling id because it is indistinguishable from healthy in-flight work.

2. **Author the status vocabulary mapping once, as a wire contract.** §4's stages are
   `queued | processing | succeeded | failed | errored`; food's are
   `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`. They are **not** congruent, and the gap is
   substantive rather than cosmetic: **`UNRESOLVED` has no §4 member.** It means "awaiting a human
   disambiguation pick" — neither in flight nor terminal. Mapping it to `processing` tells a client to
   wait for work nobody is doing; mapping it to `failed` hides a state the user can still resolve via
   `PATCH /api/v1/foods/{id}`. Either §4 grows a member (e.g. `awaiting_input`) or the mapping is
   explicitly lossy and the client is told to re-read `GET /{id}/candidates`. `NOT_FOUND` → `failed`
   ("expected failure, no such thing upstream") and `FAILED` → `errored` ("unexpected fault") map
   cleanly. Per ADR-0014 / §15 / GR-015 this mapping is a **wire contract**: it must be zod authored in
   exactly one service and generated into `packages/schemas/*`. Two services hand-writing near-identical
   status shapes is the drift GR-015 exists to forbid, and ADR-0019 says so directly in its
   _Required by this ADR_ section.

3. **Build the emit path (F-F3).** ADR-0019's Consequences state _"Every emitting service now owns an
   outbox/publish path and its failure modes."_ Food owns neither: both events land on `console.info`,
   and no EventBridge SDK is installed. §4 is unimplementable until F-F3 is closed.

4. **Add a supersession key — the largest genuine gap.** §4 is explicit: supersession is decided by
   _"a monotonic sequence carried in the envelope, not by arrival order"_, because
   _"last-write-wins on arrival order silently reverts `succeeded` to `processing` on a redelivery"_.
   `FoodFetchCompletedDetail` (`events/food-event-emitter.ts:50-59`) carries `eventId` (a fresh ULID),
   `timestamp`, `id` and `status` — **no per-entity sequence**. A ULID is monotonic per _process_, not
   per entity, and two publishers can write for one food: the worker's terminal disposition
   (`worker/food-consumer.service.ts:374`) and, once §4 requires per-transition emission, the API's
   `patchResolve` path. Two processes minting ULIDs for one `food_id` gives no ordering guarantee at
   all. `food.updated_at` is advanced by `setStatus` on every transition and is the natural candidate,
   but a timestamp is not collision-free under a same-millisecond double transition. The correct fix is
   a monotonically-increasing `version integer` (or a per-row sequence) on `food`, bumped in the same
   conditional `UPDATE` as the status — **this is a one-way door**: it is a persisted-schema change on a
   table with data at rest, and it must be additive (`ADD COLUMN … NOT NULL DEFAULT 0`, backfill, then
   start reading), per expand-contract. Decide it before shells become load-bearing, not after.

5. **Emit on every transition, not only on terminal dispositions.** `publishFoodFetchCompleted` is
   called only from the worker's terminal outcomes. There is **no `queued` and no `processing`
   emission**, so an import that sits in the queue produces zero messages until it terminates — §4's
   _"`processing` — in flight, carrying the current stage"_ is unmet. The natural home is
   `FoodDao.setStatus`, which is already the single chokepoint every legal transition passes through;
   emitting from there (via the injected publisher, not from the DAO directly — the DAO must not learn
   about buses) makes "a message per transition" a structural property rather than a convention each
   call site must remember.

6. **Fire-and-forget publishing is compatible, and should stay.**
   `food-event-emitter.ts:172-176` swallows a bus failure into `onError`. ADR-0019 accepts a lost
   message _because_ §5's projection is the fallback — _"which is precisely why §5 is not optional"_. So
   this is correct as written, on one condition worth writing into the consumer's contract: no consumer
   may treat the **absence** of a message as the absence of a transition; the read is authoritative.

7. **Batch cap vs. import size, stated so nobody re-declares it.** `FOOD_MAX_BATCH_NAMES` defaults to
   100 (`env.schema.ts:76`) against §1's 1,000-recipe imports, so the recipe service must chunk. It must
   **not** re-declare the cap: `batchAddFoodRequestSchema` deliberately omits it
   (`client.ts:396-400`) because it is runtime configuration, and duplicating it client-side is the
   §15 breach that comment exists to prevent. Chunk to a locally-chosen size and let the `400`
   `BATCH_TOO_LARGE` body report the authoritative number.

### What is already right and should not be "improved"

The contract mechanics are in good order and worth stating plainly rather than manufacturing findings
against. `packages/schemas/food/src/schemas/*.schema.ts` is a **byte-identical** copy of each authored
`*.schema.ts` apart from the generated header — verified by `diff` on all five pairs (`foods`, `health`,
`api-error`, `service-erasure`, `admin-metrics`), so GR-015 holds. The boot-time skew check
(`src/contract/contract-skew.ts`) is fail-closed with an honest docstring about what it cannot catch,
runs first in `main.ts:32` before the deliberately-dynamic `AppModule` import, and is asymmetric with
the client's warn-only policy for a documented owner ruling. `ApiExceptionFilter` is the single author
of every error body. `FoodsController` correctly deleted its own status mapping. `BulkSeedService`'s
find-or-create and its status-dispatch are load-bearing and well-documented. The `origin <> 'bulk'`
exclusion in the change-refresh scan is correct and its rationale (F-C2) is recorded where a reader will
find it.

---

## Not examined

Stated so the gaps are visible rather than assumed covered:

- **`packages/services/food-service/infra/**`beyond the EventBridge/schedule/ALB lines cited** — I read`food-service-stack.ts:250-300`, `:360-370`, `:425-435`, `:485-495`, `:525-560`, `:645-660`,
`:810-820`. The remaining ~600 lines (ECS sizing, RDS wiring, log groups, cdk-nag suppressions, the
  migrate Lambda's VPC attachment) were not reviewed, and no CDK synth was run.
- **`src/foods/merge/**` (merge-engine, merge-and-persist, merge-sanitize)\*\* — read only through their
  call sites and docstrings. The golden-record blend rules, the survivor-count auto-resolve boundary and
  the provenance FK interactions are unaudited.
- **`src/sources/usda/**`** — I checked `usda.adapter.ts:294`for the`itemVersion`derivation and`:533`for`hashItem`, and read the bulk parser's docstrings only. The USDA HTTP mapping,
`usda-bulk.parser.ts`, `usda-bulk.reader.ts`and`@kitchensink/usda-client`'s boundary validation were
  not reviewed.
- **`src/foods/admin/**`, `src/foods/service-erasure.controller.ts`, `src/auth/food-service-erasure-\*`,
`src/lambdas/migrate/handler.ts`, `src/observability/emf-metrics.ts`,
`src/database/pool-config.ts`, `src/worker/worker-lock.ts`, `backoff.ts`, `concurrency.ts`,
`rolling-window-limiter.ts`\*\* — not read, or read only for the specific lines cited above. The
  service-principal EdDSA erasure path in particular is a security surface I did not audit.
- **The DAO layer's SQL beyond the statements quoted** — `fetch-queue.dao.ts` (leasing, demotion,
  reaping), `food-search.dao.ts`, `food-candidates.dao.ts`, `food-nutrients/portions/provenance` were
  not reviewed for correctness, isolation level, or index usage.
- **No code was executed.** No test suite, no typecheck, no lint, no `cdk synth`, no database. Every
  claim above is from reading source and from the searches quoted in each finding's _Verified_ field.
  In particular, F-F1's memory arithmetic is an estimate from structure size, not a measurement, and
  F-F6's "exceeds 1,000 backing items" precondition was not checked against any live catalogue count.
- **`packages/clients/food-service/src/__integration__/contractSkew.integration.test.ts`** and the food
  service's `tests/e2e/**` and `tests/load/**` were listed but not read, so I cannot say whether any of
  them covers F-F2 or F-F4 at a tier I did not inspect.
