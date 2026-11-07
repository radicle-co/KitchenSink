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
  defines the local tier. This record does not edit them: it narrows what a bare LOCAL run executes. The owner has
  ruled that the final-head run is the selected run against `origin/main`, with `FULL_SUITE=1` still forcing the
  full suite, so this selector is the final-head run's selector too. A CI selection (Phase 4 of the lanes plan) is a
  decision of its own that amends ADR-0032 §4, and needs its own ADR.

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
`E2E_LANES=1` turns off the parallel lanes only, not the selection. CI, the deployed tiers and `npm run test:e2e` at
the root (`turbo run test:e2e`) are unchanged.

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

The only changes that select zero tests are markdown (`**/*.md`, ADRs included), the vitest test files and their
configuration (`**/__tests__/**`, `**/*.test.*`, `**/vitest*.config.*`) and `packages/tools/repoGuards/**`. This
DEPARTS from the brief's first list, which also zero-listed `docs/**` and `specs/**`: a Playwright spec screenshots
`docs/mockups/screens/*.html`, so a file under `docs/` can feed a test. The test files are on the list only because a
guard cruises both graphs with tests included and fails if any file that ships imports one; a second guard fails if a
source of the end-to-end suites names a markdown file or the repo guards.

These select every test: service sources, wire schemas and service clients; every package that a service or a test
tool depends on, read from the workspace manifests at plan time and never from a list (a web spec runs against the
local stack, and no import graph of an app sees into those packages); the lockfile; the root and turbo configuration;
and the Playwright and Maestro configuration. So does any changed file that the graph does not reach, including a
stylesheet, a message file or an asset that no import resolves, any file that reaches a root (the root layout,
middleware, the app entry, a registrar), and any `route.ts`, parallel-route slot or intercepting route, which belong
to no single screen.

Zero is decided PER TIER. A tier selects nothing for a file only when the file provably belongs to the other
platform: it sits in the other app's folder, or it is a web leaf whose `.native` twin this tier's graph holds, or the
reverse. A file this tier's graph does not hold and that is not provably the other platform's runs this tier whole.
An empty change set also runs the whole suite, because it looks exactly like a wrong base ref.

The selector widens a tier when its own inputs are suspect: an import it could not follow (including a workspace
export that points into an unbuilt `dist` with no `src` twin), a registry row for a test that does not exist, a test
with no row, or a row naming a screen that is gone. A selector that throws, or that does not answer within its
timeout, returns the full suite with a warning. These are tests, not intentions: the registry guard, the
impact-classification probes and the zero-list guard run over the real tree.

### 4. The registries are a lower bound, and a recorder closes the gap

`web/tests/e2e/specScreens.tsv` is seeded from the paths each spec and its test helpers navigate to (`page.goto`,
`route()`, `toHaveURL`, `waitForURL`). `mobile/tests/e2e/maestroFlowScreens.tsv` is seeded at the grain of the
runner's verticals, because a flow cannot be read for the screens it reaches; a sign-in sub-flow carries a row of its
own, which the flow graph adds to every flow that runs it. Both are checked for existence and shape.

Neither can see a screen reached by tapping a link, and a row that leaves one out is the one way this design can skip
a test it should run. The gap is being closed by a recorder: `signInWithTicket` (there is no shared Playwright fixture)
records the document and React Server Components requests of each spec, and the main-frame navigations, to one JSON
Lines file per lane, skipping prefetches. After the run the lane door compares them with the registry, fails the run,
and prints the rows to add. A row only ever grows; widening is always safe, and narrowing needs evidence.

### 5. Doors, and what is deferred

The web door selects in `scripts/e2eLanes.ts` (the existing lane runner then runs the selection in lanes). The Android
door is `local:maestro -- changed`, run by `npm run test:e2e:android`; it keeps `all`, drops flows that need the
deployed sandbox and names them, and runs the rest in the Maestro plan's own order. Not part of this decision: a CI
`select-e2e` job, Android lanes beyond one, and the iOS door.

## Consequences

- A change to a leaf component runs the tests of its screens, not the suite. A change to a shared primitive, a
  layout or the navigator runs close to all of them, on purpose.
- Editing a tool outside the app, the selector itself, or a workflow file selects the whole suite, because no import
  reaches it. That is slow and safe, and a further path that cannot change a test result joins the zero list only
  with a guard that proves it.
- A new spec or flow must come with a registry row, or the tier runs whole and the guard fails. Deleting a test must
  delete its row.
- Specs whose navigation the guard cannot read carry a `*` row and run on every screen change.
- The selector pins `dependency-cruiser` and `watskeburt` exactly. The version of `dependency-cruiser` is the newest
  one published at least two weeks before it was adopted.

## Residual risk

- A tap-through navigation missing from a registry row is a test that does not run, until the recorder has seen it. The
  recorder's live behaviour (whether `framenavigated` fires on an App Router client navigation, or the RSC request
  alone catches it) is unproven until the first real run. Specs that do not call `signInWithTicket` are not recorded.
- The mobile rows are coarse. They over-select within a vertical until a flow has been observed.
- A dynamic `import(variable)` or `require(variable)` is invisible to every resolver.
