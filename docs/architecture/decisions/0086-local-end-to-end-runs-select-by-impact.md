# 0086: Local end-to-end runs select the Playwright specs and Maestro flows a change affects

- **Status**: Accepted
- **Date**: 2026-11-07
- **Drivers**: The owner's law of 2026-11-06. While building, run only the Playwright specs and Maestro flows for the
  screens a change affects. The test script makes that selection. Tests run only through npm or turbo scripts. A full
  local Playwright run measured 696 tests in 38 minutes on one worker. A full Android Maestro run took about 2 h 50 min
  on one emulator. On 2026-11-07 the owner asked for the selector now, for local runs first.
- **Relates to**:
  [ADR-0032](0032-deployed-ecosystem-test-tier.md) defines the test tiers, and `docs/CODING_STANDARDS.md` section 7.1a
  defines the local tier. This record does not edit them. It narrows what a bare LOCAL run executes. The owner ruled that
  a local run measures its change from the last fully passing run, and the final-head check is CI's selected run against
  the pull request base. `FULL_SUITE=1` still forces the full suite.
  [ADR-0087](0087-ci-end-to-end-runs-select-by-impact.md) applies the same selector to CI.
  [ADR-0088](0088-local-maestro-runs-in-lanes-under-one-host-owned-orchestrator.md) decides how the chosen Maestro flows
  run in parallel.

## Context

Before this decision a developer who changed one screen ran the whole local suite or remembered which specs to name.
The selection that existed in CI came from path filters. It knew five verticals and nothing about the import graph. The
Playwright side had no selection at all.

The failure that matters is not symmetric. A test that a change did not need costs minutes. A test that it did need and
that was skipped ships a regression behind a green run. A skip looks the same as a pass. So the selector can be wrong in
one direction only, and every choice below pushes its errors toward running more.

## Decision

### 1. A bare local run selects, and the caller can always override

`npm run test:e2e --workspace=@commise/web` and `npm run test:e2e:android` ask the selector which tests the change
affects. `FULL_SUITE=1` runs everything. An explicit `E2E_TEST_LIST`, or any argument for Playwright, is a choice the
caller already made, and the selector does not override it. When nothing is affected, the door prints why and exits 0.
`E2E_LANES=1` turns off the parallel lanes only, not the selection. The deployed tiers and `npm run test:e2e` at the
root (`turbo run test:e2e`) are unchanged by this record.

A local run measures its change from the last fully passing run, not from `origin/main` (owner ruling 2026-11-07). That
run leaves a stamp for its branch and platform: the git tree object of the working tree as it was when the run was
planned, kept under `${XDG_STATE_HOME:-~/.local/state}/kitchensink/e2eGreen/`. With a stamp, the change set is the files
that differ between that tree and the working tree now, and an empty set runs nothing. With no stamp, with a stamp whose
tree is gone, or on a detached HEAD, the run does the full suite. An explicit `--base` or `TURBO_SCM_BASE`, and any run
in CI, keep the old rule: the merge base with that ref, where an empty set runs everything. A run moves the stamp only
when all four hold. The selector chose the set (`FULL_SUITE=1` counts; an `E2E_TEST_LIST`, Playwright arguments or a
flow override do not). Every selected test passed, with no failure and no skip. The recorder checks found nothing wrong.
The tree did not change while the run went on. The stamp then names the tree at plan time, and it also lists the
sandbox-only flows the run dropped, which stay owed. `npm run e2e:plan -- --base origin/main` reproduces CI's selection
by hand.

### 2. The selector walks the import graph backwards to screens, and screens to tests

`@kitchensink/e2e-plan` takes the files changed since the base of section 1. It lists them by diffing git trees, so
staged, unstaged and untracked files, and both names of a rename, arrive from one diff. It builds the
import graph of each app with dependency-cruiser. It walks from each changed file to the screens that import it. A
registry per tier names the screens each test passes through. A test runs if its row names a reached screen. It also
runs if the changed file is part of the test or is imported by it. A Maestro sub-flow selects every top-level flow
that runs it.

Screens are derived, not listed. On web, every `page.tsx` under `src/app/[locale]` is one screen, together with the
boundaries above it. On mobile, every module of `src/screens` that the navigator or the auth gate registers is a
screen. The walk stops at a screen, because the navigator imports every screen to register it. Following that edge
widens every screen change to the whole app. The walk does not stop there for a screen that embeds another screen.

### 3. Anything the selector cannot attribute runs the whole tier

Only these changes select zero tests: markdown (`**/*.md`, ADRs included), the vitest test files and their
configuration (`**/__tests__/**`, `**/*.test.*`, `**/vitest*.config.*`), and `packages/tools/repoGuards/**`. This differs
from the first brief, which also listed `docs/**` and `specs/**`. A Playwright spec screenshots `docs/mockups/screens/*.html`,
so a file under `docs/` can feed a test. The test files are on the list for a reason. One guard cruises both graphs with tests included. It fails if any shipped file imports a test. A second guard fails if a source of the end-to-end suites names a markdown file or the repo guards.

These changes select every test. Service sources, wire schemas and service clients. Every package that a service or a
test tool depends on, read from the workspace manifests at plan time and never from a list. A web spec runs against the
local stack, and no import graph of an app sees into those packages. The lockfile. The root and turbo configuration. The
Playwright and Maestro configuration. So does any changed file that the graph does not reach, such as a stylesheet, a
message file or an asset that no import resolves. So does any file that reaches a root: the root layout, middleware, the
app entry or a registrar. So does any `route.ts`, parallel-route slot or intercepting route, because none belongs to one
screen.

Zero is decided per tier. A tier selects nothing for a file only if the file provably belongs to the other platform.
It sits in the other app's folder, or it is a web leaf whose `.native` twin this tier's graph holds, or the reverse. A
file that this tier's graph does not hold, and that is not provably the other platform's, runs this tier whole. An empty
change set also runs the whole suite, because it looks exactly like a wrong base ref.

The selector widens a tier if its own inputs are suspect. Four cases count. An import it cannot follow, including a
workspace export that points into an unbuilt `dist` with no `src` twin. A registry row for a test that does not exist.
A test with no row. A row that names a screen that is gone. A selector that throws, or does not answer within its
timeout, returns the full suite with a warning. These are tests and not intentions. The registry guard, the
impact-classification probes and the zero-list guard run over the real tree.

### 4. The registries are a lower bound, and a recorder closes the gap

`web/tests/e2e/specScreens.tsv` is seeded from the paths each spec and its test helpers visit (`page.goto`,
`route()`, `toHaveURL`, `waitForURL`). `mobile/tests/e2e/maestroFlowScreens.tsv` is seeded at the grain of the runner's
verticals, because a flow cannot be read for the screens it reaches. A sign-in sub-flow carries a row of its own, which
the flow graph adds to every flow that runs it. Both are checked for existence and shape.

Neither registry can see a screen reached by tapping a link. A row that leaves one out is the one way this design can
skip a test that must run. A recorder closes the gap. `signInWithTicket` records the document and React Server Components
requests of each spec, and the main-frame navigations, to one JSON Lines file per lane. It skips prefetches. After the
run, the lane door compares the record with the registry. It fails the run and prints the rows to add. A row only ever
grows. Widening is always safe, and narrowing needs evidence.

### 5. Doors, and what other records decide

The web door selects in `scripts/e2eLanes.ts`, and the lane runner then runs the selection in parallel lanes. The
Android door is `npm run test:e2e:android`. It selects the flows with this selector and drops flows that need the deployed
sandbox, and it names them. ADR-0088 decides how the chosen flows run in lanes.

Three things are decided elsewhere. ADR-0087 decides the CI `select-e2e` job. ADR-0088 decides Android lanes beyond one
and the iOS door. The root door `e2e:plan` prints the selection and the reason for it.

## Consequences

- A change to a leaf component runs the tests of its screens and not the suite. A change to a shared primitive, a layout
  or the navigator runs close to all of them, on purpose.
- Editing a tool outside the app, the selector itself or a workflow file selects the whole suite, because no import
  reaches it. That is slow and safe. A further path that cannot change a test result joins the zero list only with a
  guard that proves it.
- A new spec or flow must come with a registry row. Without one, the tier runs whole and the guard fails. Deleting a test
  must delete its row.
- Specs whose navigation the guard cannot read carry a `*` row and run on every screen change.
- The selector pins `dependency-cruiser` exactly. Its version is the newest one published at least two weeks before it
  was adopted.
- A stamp is as sound as the selector. A pass proves the change it was selected for, so a wrong selection that passes
  moves the stamp past a change that was never tested. CI's selection against the pull request base is the second check.

## Residual risk

- A tap-through navigation that is missing from a registry row is a test that does not run, until the recorder has seen
  it. The recorder's live behaviour is unproven until the first real run. Two questions are open. Does `framenavigated` fire on an
  App Router client navigation? Or does the RSC request alone catch it? Specs that do not call `signInWithTicket` are not
  recorded.
- The mobile rows are coarse. They over-select within a vertical until a flow has been observed.
- A dynamic `import(variable)` or `require(variable)` is invisible to every resolver.
