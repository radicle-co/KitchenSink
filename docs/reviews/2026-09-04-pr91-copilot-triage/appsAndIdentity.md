# PR #91 Copilot review triage — apps and identity

Threads under `packages/apps/commise/**`, `packages/services/identity/**` and
`packages/services/identity-webhooks/**` that were open and not outdated on 2026-09-04. Twelve threads.
Nothing here has been posted to the PR; the reply text is a proposal for the owner to approve, edit or drop.

Verdict key: **real** (defect confirmed, fixed on this branch), **wrong** (claim disproved, with the evidence),
**owner** (a decision rather than a defect).

## Disposition table

| #   | Thread                  | Path:line                                                              | Verdict | Fix commit (subject)                                                                                  |
| --- | ----------------------- | ---------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `PRRT_kwDOR7sDRs6bCVV_` | `services/identity/src/auth/decorators/index.ts:2`                     | real    | `fix(identity): delete the dead extensionless decorators barrel and guard emitted esm specifiers`     |
| 2   | `PRRT_kwDOR7sDRs6ewkJ7` | `services/identity/src/types/account.ts:10`                            | real    | `fix(identity): import AccountTier once, then re-export it`                                           |
| 3   | `PRRT_kwDOR7sDRs6bZHFH` | `apps/commise/mobile/tsconfig.json:14`                                 | real    | `fix(mobile): point the schema-identity path alias at packages/schemas, and guard every paths target` |
| 4   | `PRRT_kwDOR7sDRs6a_jn9` | `services/identity-webhooks/src/handlers/deletionWorker.ts:171`        | real    | `fix(identity-webhooks): an erasure without a userId is rejected, never acknowledged`                 |
| 5   | `PRRT_kwDOR7sDRs6XbjNG` | `apps/commise/web/src/middleware.ts:33`                                | real    | `fix(web): the /_vercel pass-through matches the platform namespace, not its prefix`                  |
| 6   | `PRRT_kwDOR7sDRs6bWu1B` | `apps/commise/web/src/lib/unauthorizedRedirect.ts:42`                  | real    | `fix(web): the 401 breaker remembers every path it bounced from, not the last one`                    |
| 7   | `PRRT_kwDOR7sDRs6bZ1Ac` | `apps/commise/web/src/config/clerkStageCoherence.ts:67`                | real    | `fix(web): a publishable key must carry its terminator and decode to a hostname`                      |
| 8   | `PRRT_kwDOR7sDRs6bAt7E` | `apps/commise/web/scripts/previewDomainScope.ts:167`                   | real    | `fix(web): the preview-host guard asserts the zone, not only the first label`                         |
| 9   | `PRRT_kwDOR7sDRs6Ywx4m` | `apps/commise/features/account/src/__tests__/contractSkew.test.ts:253` | real    | `test(features-account): assert the skew reporter's void return at the type level`                    |
| 10  | `PRRT_kwDOR7sDRs6XhR4H` | `services/identity/package.json:68`                                    | wrong   | —                                                                                                     |
| 11  | `PRRT_kwDOR7sDRs6XhR4J` | `services/identity-webhooks/package.json:24`                           | wrong   | —                                                                                                     |
| 12  | `PRRT_kwDOR7sDRs6XhR4N` | `apps/commise/web/package.json:62`                                     | wrong   | —                                                                                                     |

---

## 1. `PRRT_kwDOR7sDRs6bCVV_` — identity `auth/decorators/index.ts:2` — **real**

**Claim.** Extensionless specifier in an ESM/NodeNext package, emitted as-is; Node cannot resolve it.

**Evidence.** The package is `"type": "module"`; `nest build` compiles under `module: preserve` /
`moduleResolution: Bundler`, which emits `'./currentUser.decorator'` verbatim, and Node's ESM loader has no
extension search. It was latent only because nothing imported the barrel (`grep` for every `decorators`
specifier across `src/` and `tests/`: zero importers). Copilot's premise "NodeNext" is slightly off — the
package is deliberately Bundler for `nest build` — and that is precisely why TypeScript did not catch it
(TS2835 fires only under NodeNext).

**Fix.** The barrel is dead code, so it is deleted rather than repaired. Guard added:
`packages/infra/global/__tests__/emittedEsmSpecifierExtensions.test.ts` — for every `type: module` workspace
whose build project emits, every relative specifier in the files TypeScript's own config parser says it
compiles must end in `.js`/`.mjs`/`.cjs`/`.jsx`/`.json`. Specifiers come from TypeScript's parser. Red on the
barrel, green after; field measurement found zero other violations across every emitting workspace.
ESLint's `import-x/extensions` was tried first and cannot express this rule (with the shared resolver's
`.js → .ts` alias it reports every correct `./x.js` as `Missing file extension "ts"` — 8 false errors on
identity alone).

**Reply.**

> Real, and latent: nothing imported this barrel, so it never ran. The package is deliberately
> `moduleResolution: Bundler` for `nest build` (not NodeNext), which is exactly why `tsc` did not flag it.
> Deleted the dead barrel rather than fixing it, and added a repo-wide guard
> (`packages/infra/global/__tests__/emittedEsmSpecifierExtensions.test.ts`) that scans the emitted file set
> of every `type: module` workspace with TypeScript's parser and fails on any relative specifier without a
> loadable extension — the check TypeScript only performs under NodeNext. Zero other violations across the
> tree.

## 2. `PRRT_kwDOR7sDRs6ewkJ7` — identity `types/account.ts:10` — **real**

**Evidence.** Lines 7 and 9: `export type { AccountTier } from …` followed by `import type { AccountTier } from …`
— a duplicate binding and an import after a non-import statement. No lint rule caught it (`import-x/first`
is not enabled).

**Fix.** One `import type` at the top, `export type { AccountTier };` where the re-export was.

**Reply.**

> Done — imported once at the top and re-exported with `export type { AccountTier }`.

## 3. `PRRT_kwDOR7sDRs6bZHFH` — mobile `tsconfig.json:14` — **real**

**Evidence.** `paths` targets resolve relative to the tsconfig's directory; `../../schemas/…` from
`packages/apps/commise/mobile` is `packages/apps/schemas/…`, which does not exist (`ls` confirms). `tsc` stays
green because a dead `paths` entry is not an error — TypeScript falls through to `node_modules` resolution and
finds the hoisted workspace link. The vitest alias beside it was already corrected for the identical
off-by-one, with a comment explaining the trap; the tsconfig copy was missed.

**Fix.** `../../../schemas/identity/src/index.ts`; mobile `tsc --noEmit` green. Guard added:
`packages/infra/global/__tests__/tsconfigPathsResolve.test.ts` asks TypeScript's config parser for every
workspace tsconfig's effective `paths` + `pathsBasePath` and asserts each target exists. Red on mobile before
the fix, green after.

**Reply.**

> Correct — it pointed at `packages/apps/schemas`, which has never existed, and typecheck only passed via
> the hoisted `node_modules` fallback. Fixed to the three-level path (matching the vitest alias, which had
> already been corrected for the same off-by-one), and added a guard that resolves every `paths` target in
> every workspace tsconfig through TypeScript's own config parser and fails on a missing one.

## 4. `PRRT_kwDOR7sDRs6a_jn9` — identity-webhooks `deletionWorker.ts:171` — **real**

**Evidence.** The branch `return`ed on a missing `userId`; a normal return acknowledges the SQS record, so it
was deleted, never retried, never DLQ'd, and that user's recipe/food erasure fan-out was skipped
permanently — contradicting `deletionQueue.schema.ts`'s own disposition ("an invalid message is our bug; it
must reach the DLQ and its alarm"). Every producer sets `userId` on an erasure: identity's
`SqsService.DeletionQueueMessage.userId: string` is required, and `tombstoneSweep` sets `userId: tombstone.id`.
So absence is a producer bug, not a legitimate message.

**Fix.** Copilot's second option, at the contract: `idpDeletionMessageSchema` is now a tagged union whose
`erasure` variant requires `userId` (the lifecycle variant derives its events from the one `DELETION_EVENTS`
set via `.exclude(['erasure'])`). Narrowing on `event === 'erasure'` yields `userId: string`; the runtime
check is gone. The producer's type moved from beside the `@Injectable()` service into `types/deletion.ts`
(replacing an exported-but-unused `UserDeletionQueueMessage` that described a message no producer sends), so
webhooks can assert at the type level that identity's producer shape satisfies the consumer schema.
Tests: the unit test that pinned acknowledge-and-skip is rewritten to prove rejection on the sinks (no
fan-out, no Clerk delete, no erase) for absent and empty `userId`; a new schema suite covers every producer
shape, the refusals, and the two type-level assertions; `tombstoneSweep.integration.test.ts` now parses the
real enqueued bodies through the consumer schema. Red 2 → green; integration 14/14 against Postgres 18.

**Reply.**

> Agreed, and fixed at the contract rather than the handler: the schema is now a tagged union whose
> `erasure` variant requires `userId`, so a message without one is rejected in `parseMessage` and takes the
> same throw → retry → DLQ → alarm path as every other invalid message. Every producer already sets it
> (identity's `DeletionQueueMessage` types it required; the sweep copies `tombstone.id`), so absence is our
> bug. The handler's `userId` narrows to `string` and the runtime check is gone. The producer's type moved
> to `types/deletion.ts` so webhooks can assert at the type level that identity's shape satisfies the
> consumer schema; the sweep's integration test now parses its real enqueued bodies through the schema.

## 5. `PRRT_kwDOR7sDRs6XbjNG` — web `middleware.ts:33` — **real**

**Evidence.** `pathname.startsWith('/_vercel')` passes `/_vercel-cake` through un-localized, while the matcher
excludes only `_vercel/` — so the two gates disagreed, and the matcher test that pins `/recipes/_vercel-cake`
as still-matched only exercised the regex, never the handler.

**Fix.** `startsWith('/_vercel/')`. Handler test added: `/_vercel-cake`, `/_vercelx/insights/view` and a bare
`/_vercel` are locale-redirected. Red → green. No Playwright change: the platform paths are already covered
and this is a negative path the unit test pins directly (and CI was in progress on the branch, so no
Playwright was run locally).

**Reply.**

> Yes — the handler and the matcher disagreed on `/_vercel-cake`. Now `startsWith('/_vercel/')`, with a
> handler test that `/_vercel-cake`, `/_vercelx/…` and a bare `/_vercel` are still locale-redirected.

## 6. `PRRT_kwDOR7sDRs6bWu1B` — web `lib/unauthorizedRedirect.ts:42` — **real**

**Evidence.** One slot; `/en` → `/en/profile` → `/en` re-bounces. With `<SignIn>` forcing the visitor straight
back, that is the 2026-08-07 loop again, two surfaces wide.

**Fix.** The marker is a JSON list of attempted paths (and the in-document fallback is a `Set`). A pre-list
scalar marker from an earlier build is honoured as a one-element set (a visitor mid-session across a deploy);
an unreadable marker reads as no attempts, which is bounded rather than fail-open — the next write replaces
it with a well-formed list, so garbage costs at most one extra hop. Tests: the thread's exact sequence,
the same sequence under a throwing `sessionStorage`, the legacy scalar, and the garbage case. Red 2 → green.
`beforeEach` now `vi.restoreAllMocks()` so the storage-unavailable spy no longer leaks into later cases
(the old suite only worked because that case was last). Web-only by nature — this is the full-document
`window.location` bounce; mobile has no equivalent path.

**Reply.**

> Correct — one slot cannot keep "once per path". It is now a JSON list of attempted paths in
> `sessionStorage` (a `Set` in the storage-unavailable fallback), with a test for exactly the `/a` → `/b` →
> `/a` sequence. A pre-list scalar marker from an earlier build is honoured, and an unreadable marker costs at
> most one extra hop before the next write replaces it.

## 7. `PRRT_kwDOR7sDRs6bZ1Ac` — web `config/clerkStageCoherence.ts:67` — **real**

**Evidence.** `replace(/\$+$/, '')` made the terminator optional, so `pk_live_` + base64(`foo`) classified as
`{ kind: 'live', fapiHost: 'foo' }` and the coherence guard treated it as a production instance.

**Fix — the VENDOR's rule, mirrored, not one of ours.** `classifyClerkKey` now applies
`isValidDecodedPublishableKey` from `@clerk/shared/keys`, copied verbatim in behaviour: ends with `$`, no
other `$`, and a `.` in what remains (a Frontend API host is never a single label). A stricter hostname regex
of my own (≥2 DNS labels, alphanumeric with interior hyphens) was written first and **discarded**: it rejected
payloads Clerk accepts, and a guard that fails a build Clerk would have run is a worse defect than the one
being fixed. Tests: terminator-less payloads (`clerk.commise.app`, `foo`, the real sandbox host) → `null`; a
single label, an empty payload, a doubled `$` and an interior `$` → `null`; a case pinning that the rule is the
vendor's (`clerk.commise.app.$` and `a.b$` classify); and `findStageIncoherence` rejecting a terminator-less
`pk_live` against production. Red 3 → green.

**Why mirrored rather than imported.** `@clerk/shared` is not a declared dependency of `@commise/web` (it
arrives transitively under `@clerk/nextjs`), and this module is a build-time guard that must not take a runtime
Clerk import; the twin in `packages/infra/global/__tests__/prodWebSurface.ts` is in a test directory that
cannot import from this package either. Two copies of one rule are tolerable only while both copy the same
upstream predicate — which is now recorded in the module's "KNOWN DUPLICATION" paragraph as a change-both
obligation.

**The twin was repaired in parallel.** Another agent fixed `prodWebSurface.ts:74`'s identical
optional-terminator defect by mirroring the same `isValidDecodedPublishableKey`. Adopting the vendor rule here
(instead of my stricter regex) is what makes the two agree rather than drift a second time. That change is not
in this worktree; it arrives with integration.

**Consequence found by the full web unit suite, not the targeted one.** `src/config/env.ts` runs
`findStageIncoherence` at module load, and the unit placeholder in `vitest.config.ts`
(`pk_test_bG9jYWxob3N0JA`) decodes to the single label `localhost$` — which **Clerk itself** rejects, since the
remainder has no `.`. Ten test files failed at import. Fixed by making the placeholder a well-formed
development host (`unit-tests.clerk.accounts.dev$`), not by loosening the rule to admit it.

**Reply.**

> Agreed. `classifyClerkKey` now mirrors Clerk's own `isValidDecodedPublishableKey` (`@clerk/shared/keys`):
> exactly one trailing `$`, no interior `$`, and a `.` in what remains — so a decodable payload with no
> terminator, and `foo$`, both return `null`. I deliberately did not invent a stricter hostname regex: one
> was written first and discarded, because refusing a key Clerk accepts would fail a build that would have
> worked. The twin classifier in `packages/infra/global/__tests__/prodWebSurface.ts` had the same defect and
> was repaired the same way in parallel, so the two copies now share the vendor's predicate rather than two
> opinions.

## 8. `PRRT_kwDOR7sDRs6bAt7E` — web `scripts/previewDomainScope.ts:167` — **real** (low severity)

**Evidence.** `requirePreviewHost` checked only the first label plus "at least two labels remain", so
`pr-1.attacker.example` passed. Both Commands construct the host via `previewHostForPrToken` (zone-validated),
so the live paths were safe, and Route 53 would refuse a name outside the hosted zone on its own — but
nothing constrains the hostname a Vercel domain/alias call is sent, and the guard's documented promise is
that a _direct_ caller cannot aim a call outside scope. It under-delivered its own contract.

**Fix.** `requirePreviewHost(host, previewZone)` — the predicate is `prTokenForPreviewRecordName`, the same
specification the reaper uses, so there is one matcher (ADR-0005), not a second. All five adapters take the
zone and re-assert it; both Commands pass `options.previewZone`. Fixtures gained `pr-1.attacker.example`,
`pr-73.commise.app`, `pr-73.evil.sandbox.commise.app` and a suffix-confusion host; a dedicated
`requirePreviewHost` suite pins the accept/refuse sets and the one-matcher property. Red → green
(210 tests across the two suites).

**Reply.**

> Fair — the guard promised independence from its caller and only checked the label. It now takes the
> preview zone and asserts `pr-{N}` directly under it, using `prTokenForPreviewRecordName` as the single
> predicate (ADR-0005's one-matcher rule); every adapter takes the zone and re-asserts it, and the fixtures
> include `pr-1.attacker.example` and two in-zone confusions. Severity was low — both Commands already built
> the host through the zone-validated constructor — but the documented contract is now true.

## 9. `PRRT_kwDOR7sDRs6Ywx4m` — features-account `contractSkew.test.ts:253` — **real** (CodeQL)

**Evidence.** `expect(reportContractSkewOnce(...)).toBeUndefined()` uses a `void` call as a value — CodeQL's
"use of returnless function" (#313). The intent (nobody can `await` this on a hot path) is a _type_ property.

**Fix.** `expectTypeOf(reportContractSkewOnce).returns.toBeVoid()`. Strictly stronger: under a `void`
signature TypeScript rejects both an `async` implementation and a `return <value>`, which one runtime call
could only sample. The test file is inside the package's `tsc` project, so the assertion is enforced by
`typecheck`.

**Reply.**

> Replaced the runtime `toBeUndefined()` with a type-level `expectTypeOf(...).returns.toBeVoid()`, which is
> what the test was really asserting (a `void` signature rejects both an `async` body and a returned value
> at compile time). Clears the returnless-function finding.

## 10–12. `PRRT_kwDOR7sDRs6XhR4H` / `…XhR4J` / `…XhR4N` — `@kitchensink/infra-security` as a devDependency — **wrong**

**Claim.** `npm prune --omit=dev` removes it before the compiled CDK entrypoints run, so the deploy fails.

**Evidence (empirical, this tree).**

- `npm prune --omit=dev --dry-run --json` lists 100+ removals and **no** `@kitchensink/*` or `@commise/*`
  package. npm links every workspace regardless of which edge reaches it; a dev-only workspace edge does not
  make the link prunable.
- `npm ls @kitchensink/infra-security --omit=dev` still resolves it: `-> ./packages/infra/security`.
- Same footing as `@kitchensink/infra-alb`, a devDependency of identity/food/recipe since 2026-08-12 and
  imported by their CDK apps; and `packages/infra/global` — whose compiled entrypoint also runs after the
  prune at `prod-deploy.yml:421` — declares both under the same section.
- The web thread additionally rests on a hypothetical ("pipelines commonly prune"): `prod-deploy.yml` never
  runs `@commise/web`'s CDK app at all.

**Residual, for the tools agent.** The post-prune guard at `prod-deploy.yml:384` checks only `aws-cdk-lib`;
a `require`-probe over every workspace package the compiled CDK entrypoints import would pin this fact the
way `natEgressConsumers.test.ts` pins its list. Not added here — the workflow and its invariants tests are
outside this triage's roots.

**Reply (same text for all three, adjusted for the package name).**

> Checked empirically rather than by convention: `npm prune --omit=dev --dry-run` on this tree removes no
> workspace package at all (npm links every workspace regardless of which edge reaches it), and
> `npm ls @kitchensink/infra-security --omit=dev` still resolves it to `./packages/infra/security`.
> `@kitchensink/infra-alb` has been on exactly this footing since August and `packages/infra/global`
> declares the same packages the same way while its compiled entrypoint runs after the prune. Leaving it
> as a devDependency, which is the honest declaration for a build-time-only import.

---

## Verification record

| Gate                                                                 | Result                                                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `emittedEsmSpecifierExtensions` red → green                          | 1 failure (identity barrel, 2 specifiers) → 0                                                                              |
| `tsconfigPathsResolve` red → green                                   | 1 failure (mobile alias) → 0                                                                                               |
| webhooks `deletionQueue.schema` + `deletionWorker` red → green       | 2 failures (absent `userId`) → 37/37                                                                                       |
| webhooks integration (`DATABASE_URL` → local Postgres 18)            | 14/14                                                                                                                      |
| web unit: middleware, breaker, coherence, preview ×2 red → green     | 6 failures → 226/226                                                                                                       |
| features-account `contractSkew`                                      | 27/27; `tsc --noEmit` clean                                                                                                |
| turbo-scoped `lint format:check typecheck`                           | identity, webhooks, mobile, infra-global, web: all green                                                                   |
| repo-wide `npm run lint` (75 tasks) / `npm run typecheck` (71 tasks) | all successful                                                                                                             |
| `@commise/web` `next build`                                          | exit 0; build-generated `next-env.d.ts` drift reverted                                                                     |
| full web unit suite                                                  | 97 files / 1265 tests pass (after the placeholder-key fix, §7)                                                             |
| identity / identity-webhooks unit suites                             | 441/441 and 210/210                                                                                                        |
| `infra-global` unit suite                                            | 2018/2020 — the 2 failures are the known agent-worktree path-length ones (`serviceDevRunner`, `vitestTempRoot`), unrelated |
| Playwright                                                           | not run — CI was `in_progress` on the branch (shared Clerk dev instance)                                                   |

Each fix is one commit on `254a906b`; nothing pushed, nothing posted to the PR.
