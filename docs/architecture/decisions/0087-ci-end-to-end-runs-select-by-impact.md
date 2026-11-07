# 0087: CI end-to-end runs select by impact, and the manual door keeps the whole suite

- **Status**: Accepted
- **Date**: 2026-11-07
- **Drivers**: The owner's law of 2026-11-06. Run only the Playwright specs and Maestro flows for the screens a change
  affects. The test script makes that selection. Tests run at the most parallelism the machine allows. Tests run only
  through npm or turbo scripts, locally and in CI.
- **Relates to**:
  [ADR-0086](0086-local-end-to-end-runs-select-by-impact.md) defines the selector and the rules for what it can skip.
  This record applies that selector to the automatic pull request run.
  [ADR-0032](0032-deployed-ecosystem-test-tier.md) section 4 says the manual entrypoint "runs the WHOLE e2e suite".
  That sentence stays true and this record does not edit it. It narrows only the run that CI starts on its own.

## Context

On every pull request that has a live sandbox, CI ran every deployed Playwright spec in a fixed matrix of eight shards.
It ran Maestro with a selector that came from five path lists typed into `_ci.yml`. A path list does not know the
import graph. It did not know what a shared component reaches. The selector in `@kitchensink/e2e-plan` does, and
developers already use it locally under ADR-0086. Two selectors for one question can disagree.

The risk is the same as in ADR-0086. A test that is skipped looks the same as a test that passed. So every choice
below pushes a doubt toward running more.

## Decision

### 1. One job asks the selector, and it needs no sandbox

`_ci.yml` has a job `select-e2e`. It reads git and the import graphs and lists the Playwright tests. It runs nothing
against a deployment, so a down sandbox cannot stop it. It calls the selector through npm scripts only:
`npm run e2e:select --workspace=@commise/web` and `npm run ci:mobile --workspace=@kitchensink/e2e-plan`.

It publishes four values: the web specs, the number of web tests, the web matrix, and the Maestro selector.

A run that is not a pull request has no merge base, so it selects everything. If the selector fails, the answer is
everything.

### 2. The web matrix is sized by a pure function, not by the workflow

`webShardCount(listed, perShard, rosterLanes)` in `@kitchensink/e2e-plan` gives the shard count. It is zero for no
tests. It rounds up. It never passes the number of lanes in `POOL_ROSTER.web`. Shard N signs in as lane N. A shard past the roster
signs in as someone else. The workflow does no arithmetic.

An empty matrix is not legal in GitHub Actions. So when the count is zero, the web jobs do not start. A pull request
whose change touches no web spec runs no deployed web test. That is a skip with a stated reason.

Each shard checks the test count before it runs. `e2e.sh` calls `e2eCountCheck.ts`. That script lists the tests for
the same filters. It fails the shard when the number differs from the selection's count. A selection that lost a test
now fails loudly. It cannot pass over a smaller suite.

The selection step sets a placeholder `PLAYWRIGHT_BASE_URL`. This makes Playwright load the deployed configuration.
That configuration ignores the mocked specs, so the count made by the selection job is the count each shard will list.

### 3. Maestro is sized in one place, as before

`runMaestroFlows.sh shard-matrix` stays the only code that decides how many Maestro shards run. It clamps to the pool.
The selection job only supplies the selector. An empty selector means every flow. A list of flows becomes one
`flow:<id>=true` key for each flow. A selection of no flows switches the Maestro tier and the app build off, because an
an empty selector means every flow.

The job `detect-mobile-flows` and its path lists are deleted. The guards that read them are rewritten, and the
questions they answered now belong to the selector's own tests.

### 4. The manual door runs the whole suite

`deployedE2e.yml` passes none of the narrowing inputs. The inputs have defaults that mean the whole suite. The default
of `web_shards` is one shard for each lane in the web pool, and a guard holds it equal to `POOL_ROSTER.web`. Another guard fails when the manual door passes a narrowing input. It also fails when the door calls the selection job.

### 5. Every test run is an npm script

No workflow step starts `playwright test`, `maestro test` or `runMaestroFlows.sh` by hand. Playwright runs through
`npm run test:e2e`. Maestro runs through `npm run e2e:maestro --workspace=@commise/mobile`. A guard reads every
workflow step to enforce this. Installing browsers and merging reports are not test runs and are not covered.

## Alternatives rejected

- **Keep the path lists and add a Playwright list beside them.** That gives two sources for one fact. The lists
  were already behind the import graph.
- **Pass the selected tests as an artifact.** It needs an upload in one workflow and a download in another. The guard
  that pairs them cannot see the manual door, which has no upload. The spec filters are short enough to pass as a
  plain input.
- **Select on the manual door too.** ADR-0032 section 4 says it runs the whole suite. The owner's law is about the
  automatic run and the developer loop. The manual door is the full run on demand.

## Consequences

- A pull request that changes one screen runs that screen's tests and not eight shards of the suite.
- A change that no import reaches, such as a workflow file or the selector itself, selects everything.
- The shard count follows the test count, so a small selection starts few runners.
- The web pool caps the shards at its lane count. Raising it is an owner step in `poolAdmin`, then an append to
  `POOL_ROSTER`.

## Residual risk

- `ci-pr.yml` runs only for pull requests to `main`. None of this has run in real CI. The proof today is the guards,
  the zizmor audit and a local run of each command. The first pull request is the real test.
- The stubbed Playwright job, which needs no sandbox and always runs, is not narrowed by this record. It has its own
  six shards and no pool lanes.
- A registry row that leaves out a screen its test passes through means that test does not run after a change to that
  screen. ADR-0086 describes how the recorder closes this gap.
