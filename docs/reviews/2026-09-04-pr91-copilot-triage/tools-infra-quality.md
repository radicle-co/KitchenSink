# PR #91 review triage — `packages/tools/**`, `packages/infra/**`, `scripts/**`, `.specify/**` + all CodeQL / code-quality threads

**Base commit:** `254a906b`
**Author of this triage:** tools/infra/quality agent
**Scope:** every Copilot thread whose `.path` starts with `packages/tools/`, `packages/infra/`, `scripts/`,
`.specify/`, **plus** every thread opened by `github-advanced-security` (CodeQL) or `github-code-quality`,
regardless of path and including `isOutdated` ones. 30 threads.

⛔ **Nothing has been posted to the PR.** Reply text below is drafted for the owner to approve and post.

---

## Summary

| Outcome                                                          | Count                   |
| ---------------------------------------------------------------- | ----------------------- |
| **Fixed** (real defect, TDD red→green, committed)                | 11 threads / 11 commits |
| **Rejected** (wrong, stale, or a false positive)                 | 16 threads              |
| **Owner decision**                                               | 1 thread                |
| **Real, deliberately deferred** (measured; needs its own change) | 1 thread                |
| Already closed by earlier work on this branch                    | 1 thread                |

**Commits made (all on the branch, nothing pushed):**

| Commit     | Thread(s)                                                          |
| ---------- | ------------------------------------------------------------------ |
| `79f95e7a` | docgen ReDoS ×3 (`docblock.ts:53`, `:65`, `tokens.ts:104`)         |
| `e3d5874e` | `importLedger.ts:67` — unvalidated `JSON.parse`                    |
| `86fe2817` | `runImport.ts:441` — ledger write inside the create's `try`        |
| `75078f48` | `RecipeApiClient.ts:120` — POST retried after a possible commit    |
| `54bb5e7d` | `storageCapacity.ts:68` — `INT8_MAX` one above the real ceiling    |
| `690df2c7` | `prodWebSurface.ts:74` — optional Clerk key terminator             |
| `e4ca2b3b` | `boundariesRatchet.mjs:448` — `--update` writes a partial baseline |
| `a14742a2` | `contractOwners.mjs:185` — duplicate ownership undetected          |
| `34e98b96` | `commentTriggerGuard.test.ts:195` — privilege-analysis blind spots |
| `e67e63a3` | `importCookbook.ts:154` — unenforced "no production affordance"    |
| `bcc6a34c` | `Undocumented.tsx:8` — fixture `<button>` without `type`           |

**Verification:** every fix is red-first. Suites run green after: docgen 117/117 unit + 13/13 integration,
cookbook-import 611/611, contract-gen 215/215, infra/global `prodWebSurface` 36/36, `boundariesRatchet` 32/32,
`contractGenerationRunner` 15/15, `commentTriggerGuard` 18/18, plus the three services' real-schema
storage-capacity suites (food 4/4, recipe 14/14, identity 7/7). Lint, typecheck and Prettier clean on every
touched package. `vitestTempRoot` / `serviceDevRunner` / `cdkNagSynth.integration` fail in agent worktrees from
path length — environmental, unrelated, not run.

---

## FIXED

### 1. `PRRT_kwDOR7sDRs6ewRG0` / `PRRT_kwDOR7sDRs6ewRG8` / `PRRT_kwDOR7sDRs6ewRG9` — github-advanced-security

`packages/tools/docgen-components/src/docblock.ts:53`, `:65`, `tokens.ts:104` — `js/polynomial-redos`
(alerts 333/334/335). **Verdict: REAL — fixed in `79f95e7a`.**

**Evidence — measured before rewriting, not assumed.** Node 24, 2026-09-03, ×4 per doubling in every case:

| Regex                                         | 10k   | 20k    | 40k    | 80k     | after fix @ 1M |
| --------------------------------------------- | ----- | ------ | ------ | ------- | -------------- |
| `\*+\/$` (closer)                             | 16 ms | 64 ms  | 256 ms | 1026 ms | 0.44 ms        |
| `^@([A-Za-z][\w-]*)[ \t]?(.*)$` (tag)         | 18 ms | 79 ms  | 284 ms | 1140 ms | 0.93 ms        |
| `^-?\d*\.?\d+(?:rem\|px\|em\|%)$` (dimension) | 28 ms | 114 ms | 450 ms | 1808 ms | 1.07 ms        |

All three are genuinely quadratic. Causes: the closer is unanchored at the start, so a trailing run of stars
that is _not_ a closer restarts the scan at every star; the tag remainder uses `.`, which refuses `\r`, so the
anchored `$` fails and every split between the tag name's `[\w-]*` and the remainder is retried; the dimension
pattern lets `\d*` and `\d+` share one run of digits.

Tests are pinned at **100 000 with a 100 ms budget** — the originals needed 1.6–2.8 s at that size (~15× above
the defect, ~500× above the fix), so they red on the defect without flaking on a slow runner. A 14-row grammar
table for the dimension rewrite passed against the **original** regex first, proving the new form accepts the
same language rather than merely being faster.

**Bonus correctness defect found while measuring:** the same `(.*)$` meant that in a **CRLF** docblock every
tag was silently read as prose with `\r` leaking into the text. Only Prettier's LF rule kept that off the real
tree. Now covered by its own test.

> **Reply:** Confirmed and fixed in `79f95e7a`. All three were measured quadratic before anything was
> rewritten (Node 24, ×4 per doubling): the closer took 1026 ms on 80 000 stars, the tag tail 1140 ms, the
> dimension pattern 1808 ms; the linear forms run in under 1 ms at a million. Each is now pinned by a
> red-first test at 100 000 with a 100 ms budget. Measuring also surfaced a correctness bug hiding behind the
> same `(.*)$`: on a CRLF file every tag was read as prose with `\r` in the text — that has its own test now.

---

### 2. `PRRT_kwDOR7sDRs6bZHFZ` — copilot · `packages/tools/cookbook-import/src/importLedger.ts:67`

Unvalidated `JSON.parse` cast. **Verdict: REAL — fixed in `e3d5874e`.**

Confirmed exactly as described. `JSON.parse(raw) as Record<string, LedgerEntry>` walked straight through the
"corrupt file THROWS" guard: `[]` loaded as an **empty ledger** and would re-import every recipe it recorded —
the one failure the ledger exists to prevent — `null` died on `Object.entries` with a message naming no file,
and `{ "k": null }` / a missing `recipeId` produced a record whose audit trail pointed at nothing.

Now parsed with a zod record of `{ recipeId: non-empty string, importedAt: ISO 8601 }` inside the same `try`,
so every malformed value gets the existing fail-closed message with the original error as `cause`.
`LedgerEntry` is inferred from the schema so type and parser cannot drift. Zod was already a dependency.

Red-first: 8 fixtures, 7 failed. (`null` "passed" only because `Object.entries(null)` happened to throw.)

> **Reply:** Confirmed and fixed in `e3d5874e`. `[]` was the worst of the set — it loaded as an _empty_ ledger,
> which would re-import every recipe the ledger recorded, i.e. the exact duplication it exists to prevent,
> while reporting a clean run. The file is now parsed with a strict zod record inside the same `try`, so
> malformed-but-valid JSON gets the same fail-closed refusal as unparseable text, and `LedgerEntry` is
> inferred from that schema so the two cannot drift. Eight fixtures, seven red beforehand.

---

### 3. `PRRT_kwDOR7sDRs6bZ1BB` — copilot · `packages/tools/cookbook-import/src/runImport.ts:441`

Ledger write inside the same `try` as the POST. **Verdict: REAL — fixed in `86fe2817`.**

Exactly right, and the consequence is worse than "recorded as failed": the run **continued**, so a successful
POST followed by a failed ledger write was logged `REFUSED`, counted as a failure, and the next resume created
the recipe again — a duplicate manufactured by the ledger's own failure path.

The create keeps its `try` (a refused body must not discard the rest of the corpus, per 004-FR-026). The
ledger write moved out, and a failure there now propagates and stops the run. The `created` log line carries
the recipe id and is emitted **before** the ledger write, so the one row the ledger does not know about is
still in the operator's trail.

Red-first: the run resolved instead of rejecting, and the id was absent from the log.

> **Reply:** Confirmed and fixed in `86fe2817`. Worth noting the failure was one step worse than described —
> the run didn't just mislabel it, it _continued_, so the next resume re-created a recipe that already existed.
> Treated as fatal now: the create keeps its own `try` (004-FR-026's partial-failure rule), the ledger write
> sits outside it, and the `created` line logs the recipe id _before_ the write so the unrecorded row is still
> traceable. Two red-first tests.

---

### 4. `PRRT_kwDOR7sDRs6a_joW` — copilot · `packages/tools/cookbook-import/src/RecipeApiClient.ts:120`

`pRetry` retries `429/502/503/504` and schema failures for every method including `POST /api/v1/recipes`.
**Verdict: REAL — fixed in `75078f48`.**

Confirmed, and the schema-parse case is the sharpest: a `ZodError` is not an `AbortError`, so a 2xx whose body
failed the contract was retried — after the row was already created. The file's header claimed only
"IDEMPOTENT-in-effect failures are retried", which was false for every POST.

Policy is now decided by method. `429`/`503` are the server stating it did **not** process the request and stay
retryable everywhere. `502`/`504`, transport failures and contract-failing 2xx can all _follow_ a commit: a GET
retries them, anything else fails on the first attempt. A contract-failing 2xx is reported with the status the
service gave rather than as a transport failure, because the transport worked.

Red-first: 9 cases with `fetch` stubbed and p-retry on fake timers; the 4 POST cases each scripted a success as
the second answer and failed with _"called 1 times, but got 2"_.

**Checked against the shared retry predicate** (`@commise/query`'s `shouldRetryQuery`, composed from each
client's `shouldRetry*Failure`): genuinely a different path. That one is the read-side **TanStack Query**
policy for the web/mobile apps, dispatching on error _type_, and its own docstring notes mutations are never
retried by TanStack — so that layer never had a re-issued-POST problem. `cookbook-import` is a Node CLI on
`p-retry` with no `@tanstack/*` or `@commise/query` dependency, a different client class and a different error
type. No shared rule was bypassed.

> **Reply:** Confirmed and fixed in `75078f48`. The sharpest case was the one not listed: a `ZodError` is not
> an `AbortError`, so a 2xx whose body failed the published schema was also retried — after the row existed.
> Retry is now decided by method: `429`/`503` (the server saying it did _not_ process the request) stay
> retryable everywhere; `502`/`504`, transport failures and contract-failing 2xx are retried only for
> idempotent methods. The durable fix is a server-enforced idempotency key on the create endpoint — until the
> service has one the transport refuses to guess, and the header now says so. Nine red-first cases.

---

### 5. `PRRT_kwDOR7sDRs6bcNeA` — copilot · `packages/tools/contract-gen/src/storageCapacity.ts:68`

`INT8_MAX = 2 ** 63` is one above PostgreSQL's `bigint` max. **Verdict: REAL — fixed in `54bb5e7d`.**

Correct, and the old docstring made the error explicit while getting it backwards: it claimed nothing could
land in the one-ULP gap, when the **gate itself** was sitting in it. `2^63 - 1` is not a double; the nearest
representable values are `2^63 - 1024` and `2^63`. An inclusive ceiling at `2^63` therefore accepted a wire
`.max(2 ** 63)` for a value Postgres answers `22003` for, defeating the 400-before-INSERT guarantee.

Modelled now as what it is in the double domain: `describeColumnCapacity` returns
`{ max: INT8_EXCLUSIVE_MAX, exclusive: true }`, reusing the `exclusive` flag a wire `.lt()` bound already
carried. `INT8_MAX` was **renamed**, not silently revalued, so no reader keeps the old meaning. The finding
renders "holds only values below N" rather than "at most N".

Red-first, bracketing the boundary from both sides — including a case that must keep passing:
`.int().max(2 ** 63)` still fits, because `.int()` makes zod publish its own safe-integer ceiling, so the
literal is not the bound the wire enforces. Kept beside the failing case so nobody "fixes" one by breaking the
other. Verified against the **real** schemas since food-service declares a `bigserial('id', { mode: 'bigint' })`
on the changed path.

> **Reply:** Confirmed and fixed in `54bb5e7d`. The old docstring argued nothing could land in the one-ULP gap
> — the gate itself was in it. `bigint` is now modelled as an _exclusive_ ceiling at `2^63` (reusing the flag a
> wire `.lt()` bound already carried), and `INT8_MAX` was renamed to `INT8_EXCLUSIVE_MAX` rather than silently
> revalued. Red-first on both sides of the boundary, including `.int().max(2 ** 63)`, which must keep passing
> because zod publishes its own safe-integer ceiling there. Re-verified against the real schemas —
> food-service has a `bigserial` on this path.

---

### 6. `PRRT_kwDOR7sDRs6bZ1At` — copilot · `packages/infra/global/__tests__/prodWebSurface.ts:74`

Optional terminator accepts a malformed-but-decodable key. **Verdict: REAL — fixed in `690df2c7`.**

Confirmed. `.replace(/\$$/, '')` stripped the terminator only when present, so a payload encoding
`commise.app` with no `$` was returned as a production instance and could make `classifyStageCoherence` pass —
for a key `ClerkProvider` would refuse to load at all.

The rule is now clerk-js's own, taken from `isValidDecodedPublishableKey` (`@clerk/shared` 4.30.1, read from
`node_modules`): the decoded payload must end in `$`, carry no other `$`, and name a host containing a dot.
Anything else returns `null`, which `classifyStageCoherence` already treats as incoherent — so the stricter
parse fails **closed**. Red-first: 4 malformed-but-decodable fixtures plus one asserting the verdict flips to
incoherent rather than production.

**Coordination (as instructed):** `packages/apps/commise/web/src/config/clerkStageCoherence.ts` is the
build-time twin and has the same optional-terminator shape (`.replace(/\$+$/, '').trim()`). It is owned by the
apps agent and deliberately **untouched** here; the fix it wants is this one, and the shared rule is Clerk's
own — mirroring `isValidDecodedPublishableKey` rather than inventing a second rule.

> **Reply:** Confirmed and fixed in `690df2c7`. The parser now applies clerk-js's own rule
> (`isValidDecodedPublishableKey`, `@clerk/shared` 4.30.1): terminator required, no embedded `$`, host must
> contain a dot — anything else returns `null`, which the coherence classifier already treats as incoherent,
> so it fails closed. Five red-first fixtures. The `clerkStageCoherence.ts` twin has the same shape and is
> owned by another agent on this branch; it's flagged rather than edited here, and the fix it wants is this
> same rule.

---

### 7. `PRRT_kwDOR7sDRs6bCf_h` — copilot · `scripts/boundariesRatchet.mjs:448` _(marked outdated — still live)_

`--update` with an unreadable file writes a partial baseline and exits 0. **Verdict: REAL — fixed in `e4ca2b3b`.**

Confirmed by reading the control flow: the check path defers its `exit(1)` for an unparseable file to the very
end (so real violations print first — deliberate, and documented in-file), but `if (update)` sits **above** that
deferred exit and calls `process.exit(0)` after `writeFileSync`. So `--update` regenerated the baseline from
only what parsed and exited 0, silently dropping the unchecked file from the ratchet forever. The script's own
message already said it: _"do not baseline it, as there is nothing here to baseline."_

`--update` now aborts before writing whenever any file failed to parse. The check path is untouched.

Red-first, 4 cases: exit 0 instead of 1, the baseline overwritten with a partial set, and no mention of the
unparseable file — all three red; the control ("still updates normally when every file parsed") passed
throughout, proving the fixture was otherwise valid.

> **Reply:** Confirmed and fixed in `e4ca2b3b`, despite the thread being marked outdated — the ordering was
> still live. The check path defers its `exit(1)` on purpose so real violations print first, but `--update`
> sits above that deferred exit, so it wrote a baseline built from only the files that parsed and exited 0 —
> dropping the unchecked file from the ratchet permanently. It now aborts before `writeFileSync`. Four
> red-first cases, with a control proving the fixture was otherwise valid.

---

### 8. `PRRT_kwDOR7sDRs6bWu19` — copilot · `scripts/contractOwners.mjs:185` _(marked outdated — still live)_

`claimed` is a `Set`, so only the zero-owner case is detected. **Verdict: REAL — fixed in `a14742a2`.**

Confirmed. Two schema packages delegating to the same service both left `claimed.has(name)` true, so nothing
was reported. Not a harmless duplicate: a service's `contract:generate` writes only its own document, so the
second `openapi.yaml` is never regenerated and the drift check then finds no diff and reports a clean contract
it never verified — which is precisely the failure the module's own docstring says it exists to prevent,
reached from the other direction.

The set became a `Map<serviceName, schemaPackageName[]>`; any service with more than one claimant is reported
by name with its claimants listed. The zero-owner branch now tests the same map, so the two directions cannot
drift apart.

Red-first: the duplicate case reported **zero** problems. The one-to-one control and the real-repository
correspondence check both passed throughout — the tree has no duplicate today, so this catches the next one.

> **Reply:** Confirmed and fixed in `a14742a2` (still live despite the outdated marker). The `Set` could only
> answer the zero-owner half. Now a `Map` of service → claimants, reporting any service claimed more than once,
> with the zero-owner branch reading the same map so the two directions can't drift. Red-first — the duplicate
> case reported zero problems before. The real-tree correspondence check passes throughout, so nothing is
> duplicated today; this catches the next one.

---

### 9. `PRRT_kwDOR7sDRs6bZHFU` — copilot · `packages/infra/global/__tests__/commentTriggerGuard.test.ts:195`

Workflow-level `env` invisible; secret matcher misses `secrets['X']` and `toJSON(secrets)`.
**Verdict: REAL — fixed in `34e98b96`.**

Both halves confirmed, and this is the guard standing between an arbitrary GitHub user and a comment-triggered
job holding a long-lived credential, so the blind spots matter:

- `JSON.stringify(job)` cannot see workflow-level `env:`, which GitHub gives to **every** job — while
  `permissions` already fell back to the document. Asymmetric and wrong.
- The matcher knew `secrets.NAME` and `"secrets":`. `${{ secrets['TOKEN'] }}` and `${{ toJSON(secrets) }}` are
  both valid, both dot-free, and the second hands over every secret at once.

Workflow `env` is folded into the serialized body — **only** `env`, because serializing the whole document
would make every job privileged the moment any job named a secret, which is a false finding rather than a
missed one. The spellings became a named list requiring the identifier to be _used_ as a context (followed by
`.` or `[`, or passed whole to a function), never the bare word, so prose mentioning "secrets" stays clean.

Red-first: 3 fixtures returned no finding; a fourth (prose) control returned none throughout, bracketing both
directions. The real-tree pin still resolves to exactly `claude.yml::claude` with no new findings, so the
broader matcher costs no false positive on the actual workflows.

> **Reply:** Confirmed on both counts and fixed in `34e98b96`. Workflow-level `env` is now folded into the
> serialized body — only `env`, since serializing the whole document would make every job privileged the moment
> any one named a secret — and the spellings became a named list covering `secrets.X`, `secrets['X']` and
> `toJSON(secrets)`, each requiring the identifier to be _used_ as a context so prose mentioning "secrets"
> stays clean. Three red-first fixtures plus a negative control; the real-tree pin still resolves to exactly
> `claude.yml::claude`, so no false positives were introduced. Line 280 is the same function and is covered by
> the same fix.

---

### 10. `PRRT_kwDOR7sDRs6a_joJ` — copilot · `packages/tools/cookbook-import/scripts/importCookbook.ts:154`

`--recipe-url` accepts an arbitrary origin despite the documented "no production affordance".
**Verdict: REAL — fixed in `e67e63a3`.**

Confirmed: both the CLI header and the README asserted the property in bold and nothing enforced it. One
pasted or mistyped production origin would have created real, **public** `imported_public` recipes in bulk,
with no second confirmation and no undo.

Implemented as an **allow-list** (`src/writableOrigin.ts`): only localhost, `pr-{N}` and `sandbox.commise.app`
origins are admitted; everything else — _including hosts it does not recognise_ — is refused, because "not
obviously production" is not "safe to write to". The host comes from a parsed `URL`, never matched in the raw
string, so `https://evil.com/?x=sandbox.commise.app` is refused and the dot-anchored suffix stops
`sandbox.commise.app.evil.com`.

Deliberately **not** a third copy of the two stage classifiers (`classifyHostStage`,
`classifyEndpointStage`): those must place every host and answer `unknown`, which is right for a coherence
report and wrong for a write gate, where the unrecognised host is the one to stop. Different question,
opposite default.

Took the "reject production origins" half of the suggestion and **declined the override**: the requirement
today is "never production", so an escape hatch would be capability built for a presumed future need — and the
first thing a hurried operator reaches for. Red-first (module unresolved), then 26 cases.

> **Reply:** Confirmed and fixed in `e67e63a3`. `--recipe-url` now goes through an allow-list that admits only
> localhost, `pr-{N}` and `sandbox.commise.app` origins and refuses everything else, unrecognised hosts
> included — the host is taken from a parsed `URL` so `https://evil.com/?x=sandbox.commise.app` and
> `sandbox.commise.app.evil.com` are both refused. I took the "reject production origins" half and
> deliberately skipped the override: the requirement today is "never production", so an escape hatch would be
> speculative capability and the first thing a hurried operator reaches for. 26 red-first cases; README and
> header updated to say the property is enforced rather than merely asserted.

---

### 11. `PRRT_kwDOR7sDRs6exkUs` — copilot · `.../__fixtures__/components/Undocumented.tsx:8` _(outdated)_

Fixture `<button>` without `type`. **Verdict: MINOR but correct — fixed in `bcc6a34c`.**

The stated risk does not apply — this fixture is only ever read as _source_ by the extractor and never
rendered, so no form can submit. But a fixture is example code, and `type="submit"` is the wrong default to
leave for the next person to copy. Behaviour-neutral: the extractor reads docblocks and prop types, not the
JSX body. 117/117 green, including the four assertions naming this fixture.

> **Reply:** Fixed in `bcc6a34c`. The stated risk doesn't actually apply — this fixture is only read as source
> by the extractor and never rendered — but it's example code and `type="submit"` is the wrong default to leave
> for someone to copy. Behaviour-neutral for the suite (117/117, including the four assertions that name it).

---

## REJECTED

### 12–14. `PRRT_kwDOR7sDRs6YbPdR`, `PRRT_kwDOR7sDRs6YbPdW`, `PRRT_kwDOR7sDRs6Ywx4m` — github-advanced-security

`contractSkew.test.ts` (food-service `:253`, recipe-service `:256`, features-account `:253`) —
`js/use-of-returnless-function`, alerts 308/309/313. **Verdict: FALSE POSITIVE — the return value is the
assertion's subject.**

`reportContractSkewOnce` is declared `: void` deliberately, and the flagged line is the test that **proves**
it. From the suite itself:

```ts
it('is synchronous and returns nothing, so no caller can accidentally await it on a hot path', () => {
    expect(reportContractSkewOnce({ baseUrl: BASE, fetch: fetchImpl, warn })).toBeUndefined();
});
```

The function fires a fire-and-forget probe (`void checkContractSkew(options).catch(...)`) precisely so a
per-keystroke typeahead client cannot await it. Asserting `toBeUndefined()` is how that contract is pinned;
"using the return value" is the point. Removing the assertion would delete the guarantee.

> **Reply:** False positive — the return value _is_ what the test asserts. `reportContractSkewOnce` is `void`
> on purpose (it fires a fire-and-forget probe so a per-keystroke typeahead client cannot await it on a hot
> path), and this line is the test that pins that contract: `expect(reportContractSkewOnce(...)).toBeUndefined()`.
> The test's own name says so. Dropping the assertion would delete the guarantee. Suggest dismissing all three
> as "used in tests".

---

### 15–17. `PRRT_kwDOR7sDRs6ZjvXh`, `PRRT_kwDOR7sDRs6ZjvXl`, `PRRT_kwDOR7sDRs6ZjvXn` — github-code-quality

`errorContractLockstep.test.ts` (food `:125`, recipe `:114`, `:473`) — "Invocation of non-function".
**Verdict: ALREADY DISMISSED — no action.**

The corresponding CodeQL alerts are **already closed as false positives** on the security tab:

```
319 js/call-to-non-callable dismissed false positive .../recipe-service/.../errorContractLockstep.test.ts:473
318 js/call-to-non-callable dismissed false positive .../recipe-service/.../errorContractLockstep.test.ts:114
317 js/call-to-non-callable dismissed false positive .../food-service/.../errorContractLockstep.test.ts:125
```

The flagged calls are `new ApiExceptionFilter().catch(throwable, host)` and the `call(client)` callback
parameter — both genuinely callable; the analyzer loses the type through the `as unknown as ArgumentsHost`
casts the harness uses to build a Nest `ArgumentsHost` double. These threads are the code-quality bot's
duplicate of alerts already adjudicated.

> **Reply:** No action — the matching CodeQL alerts (317, 318, 319) are already dismissed as false positives on
> the security tab. The analyzer loses the callee's type through the `as unknown as ArgumentsHost` casts the
> harness uses to build the Nest `ArgumentsHost` double; the calls are genuinely callable. These threads are
> the code-quality bot's duplicates of that adjudication.

---

### 18–21. `PRRT_kwDOR7sDRs6ZjvXw`, `PRRT_kwDOR7sDRs6ZjvXy`, `PRRT_kwDOR7sDRs6Zjvr7`, `PRRT_kwDOR7sDRs6Zjvr8`

`packages/services/recipe-service/src/config/__tests__/loadConfig.test.ts:55` and `:120` — "Missing await"
(alerts 315/316, plus the code-quality duplicates). **Verdict: FALSE POSITIVE — verified as predicted.**

`loadConfig` is **overloaded**, and the tests call the synchronous arm:

```ts
// packages/services/recipe-service/src/config/loadConfig.ts
157: export function loadConfig<Schema extends z.ZodTypeAny>(…): Promise<z.infer<Schema>>;   // async arm
162: export function loadConfig<Schema extends z.ZodTypeAny>(schema: Schema, env?: Record<string, unknown>): z.infer<Schema>;
164: export function loadConfig<Schema extends z.ZodTypeAny>(…): z.infer<Schema> | Promise<z.infer<Schema>>
```

Both flagged lines pass `(schema, env)` — line 55 is `loadConfig(apiConfigSchema, validEnv())` and line 120 is
`loadConfig(apiConfigSchema, { ...validEnv(), FOOD_SERVICE_TOKEN: 'static-token' })` — which selects the
2-argument overload returning `z.infer<Schema>`, not a promise. The tests then read `config.NODE_ENV`,
`config.PORT` and `'FOOD_SERVICE_TOKEN' in config` directly; if these were promises those assertions could not
pass, and the suite is green. CodeQL is reading the implementation signature's union return rather than the
overload the call resolves to.

> **Reply:** False positive, verified. `loadConfig` is overloaded and both lines call the **synchronous**
> `(schema, env)` arm declared at `loadConfig.ts:162`, which returns `z.infer<Schema>` — not a promise. The
> tests then read `config.NODE_ENV`, `config.PORT` and `'FOOD_SERVICE_TOKEN' in config` off the result
> directly, which could not pass if it were a promise, and the suite is green. CodeQL is reading the
> implementation signature's union return instead of the resolved overload. Suggest dismissing all four
> (315/316 plus the two code-quality duplicates) as false positives.

---

### 22–23. `PRRT_kwDOR7sDRs6Zjvr9`, `PRRT_kwDOR7sDRs6fJMAR`

`packages/services/recipe-workers/src/handlers/__tests__/handleSyncWorker.test.ts:138` — "Superfluous trailing
arguments" (alert 314 + code-quality duplicate). **Verdict: FALSE POSITIVE — the arity is the AWS contract.**

`handler` is declared with the AWS Lambda type, whose call signature takes three parameters:

```ts
export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => { … }
```

`SQSHandler` is `Handler<SQSEvent, SQSBatchResponse>` — `(event, context, callback)`. The implementation
destructures only `event` because it needs nothing else, which is ordinary and correct; the _type_ still
declares three, and the test calls `handler(event, {} as never, () => {})` to match the contract the runtime
invokes it with. Passing fewer would be the anomaly. CodeQL is comparing against the implementation's arity
rather than the declared type's.

> **Reply:** False positive. `handler` is typed `SQSHandler` (= `Handler<SQSEvent, SQSBatchResponse>`), whose
> call signature is `(event, context, callback)` — that's the shape AWS invokes it with, and the test matches
> it. The implementation destructures only `event` because it needs nothing else, which is normal; CodeQL is
> comparing against the implementation's arity rather than the declared type's. Suggest dismissing 314 and its
> code-quality duplicate.

---

### 24. `PRRT_kwDOR7sDRs6amdGw` — github-advanced-security

`packages/tools/cookbook-import/src/RecipeApiClient.ts:91` — `js/file-access-to-http` (alert 325).
**Verdict: FALSE POSITIVE — that data flow is the tool's entire purpose.**

The flow is: an operator downloads a public-domain cookbook by hand (ADR-0026 — nothing we deploy fetches
Project Gutenberg), `--file` reads it, and the parsed recipes are POSTed to the recipe service. "File data
reaches an outbound request" is a one-line description of what a cookbook importer _is_.

No untrusted-file exposure exists: the corpus path is supplied by the operator on the command line, the
destination is now allow-listed to localhost/`pr-{N}`/sandbox (`e67e63a3`), and every request body is validated
against the published contract (`createRecipeRequestSchema.parse`) before it leaves. There is no path by which
an attacker-controlled file selects the destination or escapes the schema.

> **Reply:** False positive by design — this is a cookbook _importer_: an operator downloads the public-domain
> corpus by hand (ADR-0026: nothing we deploy fetches Gutenberg), `--file` reads it, and the parsed recipes are
> POSTed. "File data reaches an outbound request" is a description of the tool. The corpus path is an operator
> CLI argument, the destination is now allow-listed to localhost/`pr-{N}`/sandbox (`e67e63a3`), and every body
> is validated against the published contract before it leaves — no untrusted file can select the destination
> or escape the schema. Suggest dismissing 325 as "used in tests / by design".

---

### 25. `PRRT_kwDOR7sDRs6XhR4S` — copilot · `packages/infra/global/package.json:34`

`@kitchensink/infra-security` is a devDependency and `npm prune --omit=dev` will remove it before
`cdk deploy`. **Verdict: WRONG — the premise fails; workspace links are not prunable dependencies.**

Well-reasoned, and it was worth checking carefully because the last successful prod deploy (2026-08-02)
**predates** this arrangement (`infra-alb`/`infra-security` became devDependencies on 2026-08-16, `1c2db387`),
so "it has been working" was not available as evidence. Measured three ways instead:

1. `npm ls @kitchensink/infra-security --omit=dev` → resolves:
   `└── @kitchensink/infra-security@0.0.0 -> ./packages/infra/security`
2. `npm ls cdk-nag --omit=dev` → resolves through it: `└─┬ @kitchensink/infra-security … └── cdk-nag@2.38.2`
   (`cdk-nag` is a **production** `dependencies` entry of `infra-security`, so it rides along).
3. `npm prune --omit=dev --dry-run` → removes 267 packages, **zero** of them `@kitchensink/*` or `@commise/*`,
   and `cdk-nag` is not among them.

npm links every workspace named in the root `workspaces` array into the root `node_modules` as part of the
workspace topology; it is not a dependency edge that `--omit=dev` prunes.

The adjacent risk the thread gestures at — that the deploy runs the **compiled** `node …/dist/bin/app.js` —
was already identified and solved deliberately. `packages/infra/security/package.json` carries an explicit
`"//exports"` note: unlike the other shared packages it exports **built JS, not `./src`**, precisely because
prod-deploy runs four CDK entrypoints as compiled JS under plain `node`, and a `main` of `./src/index.ts`
failed with `ERR_MODULE_NOT_FOUND`. That is asserted by `cdkNagSynth.integration.test.ts`, which drives
`node dist/bin/app.js`. (That suite is one of the three that cannot run in an agent worktree because of path
length — environmental, not a gap in the assertion.)

> **Reply:** Checked this carefully — the arrangement post-dates the last successful prod deploy, so "it's been
> working" wasn't available as evidence. The premise turns out not to hold: npm links every workspace named in
> the root `workspaces` array into the root `node_modules` as part of the workspace topology, not as a
> dependency edge that `--omit=dev` prunes. Measured three ways: `npm ls @kitchensink/infra-security --omit=dev`
> resolves it; `npm ls cdk-nag --omit=dev` resolves _through_ it (cdk-nag is a production dep of
> infra-security); and `npm prune --omit=dev --dry-run` removes 267 packages, none of them workspace packages
> and not cdk-nag. The adjacent risk — the deploy running compiled `dist/bin/app.js` — was already handled
> deliberately: `packages/infra/security` exports built JS rather than `./src` for exactly that reason
> (documented in a `"//exports"` note in its manifest, asserted by `cdkNagSynth.integration.test.ts`). No
> change made.

---

### 26. No thread — CodeQL alert 338 · `scripts/assertNoAwsAccountIds.mjs:237` — `js/regex-injection`

**Verdict: FALSE POSITIVE — the value is validated to 12 digits before any `RegExp` is constructed.**

The flagged construction is `new RegExp(`(?<!\\d)${account}(?!\\d)`)`, where `account` comes from
`discovered.accounts`. Both sources are constrained:

- `--accounts` is validated at parse time and the script **exits** on anything else:
  `const malformed = overriddenAccounts.filter((value) => !/^\d{12}$/.test(value)); if (malformed.length > 0) { fail(…) }`
  — `fail()` calls `process.exit(1)`, so no non-12-digit value ever reaches line 237.
- Without `--accounts`, the ids are _derived_ by `accountsIn()`, whose three patterns each capture `(\d{12})`.

A string of exactly twelve digits contains no regex metacharacter, so the constructed pattern is inert. The
input is also a CI operator's own command line, not an attacker channel.

> **Reply:** False positive. The only values reaching `new RegExp` are twelve-digit strings: `--accounts` is
> validated with `/^\d{12}$/` and the script exits via `fail()` on anything else, and the derived path comes
> from `accountsIn()`, whose three patterns each capture `(\d{12})`. Twelve digits contain no metacharacter, so
> the pattern is inert — the validation _is_ the escape. Suggest dismissing 338 as a false positive.

---

### 27. No thread — CodeQL alert 336 · `scripts/deploymentDrift.mjs:526` — `js/indirect-command-line-injection`

**Verdict: FALSE POSITIVE (not injectable), with a noted simplification opportunity.**

The line is:

```js
execFileSync('bash', ['-c', 'cat >> "$1"', '_', summary], { input: `${report}\n` });
```

`summary` is `process.env['GITHUB_STEP_SUMMARY']`. It is passed as a **separate argv element** bound to `$1`
and referenced quoted inside the script text; it is never interpolated into the command string, so no value of
it can add a command. The script text is a constant. `execFileSync` (not `execSync`) means no outer shell
either. The variable is also set by the GitHub runner, not by a PR author.

**Noted, not done:** spawning `bash` to append to a file from Node is unnecessary — `appendFileSync(summary,
…)` is equivalent, simpler, removes a subprocess and a bash dependency, and would close the alert. I left it
alone deliberately: it is a one-line change inside an untested `main()` on a deploy-critical script that I
cannot exercise here, and adding a test seam for a single `appendFileSync` call would be the speculative
abstraction the standards forbid. Worth doing in a change that can run the drift script end-to-end.

> **Reply:** False positive. `summary` is passed as a separate argv element bound to `$1` and referenced
> quoted inside a constant script string — never interpolated into the command — and `execFileSync` spawns no
> outer shell, so no value of it can add a command. It's also set by the runner, not by a PR author. Separately
> (not done here): spawning `bash` to append to a file is unnecessary — `appendFileSync` is equivalent,
> simpler, and would close the alert; I left it for a change that can exercise the drift script end-to-end
> rather than doing an untested drive-by edit on a deploy-critical path.

---

### 28. No thread — CodeQL alerts 283–287 · `packages/tools/loadtest/**` — `js/file-access-to-http`, `js/http-to-file-access`

`auth/provision-users.mjs:50`, `auth/grant-admin.mjs:166`, `observe/collect-metrics.mjs:60` and `:155`,
`run.mjs:96`. **Verdict: FALSE POSITIVE — this is a load-test harness doing its job.**

The flows are: read `admin.json` / pool credentials the harness itself wrote, call Clerk's backend API to mint
or delete test users, and write the resulting metrics series back to disk (`collect-metrics.mjs` uses a
temp-plus-rename atomic write). Both directions — file→HTTP and HTTP→file — are the harness's purpose. All
inputs are files this tooling produced in the same run, all destinations are Clerk's API or a local output
path, and none of it runs in production or touches user data.

> **Reply:** False positives — this is the k6 harness's own plumbing. It reads the credential files it wrote
> itself to provision and tear down Clerk test users, and writes the metrics series it collected back to disk;
> "file data reaches HTTP" and "HTTP data reaches a file" are both descriptions of what a load-test harness
> does. No untrusted input and no production path. Suggest dismissing 283–287 as "used in tests".

---

### 29. No thread — CodeQL alerts 299–304 · `js/malformed-html-id`

`CollectionDetailContainer.test.tsx:202/213/221`, `RecipeDetailContainer.test.tsx:287/299/307`.
**Verdict: FALSE POSITIVE — it is a React component prop, not an HTML `id` attribute.**

The flagged JSX is `<RecipeDetailContainer id="" />` / `<CollectionDetailContainer id="" locale="en" />` —
`id` here is a **component prop** carrying a recipe/collection identifier, and it never reaches a DOM `id`.
The empty string is the _subject_ of the tests: it is how they drive the settled-with-nothing path, which used
to render a permanent spinner and now must report a failure. Each of the six sits in a test that asserts that
behaviour (`expect(getRecipeSpy).not.toHaveBeenCalled()`, `getByRole('alert')`, a "Try again" control, and no
false 404). Changing the value would delete the coverage.

> **Reply:** False positive. `id` here is a React component prop carrying the recipe/collection identifier, not
> an HTML `id` attribute — nothing reaches the DOM. The empty string is the point of these tests: it drives the
> settled-with-nothing path (which used to spin forever and now must report a failure), and each of the six
> lines sits in a test asserting exactly that — no fetch issued, an `alert` role, a retry control, and no false 404. Changing the value would delete the coverage. Suggest dismissing 299–304.

---

### 30. No thread — CodeQL alert 298 · `packages/apps/commise/web/router/src/router.cff.js:18` — unused `handler`

**Verdict: FALSE POSITIVE — CloudFront Functions invokes it by name.**

The function is deliberately unreferenced in-module and already carries both an explanation and a suppression:

```js
// CloudFront Functions 2.0 invokes this top-level `handler` by name; it is intentionally unreferenced in
// the module (locked by the cffShape contract test), so the unused-vars rule is silenced on the next line.
// eslint-disable-next-line no-unused-vars
async function handler(event) {
```

Its existence and shape are pinned by the `cffShape` contract test.

> **Reply:** False positive — CloudFront Functions 2.0 invokes this top-level `handler` **by name**, so it is
> intentionally unreferenced inside the module. That is already documented at the declaration with an
> `eslint-disable-next-line`, and its shape is pinned by the `cffShape` contract test. Suggest dismissing 298.

---

### 31. No thread — CodeQL alerts 264–266, 289–297 — vendored / generated files

`.specify/extensions/v-model/tests/evals/metrics/structural.py:17/28/33` (`py/unused-import`) and
`docs/mockups/screens/*.html:1747` ×9 (`js/unused-local-variable`, `sitesRuntime`).
**Verdict: REJECT — vendored third-party output, note severity, not ours to edit.**

The `.specify/**` tree is a vendored Spec Kit extension; the mockup HTML files are verbatim exports from a
design tool (the flagged `sitesRuntime` is that tool's own bootstrap). Editing either means diverging from
upstream to silence note-level findings. Also relevant: nothing in this repo lints or typechecks Python today
(a known residual recorded in ADR-0025).

> **Reply:** Rejecting these as vendored/generated: `.specify/**` is the vendored Spec Kit extension and
> `docs/mockups/screens/*.html` are verbatim design-tool exports (`sitesRuntime` is that tool's own bootstrap).
> Editing either diverges from upstream to silence note-level findings. Worth excluding both paths from the
> CodeQL config instead, so the tab reflects code we own.

---

### 32. `PRRT_kwDOR7sDRs6fJM1d` — github-advanced-security · `packages/infra/global/__tests__/EdgeStack.test.ts`

`js/incomplete-url-substring-sanitization` (alert 342). **Verdict: ALREADY FIXED earlier today — no action.**

Alerts 340 and 342 both read `fixed` on the security tab, from the earlier pass on this branch. The thread is
stale.

> **Reply:** Already fixed earlier on this branch — alerts 340 and 342 both read `fixed` on the security tab.
> No action needed; the thread is stale.

---

## REAL BUT DEFERRED

### 33. `PRRT_kwDOR7sDRs6bWu1e` — copilot · `packages/tools/eslint/index.js:388` _(outdated)_

The blanket `'**/*.mjs'` ignore excludes every `.mjs` from `eslint .`. **Verdict: REAL — measured, deferred to
its own change. Not fixed here.**

The gap is real and I measured it by temporarily removing the ignore and adding `**/*.mjs` to the
non-typechecked JavaScript override (exactly the suggested fix), then running the real per-workspace lint:

- `packages/infra/global` → **4 errors** (`esbuild.mjs`: `console`/`process` `no-undef`)
- `packages/services/recipe-service` → **13 errors** (`esbuild.mjs`, `tests/load/foodNutritionStub.mjs`,
  `tests/load/prepare-db.mjs`: `console`, `process`, `Buffer`, `URL`, `setTimeout` `no-undef`, plus **one
  genuine `padding-line-between-statements` finding**)

So the suggested fix is **incomplete as written**: almost every finding is `no-undef` for Node globals, because
the JavaScript override clears `project` but declares no globals. Making `.mjs` lintable therefore requires
declaring the Node global set — and hand-listing it is precisely the "a copy of a list cannot detect that the
list is incomplete" anti-pattern this repo has been bitten by. The correct fix adds the `globals` package
(the ESLint org's own, not currently a dependency of `@kitchensink/eslint`, which declares only
`eslint-plugin-check-file`) and uses `globals.node`. Turning `no-undef` off for `.mjs` instead is explicitly
rejected by the config's own k6 comment: _"Turning `no-undef` off for the directory instead would also stop it
catching a genuine typo, which is the only reason to run it."_

**Two further findings the suggestion does not cover:**

1. **`packages/tools/loadtest` — Copilot's own example — has no `lint` script and no `eslint.config.*` at all.**
   Removing the ignore does **not** lint it. Same for the root `scripts/**` tree, which belongs to no workspace,
   so `turbo run lint` never reaches it. That is the larger half of the gap.
2. `staticAnalysisCoverage.test.ts` cannot catch either, because its `SOURCE_PATTERN` is `/\.tsx?$/` — the
   coverage guard is blind to `.mjs` by construction.

**Why deferred rather than fixed:** the complete fix adds a dependency (root lockfile churn) and changes the
**shared** ESLint config that every workspace consumes — a repo-wide blast radius, while five other agents are
working this branch and a broken shared config breaks all of them. It also needs the `loadtest`/`scripts`
half to be worth doing. That is a deliberate call, not an oversight; the probe was reverted and the tree is
clean.

> **Reply:** Real, and I've measured it rather than guessed — but I've deliberately not fixed it in this pass.
> Applying exactly the suggested change (drop the ignore, add `**/*.mjs` to the JS override) yields 4 errors in
> `packages/infra/global` and 13 in `packages/services/recipe-service`, and almost all of them are `no-undef`
> for Node globals (`console`, `process`, `Buffer`, `URL`, `setTimeout`) — because the JS override clears
> `project` but declares no globals. One genuine finding hides in there (a
> `padding-line-between-statements` in recipe-service's `esbuild.mjs`). So the complete fix needs the `globals`
> package added to `@kitchensink/eslint` and `globals.node` applied to `.mjs`; hand-listing the globals is the
> "copy of a list" trap, and switching `no-undef` off is rejected by the config's own k6 comment.
>
> Two things the suggestion doesn't reach, and they're the larger half: `packages/tools/loadtest` — the example
> named in the comment — has **no lint script and no eslint config at all**, so removing the ignore wouldn't
> lint it; and the root `scripts/**` tree belongs to no workspace, so `turbo run lint` never reaches it either.
> `staticAnalysisCoverage.test.ts` can't catch either, since its `SOURCE_PATTERN` is `/\.tsx?$/`.
>
> Deferring because the fix adds a dependency and changes the shared config every workspace consumes, with
> several agents active on this branch — it wants its own change that also covers `loadtest` and `scripts/`.

---

## OWNER DECISION

### 34. `PRRT_kwDOR7sDRs6d_ODc` — copilot · `.specify/feature.json:3`

A shared Spec Kit singleton committed with a local repoint. **Verdict: OWNER — flagged, not reverted.**

The observation is correct and CLAUDE.md warns about this exact file: _".specify/feature.json is a shared
singleton and another session is working 016. Spec Kit resolves features from a numeric branch prefix, which
this repo's single-branch directive defeats — so pass the feature directory explicitly, or re-point
feature.json immediately before each Spec Kit command."_

State: `main` has `specs/003-usda-food-data`; the branch has `specs/018-chef-program-marketplace`, changed by
four commits on this branch (`cb66b9f1`, `074d2e74`, `5cd53969`, `65c6b36b`).

**Not reverted unilaterally**, for a concrete reason: with several sessions active on this single branch, the
value may be live for one of them right now, and CLAUDE.md's own guidance is to re-point it per command rather
than to hold any particular value. Reverting it is a coordination decision, and silently flipping a shared
singleton under a concurrent session is the same class of problem the comment raises.

**Recommendation:** drop the `.specify/feature.json` change from this PR before merge (it is unrelated to the
code-quality scope), and keep the "pass the feature directory explicitly" habit CLAUDE.md already prescribes so
the committed value stops mattering.

> **Reply:** Correct, and CLAUDE.md flags this exact file as a shared singleton. `main` has
> `003-usda-food-data`; the branch carries `018-chef-program-marketplace` from four commits. I've deliberately
> not reverted it — several sessions are active on this single branch and the value may be live for one of them,
> so flipping a shared singleton underneath them is the same problem in the other direction. Recommend dropping
> this file from the PR before merge (it's outside the code-quality scope), and continuing to pass the feature
> directory explicitly per CLAUDE.md so the committed value stops mattering. Owner's call.

---

## Residual risk / notes for the owner

1. **`clerkStageCoherence.ts` still has the terminator defect.** Fixed only in `prodWebSurface.ts` (the twin
   the apps agent owns is untouched by design). Until that one lands, the build-time coherence gate still
   accepts a key clerk-js would refuse. The rule to copy is Clerk's `isValidDecodedPublishableKey`.
2. **`.mjs` lint coverage is still absent**, and `loadtest` + root `scripts/**` are linted by _nothing_ —
   including the fixes I made to `boundariesRatchet.mjs` and `contractOwners.mjs`, which no linter checked
   (they are covered by tests, and Prettier-checked).
3. **No integration tier for the new `writableOrigin` gate.** It is a pure module with 26 unit cases; the CLI
   wiring itself is exercised only by reading. The existing `importCookbook.integration.test.ts` runs against a
   live service and was not run here.
4. **`cdkNagSynth.integration`, `vitestTempRoot`, `serviceDevRunner`** were not run — they fail in agent
   worktrees from path length (environmental, pre-existing, confirmed by the coordinator).
5. **`INT8_EXCLUSIVE_MAX` is a rename.** Any consumer outside `contract-gen` would break at compile time; I
   grepped and found none, and all three services' real-schema audits pass.
6. **The `deploymentDrift.mjs` `bash` shell-out remains** (rejected as not injectable, but it is still an
   unnecessary subprocess — see #27).
