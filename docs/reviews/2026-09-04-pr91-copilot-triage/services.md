# PR #91 — Copilot review triage: the four service packages

Scope: open (`isOutdated == false`) threads under `packages/services/recipe-service/**`,
`packages/services/food-service/**`, `packages/clients/recipe-service/**` and `packages/schemas/recipe/**`.
**19 threads, 12 distinct findings** (four are CodeQL duplicates of two alerts, three are one finding
reported at three call sites, two are the same manifest finding on two packages).

⛔ **Nothing here has been posted to the PR.** The reply text below is a draft for the owner to approve.

Base: `254a906b`. Seven commits, one per thread-or-class:

| Commit     | Class                                                            |
| ---------- | ---------------------------------------------------------------- |
| `3cb451d7` | Production manifests declare every runtime dependency            |
| `3059d464` | `Response` shadowing in the two lockstep suites                  |
| `e14d2b17` | Infinite queries get their own cache key                         |
| `79571061` | Compare-and-set on the resolution write + deduped-row settlement |
| `657015ca` | Per-phrase advisory lock in both correction DALs                 |
| `7d5473d0` | One rolling-window admission per upstream request                |
| `7616ed1f` | Destructive CLIs bind their confirmation to the real database    |

## Summary

| #   | Thread                                           | Path:line                                                                 | Verdict                                     |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | `PRRT_kwDOR7sDRs6bk_Oi`                          | `recipe-service/src/ingredients/dal/ingredients.dal.ts:601`               | **REAL — fixed**                            |
| 2   | `PRRT_kwDOR7sDRs6bcINv`                          | `recipe-service/src/ingredients/ingredients.service.ts:687`               | **REAL — fixed**                            |
| 3   | `PRRT_kwDOR7sDRs6bcIN7`                          | `recipe-service/src/ingredients/resolution/resolutionMappings.dal.ts:306` | **REAL — fixed (+ unreported twin)**        |
| 4   | `PRRT_kwDOR7sDRs6bceIv`                          | `food-service/src/worker/foodConsumer.service.ts:590`                     | **REAL — fixed**                            |
| 5   | `PRRT_kwDOR7sDRs6bceIq`                          | `food-service/src/foods/seed/clearMain.ts:63`                             | **REAL — fixed**                            |
| 6   | `PRRT_kwDOR7sDRs6bceIx`                          | `recipe-service/src/ingredients/unlinkMain.ts:85`                         | **REAL — fixed**                            |
| 7   | `PRRT_kwDOR7sDRs6bcINp`                          | `food-service/src/foods/seed/clearCli.ts:439`                             | **REAL — half fixed, half OWNER**           |
| 8   | `PRRT_kwDOR7sDRs6bk_OP`                          | `clients/recipe-service/src/queries.ts:340`                               | **REAL — fixed**                            |
| 9   | `PRRT_kwDOR7sDRs6a_jnz`                          | `schemas/recipe/prod.package.json:17`                                     | **REAL — fixed (+ 3 more manifests)**       |
| 10  | `PRRT_kwDOR7sDRs6ZjvXh`, `…Xl`, `…Xn`            | both `errorContractLockstep.test.ts`                                      | **Stale premise — code changed anyway**     |
| 11  | `PRRT_kwDOR7sDRs6XhR38`, `…R3_`                  | both service `package.json`                                               | **WRONG — rejected, disproved empirically** |
| 12  | `PRRT_kwDOR7sDRs6ZjvXw`, `…Xy`, `Zjvr7`, `Zjvr8` | `recipe-service/src/config/__tests__/loadConfig.test.ts`                  | **WRONG — rejected (+ one OWNER question)** |
| 13  | `PRRT_kwDOR7sDRs6YbPdW`                          | `clients/recipe-service/src/__tests__/contractSkew.test.ts:256`           | **WRONG — rejected**                        |

---

## 1. `PRRT_kwDOR7sDRs6bk_Oi` — lost update on `updateResolution` — REAL, fixed (`79571061`)

**Evidence.** `updateResolution` was `UPDATE ingredients SET … WHERE id = $1`, unconditional. `refreshStatus`
reads the row, calls the food service, then writes — so two refreshes that both observe `PENDING` race, and
the slower response wins the write regardless of age.

Reproduced against a real Postgres before fixing (and again afterwards by removing the predicate):

```
AssertionError: expected 'PENDING' to be 'RESOLVED'
```

The row regressed, taking the adopted catalog name with it. Nothing downstream could notice: the picker
simply kept polling a row the food service had already resolved.

**Fix.** `food_resolution_status IS NOT DISTINCT FROM :expected`, with `expectedStatus` **required** on
`UpdateResolutionInput`.

- `IS NOT DISTINCT FROM`, not `=`: an unlinked row's status is `NULL` (U12's reset nulls it) and `= NULL`
  matches nothing, so a `=` spelling would make a reset row permanently un-relinkable. Pinned by a test.
- **Required, not defaulted** — a default is an assumption about a row the caller may never have read.
  Making it required turned all four call sites into compile errors, which is how each came to state the
  status it actually observed.
- Zero rows is not an error: the loser re-reads and returns the row that stands, so the stale caller is
  handed `RESOLVED` rather than its own stale view.
- The predicate guards the whole `SET` list — a mismatch must not land the name, the prior or the privacy
  fact either. All five columns are pinned in `updateResolutionCas.integration.test.ts`.
- The intentional terminal→`PENDING` reactivation still lands, asserted in both tiers.

**Draft reply.**

> Real, and reproduced: two refreshes both read `PENDING`, the newer `RESOLVED` committed, then the delayed
> older response regressed the row — with the adopted catalog name — and nothing downstream could tell. Fixed
> in `79571061` with a compare-and-set on the status the caller observed. Two details worth naming: the
> predicate is `IS NOT DISTINCT FROM`, not `=`, because an unlinked row's status is `NULL` after U12's reset
> and `= NULL` would make such a row permanently un-relinkable; and `expectedStatus` is **required** rather
> than defaulted, so all four call sites became compile errors and each now states the status it really saw.
> A lost race returns the winner's row rather than an error. The terminal→`PENDING` reactivation you flagged
> as intentional is preserved and pinned in both tiers.

---

## 2. `PRRT_kwDOR7sDRs6bcINv` — `addByName` existing-row branch — REAL, fixed (`79571061`)

**Evidence.** The dedup branch was `if (existing) return existing;` — discarding a status the add response
already carried. For one case nothing else would ever repair it: a `FAILED` row re-added by name is
_reactivated_ by `FoodsService.addByName` (which then answers `PENDING`), but `refreshStatus` is only reached
by a client polling a **non-terminal** row, and the importer's settle pass re-reads only
`PENDING`/`UNRESOLVED`. So the row stayed `FAILED` permanently while the food behind it resolved.

**Fix.** A `settleExisting` step that advances the row to the observed status and, on `RESOLVED`, spends the
same one extra read the fresh-add branch spends to name the row from the catalog instead of the caller's
prose (plan U3). An equality short-circuit keeps the common repeat-add free — no read, no write.

It deliberately does **not** delegate to `addByFoodId`: that path rejects a nameless food, which is right for
a _pick_ and wrong here, where the caller supplied a perfectly good name of their own.

**Draft reply.**

> Real. Fixed in `79571061`. The case that has no other repair path is a `FAILED` row that food-service
> _reactivated_ on the re-add: `refreshStatus` only polls non-terminal rows and the importer's settle pass
> re-reads only `PENDING`/`UNRESOLVED`, so it stayed `FAILED` forever. The branch now runs the same settlement
> `addByFoodId` performs, including the read that adopts the catalog name over caller prose. It does not
> delegate to `addByFoodId` itself, because that path rejects a nameless food — correct for a pick, wrong for
> a caller who supplied their own name.

---

## 3. `PRRT_kwDOR7sDRs6bcIN7` — the row lock cannot lock a row that does not exist — REAL, fixed (`657015ca`)

**Evidence.** Your reading is exactly right, and ADR-0027 does **not** already cover it. The partial unique
index is `(normalized_key, user_id)` — per user — so two _different_ first-time correctors do not conflict on
it at all. Both find no live rows (so both `FOR UPDATE` locks are no-ops), both insert an author row, and
neither promotes. Both DALs' docstrings named this case and concluded `ON CONFLICT DO NOTHING` handled it;
that clause saves the **writes**, not the corroboration.

Reproduced with a forced interleaving, and re-proved after the fix by disabling the lock:

```
× serialises them so the second sees the first and PROMOTES — the corroboration is never lost
AssertionError: expected true to be false
```

(the second corrector read its facts without waiting, and no corroboration binding was written).

**Fix.** `pg_advisory_xact_lock(hashtext(key))` as the **first** statement of `findWriteFacts` — the house
form `CollectionsDal.createIfUnderCap` and `PhotosDal.create` already use for their own count-then-insert
TOCTOU. It exists whether or not any row does, and releases at transaction end.

Two things worth stating:

- **The `FOR UPDATE` stays.** It is not redundant: `supersedeOwnMapping` / `supersedeOwnCorrection` are public
  statements a caller can reach without coming through `findWriteFacts`, and the row lock is what makes _that_
  writer wait. The advisory lock covers the empty set; the row lock covers the writers that bypass it.
- **Applied to the twin too.** `ParseCorrectionsDal` carried the identical gap and the identical incorrect
  note. The bot found one instance; both are fixed.

A cross-key `hashtext` collision only serialises two unrelated corrections — contention, never a correctness
problem, the same trade the two existing call sites accept.

**Draft reply.**

> Real, and the ADR-0027 index does not cover it: that partial unique index is `(normalized_key, user_id)`,
> i.e. per user, so two _different_ first-time correctors never conflict on it. Both see no rows, both `FOR
UPDATE` locks are no-ops, both insert, neither promotes — and `ON CONFLICT DO NOTHING` saves the writes but
> not the corroboration. Fixed in `657015ca` with a per-phrase `pg_advisory_xact_lock` as the first statement,
> the same house form `CollectionsDal.createIfUnderCap` and `PhotosDal.create` use. The `FOR UPDATE` stays
> deliberately — `supersedeOwnMapping` is reachable without going through `findWriteFacts`, so the row lock
> still has a job. Applied to `ParseCorrectionsDal` as well, which had the identical gap.

---

## 4. `PRRT_kwDOR7sDRs6bceIv` — the limiter counted fan-outs, not requests — REAL, fixed (`7d5473d0`)

**Evidence.** One `tryRecord` covered the `searchByName` request, every `fetchByKeys` chunk, **and** up to
twenty per-key recoveries when a chunk failed validation. At the 900 pause threshold the ledger could report
900 while roughly 1,800 requests had gone to USDA — so what actually held the line was the `429` failsafe, not
the limiter. That breaches SC-002's "≤1,000 in ANY rolling 60-minute window", which FR-019 calls a hard
guarantee.

The old assertion read T-155 as "the whole fan-out is ONE windowed call". The spec does not say that:

- **FR-018** counts "before every source API call".
- **FR-023**'s "≤20 keys counts as exactly 1 call" is batch-_versus-twenty_, not search-_plus_-batch.
- **SC-014** itself calls the name search "~1 non-batchable source call per NEW food", with batching
  accelerating "only the fetch-by-key leg".
- The USDA adapter's three methods are each exactly one HTTP request, and `refreshResolvedFood` and
  `FoodsService.resolve` have always charged one apiece for the very same `fetchByKey`.

Re-proved after the fix by collapsing the admissions again: the ledger reported **1** where **5** requests had
been made, and both window-full cases resolved instead of deferring.

**Fix.** One admission per upstream request. A denial mid-fan-out returns `window-full` — a value, not a
throw, since it is an ordinary outcome of asking permission — which defers the row exactly as a denial before
the search does: no `attempts++`, nothing persisted, and **no** source-wide pause, because a self-denial is
not the source telling us to stop. Candidates collected so far are **discarded** rather than merged: a partial
candidate set is what the merge engine's survivor count reads as a confident single answer, so persisting it
would resolve a food from whichever sources happened to fit inside the window.

The integration assertion is now the **equality** that catches drift in either direction — ledger rows ==
requests the fake adapter received — plus three new cases (per-chunk at 21 hits, the per-key recovery path,
and a window that fills between search and fetch).

⚠️ **Accepted consequence, for the owner to note:** a NEW food now costs two admissions instead of one, so
first-time resolution throughput per window roughly halves — about 450 new foods/hour against SC-014's stated
"~500–900". The old figure was only reachable by under-counting the calls it was made of.

**Draft reply.**

> Real, and worse than the deferred-job framing suggests: the single admission also covered every batch chunk,
> so at the 900 pause threshold the ledger could read 900 while ~1,800 requests had gone upstream — the `429`
> failsafe was holding the line, not the limiter. Fixed in `7d5473d0`: one admission per request. On your
> suggestion of a deferred job — a denial mid-fan-out now defers the whole row through the existing
> back-pressure path (no `attempts++`, nothing persisted, no source-wide pause) and discards the partial
> candidate set, because the merge engine's survivor count would read a partial set as a confident answer.
> Note the trade: a NEW food now costs two admissions, so throughput per window roughly halves to ~450/hour
> against SC-014's "~500–900" — that figure was only reachable by under-counting.

---

## 5–7. The destructive CLIs — `PRRT_kwDOR7sDRs6bceIq`, `…bceIx`, `…bcINp` — REAL, fixed (`7616ed1f`)

**Evidence.** Confirmed exactly as reported. `--stage` and `--confirm` are **both** the operator's own words,
checked only against each other. All three commands _did_ read the real target and print it — and their own
docstrings called that "the honest limit of the guard, made visible". A printed target is a courtesy an
operator can read past; nothing consumed it, so it was not a guard.

**Fix.** Three mechanisms, in this order, run inside the command before a single row is read:

1. **The stage and the database must be able to be true together.** A `pr-{N}` stage belongs on a
   `{base}_pr_{N}` database and a named stage does not belong on a per-PR one (ADR-0006). No typing required,
   so it guards a **dry run** too — an impossible pairing is wrong before it is harmless, exactly as a
   misplaced `--allow-prod` is. Checked first, so an impossible pairing is never reported as a typo.
2. **A writing run must name the target the server reported** — a new
   `--confirm-target <database@host:port>`, built from `current_database()`, `host(inet_server_addr())` and
   `inet_server_port()`. This is the half that catches prod-versus-sandbox, which mechanism 1 structurally
   **cannot**: both stages use the same logical database name, so only the host separates them and only the
   operator can say which they meant. A dry run is never asked to type it — making a look harder than a delete
   is how operators learn to skip the look — and a dry run now **reports** the token, closing the loop: the
   look tells you what to type, so the typed value describes the thing rather than the belief.

    ⚠️ Two things about the host field, one load-bearing and one a limitation. The load-bearing one: it is
    discriminating _because of_ ADR-0002's per-stage VPC CIDRs — a prod RDS answers from `10.0.x.x` and a
    sandbox one from `10.1.x.x`, so the two can never coincide. If those CIDRs are ever collapsed, this guard
    weakens and should be revisited. The limitation: `inet_server_addr()` is a private IP, so an RDS failover
    between the dry run and the destructive run invalidates the token. That fails **closed** — the run is
    refused and the operator re-runs the dry run, which the refusal message tells them to do.

3. **`probe-off-server`** (clear only): the recipe-linkage probe must reach the same server as the catalog.
   The two URLs are supplied separately, so mixing them is what this two-service task is most exposed to — and
   "zero links remain" answered from another stage reads as permission to delete this one's whole catalog.

Also applied to the **reseed**, which the bot did not flag and which carries the identical hazard: it mints
fresh ULIDs, so aiming it at the wrong stage silently orphans every `ingredients.food_id` on that stage.

**Verified against a throwaway `postgres:18`, running the reported attack itself:**

```
$ STAGE=prod DATABASE_URL=…/recipes_svc_it npx tsx src/ingredients/unlinkMain.ts \
      --stage prod --allow-prod --confirm prod
error: Refusing to unlink ingredients on stage "prod" — no --confirm-target was given. … The connection
       actually reached recipes_svc_it@172.17.0.4:5432.
```

A wrong `--confirm-target` is refused; `--dry-run` prints `"target":"recipes_svc_it@172.17.0.4:5432"`; that
token is accepted; `--stage pr-7` against a non-per-PR database is refused with nothing typed.

The descriptor now has **one** reader (`describeDatabaseTarget(pool)`) and the ports take the pool alongside
their client — the target is a property of the connection, and a second reader would be a second answer to
"where am I?", free to disagree with the one the guard judged.

### ⚠️ 7 — the half that is NOT fixed, and is an OWNER decision

`PRRT_kwDOR7sDRs6bcINp` makes **two** claims. The wrong-target half is fixed above. The other half — a
concurrent recipe write creating a link _after_ the probe reports zero and _before_ the delete — **is real and
remains open.** It is a genuine cross-database TOCTOU that no lock available to this process can close: there
is no shared transaction, no foreign key, and the recipe service has no read-only/maintenance mode to switch
into.

What it would take, and why each is an owner call rather than a code change:

- **A maintenance gate** — the recipe service refusing ingredient writes for the duration. That is a new
  operational mode and a product decision (a user-visible outage window), not a CLI fix.
- **A generation/epoch protocol** — the catalog carries a generation the recipe side validates against. Real
  design work, and it touches a cross-service contract (ADR-0014 territory).
- **Accept it and say so in the runbook** — defensible: U12 is already a planned, coordinated maintenance
  operation, and the window is seconds between two commands an operator runs back to back.

⛔ It should **not** be recorded as "handled": ADR/plan U10's "`food_id` MAY DANGLE" note is about
`ingredient_resolution_mappings.food_id`, **not** `ingredients.food_id`, whose whole reason for the
unlink→clear→reseed ordering is that it must _not_ dangle. Recommendation: accept + runbook line now, with the
generation protocol recorded as the fix if this task ever runs against a live-traffic stage.

**Draft reply (5, 6, and the first half of 7).**

> Confirmed, and the docstrings admitted it — they called the printed target "the honest limit of the guard,
> made visible". Nothing consumed it, so it was not a guard. Fixed in `7616ed1f`: a new `--confirm-target
<database@host:port>` that a writing run must match against `current_database()` /
> `host(inet_server_addr())` / `inet_server_port()`, plus a stage↔database rule (a `pr-{N}` stage must land on
> a `_pr_{N}` database and a named stage must not) that needs no typing and therefore guards a dry run too,
> plus `probe-off-server` for the clear, since the recipe and food URLs are supplied separately. A dry run now
> _reports_ the token, which closes the loop. Verified against a throwaway `postgres:18` by running your exact
> case: `--stage prod --allow-prod --confirm prod` against a non-prod database is refused and the message
> names the database it really reached. The reseed got the same treatment — same hazard, unflagged.

**Draft reply (second half of 7).**

> The cross-database TOCTOU is separate and I have **not** closed it — no lock available to this process can,
> since there is no shared transaction, no FK, and no read-only mode on the recipe service. The three real
> options are a maintenance gate (a user-visible outage window — a product decision), a generation/epoch
> protocol (a cross-service contract change), or accepting it with a runbook line, which is defensible because
> U12 is already a coordinated operation and the window is seconds. Flagging for a decision rather than
> picking one. Worth noting it must not be waved through on U10's "`food_id` may dangle" note: that is about
> `ingredient_resolution_mappings.food_id`, not `ingredients.food_id`, whose non-dangling is the entire reason
> for the unlink→clear→reseed ordering.

---

## 8. `PRRT_kwDOR7sDRs6bk_OP` — flat and infinite queries sharing a key — REAL, fixed (`e14d2b17`)

**Evidence.** The shared key was _documented_ as deliberate: "each pair shares ONE query key … TanStack
distinguishes their internal page shape by which hook subscribes to them". That claim is false. The cache
holds one `data` per key; an infinite observer stores `{ pages, pageParams }` and a flat observer stores the
bare page body, so whichever populates the key first decides what the other is handed.

Reproduced against a real `QueryClient` in `queryKeyShapes.test.ts`: a flat search cached first, then the
infinite read returns data with **no `pages`** — and issues no fetch, because the key was fresh.

Corroborating evidence that this was already biting: both SSR pages carry a warning that a flat prefetch
"would dehydrate a bare page body under a key the infinite observer expects `{ pages, pageParams }` for" — the
hazard was being dodged by discipline at each call site. The key factory's own `ingredientSuggest` states the
rule this restores: "the two return different shapes, so one cache key serving both would be a type error
waiting to happen".

**Fix.** Each infinite variant keys under an `'infinite'` segment placed **before** the params, so it stays
inside the `recipeLists` / `recipeSearches` / `collections` prefix every broad invalidation addresses — a
different _shape_ of the same region, not a different region. Asserted directly, since that is exactly your
"keeping it under the existing search prefix so broad invalidation still works".

Four existing "SAME key" assertions were **rewritten** to prove the new contract (not deleted), with the
argument in their comments.

**Draft reply.**

> Right, and it was documented as deliberate on a false premise — the factory claimed TanStack "distinguishes
> their internal page shape by which hook subscribes". It does not. `queryKeyShapes.test.ts` now reproduces it
> against a real `QueryClient`: a flat search cached first, then the infinite read returns data with no
> `pages` and never fetches. Both SSR pages already carried warnings about this, i.e. the hazard was being
> dodged by discipline at every call site. Fixed in `e14d2b17` exactly as you suggested — an `'infinite'`
> segment _before_ the params, so the entry stays under the `recipeLists`/`recipeSearches`/`collections`
> prefix and broad invalidation still reaches both shapes (asserted).

---

## 9. `PRRT_kwDOR7sDRs6a_jnz` — `schema-recipe`'s production manifest — REAL, fixed (`3cb451d7`)

**Evidence.** Confirmed: the sources import `@kitchensink/recipe-core` and `@kitchensink/schema-food` at
runtime while the manifest declared only `zod`, and `recipe-service/Dockerfile:48` copies that manifest into
the image.

One correction to the thread's reasoning, which does not change the verdict: the manifest is **not** what
installs anything — the image copies the repo-root `node_modules` and never runs `npm install`. It is a
_declaration_, read by humans and audits. That is precisely why it drifts unnoticed; nothing fails. Both the
generator and the guard say so in their docstrings.

**The finding generalises, which is the more useful part.** `prodManifestParity.test.ts`'s repo-wide check
compared only _shared_ dependencies' version ranges; a dependency simply **absent** passed in silence — the
older of the two drifts that file's own docstring opens with. Widening it to the same three-way rule the
per-service test already applied turned up **18 omissions across four manifests**:

| Manifest                    | Omitted                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `schemas/recipe`            | `@kitchensink/recipe-core`, `@kitchensink/schema-food`           |
| `services/recipe-workers`   | 14, incl. `pg`, `drizzle-orm`, `zod`, `@kitchensink/recipe-core` |
| `shared/identity-db`        | `@kitchensink/identity-core` (copied by `identity/Dockerfile`)   |
| `shared/recipe-import-core` | `zod`                                                            |

**Draft reply.**

> Confirmed and fixed in `3cb451d7`. One correction that does not change the verdict: this manifest is not
> what installs anything — the image copies the repo-root `node_modules` and never runs `npm install` — it is
> a _declaration_, which is exactly why it drifts unnoticed. The more useful half is that the finding
> generalises: the repo-wide half of `prodManifestParity.test.ts` only compared shared dependencies' ranges,
> so an _absent_ one passed silently. Widening it to the same three-way rule the per-service test already used
> found 18 omissions across four manifests (`recipe-workers` omitted fourteen, including `pg` and
> `drizzle-orm`; `shared/identity-db` omitted `@kitchensink/identity-core`, which `identity/Dockerfile` also
> copies). All four are now correct and the guard fails on the next omission.

---

## 10. `PRRT_kwDOR7sDRs6ZjvXh`, `…Xl`, `…Xn` — "Invocation of non-function" — stale premise, code changed (`3059d464`)

**Evidence.** The alert is wrong as stated: nothing is `undefined` and all three call sites execute correctly
(both suites passed before and after, 14 and 21 cases). What CodeQL was reading is a genuine **shadowing**:
both files did `import type { Request, Response } from 'express'` for the filter's response double, then
called `new Response(...)` further down meaning the global Fetch class. That compiles — a type-only import is
erased, so the value position resolves to the global — but one identifier naming two different things in one
file is a real reader hazard.

**Disposition:** the finding as written is rejected; the code was changed anyway, because the confusion is
legitimate. The express types are now `ExpressRequest` / `ExpressResponse`. No behaviour changed.

**Draft reply.**

> The alert as stated is a false positive — nothing is `undefined` and every call site executes (both suites
> pass, 14 and 21 cases). But it was reading something real: the files import `type { Request, Response }` from
> express for the filter's response double, then call `new Response(...)` meaning the global Fetch class. That
> compiles, since a type-only import is erased — but one identifier naming two things in one file is a genuine
> reader hazard. Renamed to `ExpressRequest`/`ExpressResponse` in `3059d464`; no behaviour change.

---

## 11. `PRRT_kwDOR7sDRs6XhR38`, `…R3_` — `@kitchensink/infra-security` in devDependencies — REJECTED

**The premise is false: `npm prune --omit=dev` does not remove workspace packages.**

Measured in this tree:

```
$ npm prune --omit=dev --dry-run
267 packages would be removed
$ grep '^remove @kitchensink' …          → (no matches)
$ grep -E '^remove (cdk-nag|aws-cdk-lib|constructs) ' … → (no matches)
```

Zero `@kitchensink/*` workspace packages, and `cdk-nag` (infra-security's own runtime dependency) also
survives. The symlink `node_modules/@kitchensink/infra-security -> ../../packages/infra/security` is placed by
the workspace machinery, not by dependency resolution, so `prune` leaves it.

**Corroborating evidence.** `packages/services/identity/package.json` has the **identical** shape —
`@kitchensink/infra-security` and `@kitchensink/infra-alb` in `devDependencies` — and `prod-deploy.yml` runs
`npm prune --omit=dev` and _then_ `cdk deploy --app "node packages/services/identity/infra/dist/bin/app.js"`.
That is the exact sequence the thread predicts will fail with `ERR_MODULE_NOT_FOUND`; it is what ships today.

Also worth noting: the real hazard in this area is the _opposite_ one, and CI already handles it —
`infra-security` exports **built** `dist` (ADR-0013), so what must happen before a `cdk deploy` is a **build**,
not a dependency move. `sandbox-deploy.yml` and `prod-deploy.yml` both have explicit steps for it, one of
which calls itself "the step that was missed".

**Draft reply.**

> Rejecting this one — the premise does not hold. `npm prune --omit=dev` does not remove workspace packages:
> run in this tree it removes 267 packages and **zero** `@kitchensink/*` ones (`cdk-nag`, infra-security's own
> runtime dep, also survives). The `node_modules/@kitchensink/infra-security` symlink is placed by the
> workspace machinery, not by dependency resolution. Corroboration: `packages/services/identity` has the
> identical shape and `prod-deploy.yml` prunes and _then_ runs `cdk deploy --app "node
…/identity/infra/dist/bin/app.js"` — the exact sequence predicted to fail is what ships today. The real
> hazard nearby is the opposite one: `infra-security` exports built `dist` (ADR-0013), so it must be **built**
> before a `cdk deploy`, and both workflows already have that step.

---

## 12. `PRRT_kwDOR7sDRs6ZjvXw`, `…Xy`, `Zjvr7`, `Zjvr8` — "Missing await" in `loadConfig.test.ts` — REJECTED

**Evidence.** `loadConfig` is overloaded:

```ts
export function loadConfig<S>(schema: S, options: LoadConfigOptions): Promise<z.infer<S>>;
export function loadConfig<S>(schema: S, env?: Record<string, unknown>): z.infer<S>;
```

Both flagged lines pass a plain env record, so the **synchronous** overload applies (`isLoadConfigOptions`
returns false and the implementation returns `parseOrThrow(...)` directly). CodeQL cannot resolve the overload
and assumes the promise-returning one.

The tests prove it at runtime — a `Promise` would fail them:

- line 55's test asserts `expect(config.DATABASE_POOL_SIZE).toBe(50)` and the `DATABASE_URL` value;
- the whole file is green (16/16).

**⚠️ One thing here IS worth an owner decision, and it is what made the alert plausible.** The dual overload —
sync or async depending on the _shape_ of the second argument — is what confuses both CodeQL and readers. And
the async/SSM arm has **no production consumer anywhere**: `ssmFallback`, `LoadConfigOptions` and
`@aws-sdk/client-ssm` appear only in `loadConfig.ts`, `config.types.ts`, `index.ts` and this test file. The
only live caller is `config.module.ts`, which uses the sync form.

That is a designed seam, so removing it is the owner's call, not a review fix. Recommendation: either delete
the async arm (the union return type goes with it, and the alert stops recurring) or record why it is kept.

**Draft reply.**

> Rejecting: `loadConfig` is overloaded, and both flagged lines pass a plain env record, so the **synchronous**
> overload applies — CodeQL cannot resolve the overload and assumes the promise-returning one. The tests prove
> it at runtime: line 55's case asserts `DATABASE_POOL_SIZE === 50` and the `DATABASE_URL` value, which a
> `Promise` would fail, and the file is green 16/16.
>
> One genuine observation underneath it, though — the sync-or-async-by-argument-shape overload is what makes
> the alert plausible, and the async/SSM arm currently has **no production consumer**: `ssmFallback` /
> `LoadConfigOptions` / `@aws-sdk/client-ssm` appear only in the config module's own files and this test, while
> the one live caller (`config.module.ts`) uses the sync form. Worth an explicit decision — delete the async
> arm (and the union return type with it) or record why it is kept. Flagging rather than doing it, since it is
> a designed seam.

---

## 13. `PRRT_kwDOR7sDRs6YbPdW` — "Use of returnless function" in `contractSkew.test.ts:256` — REJECTED

**Evidence.** The flagged line is:

```ts
expect(reportContractSkewOnce({ baseUrl: BASE, fetch: fetchImpl, warn })).toBeUndefined();
```

inside a test named _"is synchronous and returns nothing, so no caller can accidentally await it on a hot
path"_. The "use of the return value" **is the assertion that there is no return value** — it is the test for
the property, not a bug. `reportContractSkewOnce` returns `void` by design, and the function's docstring calls
that out: "Synchronous and returns `void` BY DESIGN: there is no promise a caller could accidentally `await`".

Acting on this alert would delete the only check that the void contract holds. Rewriting it to launder the
alert (assigning to an intermediate) would still "use" the value and would obscure what is being asserted.

Left as-is. If the owner wants the alert closed rather than dispositioned, the correct instrument is a CodeQL
suppression on that line, not a code change — and that is a call for the owner.

**Draft reply.**

> Rejecting. That line is inside the test _"is synchronous and returns nothing, so no caller can accidentally
> await it on a hot path"_ — the "use of the return value" **is** the assertion that there is no return value.
> `reportContractSkewOnce` returns `void` deliberately (its docstring: "there is no promise a caller could
> accidentally `await`"), and acting on the alert would delete the only check that the contract holds.
> Laundering it through an intermediate variable would still count as a use and would obscure the assertion.
> If you would rather the alert were closed than dispositioned, the right instrument is a CodeQL suppression
> on that line — happy to add one on request.

---

## Verification

Every tier that could run locally, run at `7616ed1f`:

| Tier                                                                | Result                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `recipe-service` unit                                               | **2376 / 2376**                                                                 |
| `recipe-service` integration (throwaway `postgres:18` + LocalStack) | **590 / 595** — 5 environmental, below                                          |
| `food-service` unit                                                 | **1250 / 1250**                                                                 |
| `food-service` integration                                          | **556 / 557** — 1 environmental, below                                          |
| `clients/recipe-service` unit                                       | **484 / 484**                                                                   |
| `@commise/web` — `dataPagePrefetch`                                 | **12 / 12**                                                                     |
| `infra/global` — `prodManifestParity`                               | **20 / 20**                                                                     |
| Typecheck                                                           | clean: both services, the client                                                |
| Lint / Prettier                                                     | clean on every touched file                                                     |
| Destructive CLIs                                                    | exercised only against a throwaway `postgres:18` on port 55440, non-prod stages |

**Red runs recorded** (each fix was proved to fail without it — and, where the test was written before the
fix, re-proved afterwards by reverting the mechanism):

| Fix                    | Red evidence                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Manifest guard         | 18 omissions across four manifests                                                                         |
| Query keys             | 3 factory cases ("expected 2 calls, got 1") + the live cache collision                                     |
| Compare-and-set        | `expected 'PENDING' to be 'RESOLVED'` — the regression itself — + both "writes NOTHING" cases              |
| `addByName` settlement | 2 unit cases on the un-settled row                                                                         |
| Advisory lock          | both twins: `expected true to be false`, no corroboration binding written                                  |
| Limiter accounting     | ledger reported **1** where **5** requests were made; both window-full cases resolved instead of deferring |
| CLI target binding     | the live CLI, running the reported attack, refused with the real target named                              |

### Environmental failures — not caused by these changes

- `deployedSmoke.integration.test.ts` (5) — `listen EINVAL … .pipe`: the agent-worktree path-length class the
  task named alongside `vitestTempRoot` / `serviceDevRunner` / `cdkNagSynth.integration`.
- `messageSubstrate.integration.test.ts` (1) — `ResourceNotFoundException` from DynamoDB; the local LocalStack
  was started without that service. Touches nothing in this diff.
- Several suites needed unbuilt workspace `dist` directories first (`@commise/ui`, `infra-alb`,
  `infra-security`, `infra-messaging`, `recipe-workers`). Built locally; all then passed. Not a code defect —
  and note it is the same "exports `dist`" property that finding 11 gets backwards.

## Unsettled — for the owner

1. **The cross-database TOCTOU in the catalog clear** (finding 7, second half). Real, open, three options
   listed above. My recommendation: accept + runbook line now, generation protocol recorded as the fix if this
   ever runs against a live-traffic stage.
2. **SC-014's throughput figure** (finding 4). Correcting the accounting roughly halves first-time resolution
   throughput per window (~450/hour vs the stated "~500–900"). The spec number was only reachable by
   under-counting; it should be restated rather than left to look like a regression.
3. **`loadConfig`'s unused async/SSM arm** (finding 12). No production consumer; the resulting union return
   type is what makes the CodeQL alert recur. Delete or document.
4. **Whether to suppress the two standing CodeQL alerts** (findings 12 and 13) rather than leave them
   dispositioned here.
