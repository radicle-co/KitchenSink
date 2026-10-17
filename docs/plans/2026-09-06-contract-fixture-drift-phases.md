---
title: 'chore: contract/fixture anti-drift work — the phase table, and the phase 0 audit'
date: 2026-09-06
type: chore
depth: standard
origin: owner approval 2026-09-05 (no requirements doc; recorded here because it existed in none)
---

# chore: contract/fixture anti-drift work — the phase table, and the phase 0 audit

## Why this document exists

The owner approved five anti-drift items on 2026-09-05 — verbatim: _"I like your suggestions - do them. I
also thinks it's worth doing items 3, 4, and 6"_ — and a `staff-architect` report sequenced them into
phases 0–4.

⛔ **That sequencing lived in no repository artifact.** Not a plan, not an ADR, nothing under `specs/`. The
only durable trace was `d8d36215`'s commit message, which says _"Phase 1 of the fixture-drift work the
owner approved… It delivers item 6"_ — it names a phase and an item and describes neither table. Anyone
picking this up re-did the archaeology, and the phase 0 gate below was skipped because nothing recorded
that it was a gate.

This document is that record. It builds nothing.

## The items

| id  | item                                                                                     |
| --- | ---------------------------------------------------------------------------------------- |
| A   | Parse fixtures against the service zod in CI                                             |
| B   | Stamp `CONTRACT_HASH` into recordings                                                    |
| 3   | Fixture factories exported from the schema packages                                      |
| 4   | A `./testing` export on each schema package                                              |
| 6   | Schema-based contract checking (a projection fingerprint + a breaking-change classifier) |

## The phases

| phase | what                                                                                                             | delivers | state                 |
| ----- | ---------------------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| 0     | The coverage audit ADR-0032 owes: what do the 39 mocked Playwright specs prove that the integration tier cannot? | —        | **DONE** — see below  |
| 1     | Golden-master projection + fail-closed classifier in `contract-gen`, wired to `contract:verify`                  | 6        | **DONE** — `d8d36215` |
| 2     | Fixture factories + a `./testing` export on the schema packages; migrate the two `__fixtures__` modules          | 3, 4     | not built             |
| 3     | Registry + boundary parse; move specs tier-by-tier per phase 0                                                   | A        | not built             |
| 4     | HAR conformance harvest — manual dispatch, sandbox-only, stamped                                                 | B        | not built             |

Two sub-decisions were never answered and are still open:

- whether any HAR recording may be committed to git (the one genuine one-way door; the recommendation was
  **never**);
- whether `oasdiff` gets an advisory, integrator-facing role.

## Phase 0 — the audit

### The question

Phase 0 was a **gate on phase 3**, because phase 3 moves specs between tiers. The architect's warning was
that _"moving 39 specs without that audit is how coverage disappears behind green checks."_ Commit
`1996c45f` moved them anyway — out of the deployed tier and into a locally-booted
`integration-web-playwright` job — so the audit is owed after the fact rather than before it.

### Method

The 39 are exactly the specs importing `mockRecipeApi` (the partition is derived per spec by
`tests/e2e/utils/specTier.ts`, and guarded). Against them: **166** component tests under
`packages/apps/commise/{web/src,features}` and **3** web integration files.

### Finding 1 — the deployed tier lost nothing, because it never had anything

A spec that installs `page.route('**/api/v1/**')` answers its own API. Whatever it proves, it cannot prove
anything about a deployment: the service under test is a fixture. So moving the 39 out of the deployed tier
removed no deployment coverage — **they were mis-filed as end-to-end, and the move corrected the filing.**

`ssrPrefetch.spec.ts` states the sharpest form of this from the inside: `page.route` _"only intercepts
requests the BROWSER issues, but a `page.tsx`'s server-side `RecipeServiceClient` prefetch runs inside the
Next server's own Node process and never touches the browser's network stack."_

### Finding 2 — they prove four things the integration tier structurally cannot

This is why the answer is "move them", not "delete them". Component tests run in **jsdom**
(`vitest.config.ts:33`), which has no layout engine, no real stylesheet cascade, and no navigation.

1. **Real geometry.** `homeTopBarGeometry.spec.ts` asserts `boundingBox()` from a real engine, and says why
   the simulated version was deleted rather than fixed: _"A simulator can only ever confirm its own
   assumptions, so it is guaranteed to miss the NEXT theme-level defect too."_
2. **Real cascade.** The recorded difficulty-chip defect — white-on-white because Tailwind's emission order
   beats class order — is invisible to a role/name assertion and to any jsdom test. It was measured in the
   production bundle, not inferred: `docs/superpowers/plans/2026-08-02-visual-defect-fixes.md` records
   `.bg-seafoam` at byte 20318 and `.bg-white` at 20905, so `bg-white` wins although `bg-seafoam` is
   written first. Both class names are present in the DOM, so every jsdom assertion about them passes.
3. **Real rendering.** `visualRegression.spec.ts` and `mockupFidelity.spec.ts` capture at two viewports.
4. **Real navigation and SSR boundaries.** `ssrPrefetch.spec.ts`, `homeNavCutover.spec.ts`.

The boundary is already stated in the corpus, by `homeTopBarGeometry.spec.ts` itself: _"The component suite
keeps what jsdom is actually authoritative about: structure, roles, accessible names, and class strings."_

### Verdict

`1996c45f`'s move was **correct on both counts** — the deployed tier lost nothing, and the 39 keep a home
where their assumptions hold. Phase 3 is unblocked.

⚠️ **What the audit does NOT clear.** The 39 assert against a hand-written mock, so nothing here checks that
the mock still matches the service's wire shape. That gap is the subject of items A and B, which is the
same reason phase 0 gated phase 3 rather than phase 1 — and it is unbuilt.
