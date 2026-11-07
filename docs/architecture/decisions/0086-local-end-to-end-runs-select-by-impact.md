# 0086 — Local end-to-end runs select the Playwright specs and Maestro flows a change affects

- **Status**: Proposed
- **Date**: 2026-11-07
- **Drivers**: The owner's law of 2026-11-06: while building, run only the Playwright specs and Maestro flows for the
  screens a change affects, the test script makes that selection, and tests run only through npm or turbo scripts.
  A full local Playwright run measured 696 tests in 38 minutes on one worker, and a full Android Maestro run about
  2 h 50 min on one emulator. On 2026-11-07 the owner asked for the selector now, for local runs first. CI comes
  later.
- **Relates to**:
  [ADR-0032](0032-deployed-ecosystem-test-tier.md) — it defines the test tiers and `docs/CODING_STANDARDS.md` §7.1a
  defines the local tier. This record does not edit them: it narrows what a bare LOCAL run executes. The full run on
  the final head before a PR is marked ready is untouched.

## Context

Before this decision a developer who changed one screen either ran the whole local suite or remembered which specs to
name. The CI selection that exists (`maestro_select_flows`, from path filters) knows five verticals and nothing about
the import graph, and the Playwright side had no selection at all.

The failure that matters is asymmetric. Running a test a change did not need costs minutes. Skipping a test it did
need ships a regression behind a green run, and a skip looks exactly like a pass. So the selector can be wrong in only
one direction, and every design choice below is made to push its errors toward running more.

## Decision

### 1. A bare local run selects; the caller can always override

`npm run test:e2e --workspace=@commise/web` and `npm run test:e2e:android` ask the selector which tests the change
affects. `FULL_SUITE=1` runs everything. An explicit `E2E_TEST_LIST`, or any argument for Playwright, is a choice the
caller already made, and the selector does not override it. When nothing is affected the door prints why and exits 0.
CI, the deployed tiers and `npm run test:e2e` at the root (`turbo run test:e2e`) are unchanged.

### 2. The selector walks the import graph backwards to screens, and screens to tests

`@kitchensink/e2e-plan` takes the files changed since the merge base with `origin/main` (watskeburt), builds the
import graph of each app with dependency-cruiser, and walks it from each changed file to the screens that import it.
A registry per tier names the screens each test passes through. A test runs when its row names a reached screen, or
when the changed file is part of the test or imported by it. A Maestro sub-flow selects every top-level flow that runs
it.

Screens are derived, not listed: on web every `page.tsx` under `src/app/[locale]` is one screen together with the
boundaries above it, on mobile every module of `src/screens` that the navigator or the auth gate registers. The
walk stops at a screen, because the navigator imports every screen to register it, and following that edge would
widen every screen change to the whole app. It does not stop there for a screen that embeds another screen.

### 3. Anything the selector cannot attribute runs the whole tier

The only changes that select zero tests are `docs/**`, `specs/**`, and markdown, ADRs included. These select every
test: service sources, wire schemas, service clients (a web spec runs against the local stack, and no import graph
sees from a screen into a service), the lockfile, the root and turbo configuration, and the Playwright and Maestro
configuration. So does any changed file that the graph does not reach, including a stylesheet, a message file or an
asset that no import resolves, and any file that reaches a root: the root layout, middleware, the app entry or a
registrar.

The selector also widens a tier when its own inputs are suspect: an import it could not follow (including a workspace
export that points into an unbuilt `dist` with no `src` twin), a registry row for a test that does not exist, a test
with no row, or a row naming a screen that is gone. A selector that throws returns the full suite with a warning.
These are tests, not intentions: the registry guard and the impact-classification guard run over the real tree.

### 4. The registries are a lower bound, and say so

`web/tests/e2e/specScreens.tsv` is seeded from the paths each spec and its test helpers navigate to (`page.goto`,
`route()`, `toHaveURL`, `waitForURL`). `mobile/tests/e2e/maestroFlowScreens.tsv` is seeded at the grain of the
runner's verticals, because a flow cannot be read for the screens it reaches. Both are checked for existence and shape.
Neither can see a screen reached by tapping a link. A row that leaves such a screen out is the one way this design
can skip a test it should run, and that gap is accepted here and recorded, not hidden: widening a row is always safe,
and narrowing one needs evidence from a run.

### 5. Doors, and what is deferred

The web door selects in `scripts/e2eLanes.ts` (the existing lane runner then runs the selection in lanes). The Android
door is `local:maestro -- changed`, run by `npm run test:e2e:android`; it keeps `all`, drops flows that need the
deployed sandbox and names them, and runs the rest in the Maestro plan's own order. Not part of this decision: a CI
`select-e2e` job, Android lanes beyond one, and the iOS door.

## Consequences

- A change to a leaf component runs the tests of its screens, not the suite. A change to a shared primitive, a
  layout or the navigator runs close to all of them, on purpose.
- Editing a unit-test file, a tool outside the app, or a workflow file selects the whole suite, because no import
  reaches it. That is slow and safe, and a short list of further paths that cannot change a test result can be added
  to the zero list by a decision of its own.
- A new spec or flow must come with a registry row, or the tier runs whole and the guard fails. Deleting a test must
  delete its row.
- Specs whose navigation the guard cannot read carry a `*` row and run on every screen change.
- The selector pins `dependency-cruiser` and `watskeburt` exactly. The version of `dependency-cruiser` is the oldest
  one published at least two weeks before it was adopted.

## Residual risk

- A tap-through navigation missing from a registry row is a test that does not run. The mitigation is the final-head
  full run that the standing rule still requires before a PR is marked ready.
- The mobile rows are coarse. They over-select within a vertical until a flow has been observed.
- A dynamic `import(variable)` or `require(variable)` is invisible to every resolver.
