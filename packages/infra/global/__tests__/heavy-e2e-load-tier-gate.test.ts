// @vitest-environment node
/**
 * Repo-wide guard: the k6 LOAD tier auto-runs on any PR that can plausibly slow food's measured queries —
 * without a human remembering a label, and without dragging the 50-minute Android emulator along.
 *
 * ## The invariant this protects (T-198)
 *
 * T-198 put 1–2 character food searches back on the `food_search_vector_idx` GIN index (156ms → 14ms).
 * Deterministic tests now run on every PR and make the OLD query SHAPE structurally impossible to
 * reintroduce. They cannot see a pure LATENCY regression: drop the index, alter the schema, or grow the
 * RESOLVED population past the tested size and every one of those tests still passes. The only thing that
 * fails is the k6 tier — which, before this guard, ran nightly, on demand, or on a PR carrying the
 * `heavy-e2e` LABEL. **A guard that depends on a human remembering a label is not a guard.**
 *
 * So `heavy-e2e.yml`'s `heavy` job now runs when ANY of three things is true:
 *
 *   1. the event is not a `pull_request` (the nightly schedule and manual dispatch, unchanged), OR
 *   2. the PR carries `heavy-e2e` (the explicit opt-in, unchanged — and still the ONLY path that also runs
 *      Maestro), OR
 *   3. the PR changed one of food's measured query paths (the new automatic path — k6 only).
 *
 * ## The failure classes this file exists to catch
 *
 * - **The tier silently stops running.** Changed-path detection is not available in a job-level `if:`, so it
 *   needs an upstream job — and a skipped or failed dependency SKIPS its dependents. A `detect` job gated on
 *   `pull_request` would therefore kill the NIGHTLY run while every `if:` still read correctly. That is why
 *   `gatedJobRuns` below models GitHub's skip propagation rather than just evaluating `heavy.if` in isolation:
 *   without it, the schedule/dispatch scenarios would pass against a dead pipeline. Same defect class as
 *   ADR-0010 (`deploy-food` must stay reachable on every non-closed PR event, or `deploy-recipe` vanishes).
 * - **The wiring drifts apart.** The gate reads `needs.<job>.outputs.<name>`; the job's `outputs:` map reads
 *   `steps.<id>.outputs.<key>`; the key is defined in the `filters:` YAML of the `dorny/paths-filter` step.
 *   Rename any one of those four and the expression still PARSES — it just evaluates to the empty string
 *   forever, so the automatic path quietly never fires while the label path keeps working. Nothing here is
 *   hardcoded: the chain is discovered end to end and each link is asserted against the next.
 * - **Maestro rides along.** A food-search change has no business booting an Android emulator for ~50
 *   measured minutes. The `run_mobile_maestro` input must be OFF on the automatic path and ON for the label.
 * - **The filter points at a file that moved.** Every representative path is asserted to EXIST, so renaming
 *   `food-search.dao.ts` or the migrations directory fails here instead of silently emptying the filter.
 *
 * ## How it is asserted
 *
 * By EVALUATING the real expressions from the real YAML, through the whole caller → `with:` → callee chain:
 * `heavy-e2e.yml`'s gate decides whether the reusable workflow is called, its `with:` values become
 * `_ci-heavy.yml`'s `inputs.*`, and each heavy job's own `if:` decides whether that tier runs. A structural
 * assertion ("the `if` contains this substring") would pass just as happily with the terms `&&`-ed together
 * instead of `||`-ed, which is precisely the mistake worth catching.
 *
 * The boolean grammar comes from `./workflow-expression.ts` — shared with `workflow-invariants.test.ts`, so
 * there is one parser for GitHub `if:` syntax rather than two that can disagree. What is local here is the
 * atom resolver's POLICY: it is TOTAL and **throws** on an atom it does not model, and `definite()` rejects
 * an `unknown` result. A new term added to the gate therefore fails this suite loudly instead of being
 * silently ignored — the opposite policy to the reachability guard, which must guess "unknown" to avoid
 * inventing findings.
 *
 * Changed-path matching uses `minimatch` rather than a hand-rolled glob→regex. `dorny/paths-filter` itself
 * matches with `picomatch` (`{ dot: true }`); picomatch ships no types and would need a second
 * `@types/picomatch` dependency, and for the two pattern shapes in play — a literal file path and a
 * `directory/**` prefix — the two engines are equivalent. `dot: true` is set for parity.
 *
 * ## Mutation evidence (each of these was applied and the named test watched to fail)
 *
 *   1. Gate's third clause deleted (label-only, i.e. the pre-T-198 state) → "runs for an UNLABELLED PR that
 *      touched the search DAO" fails.
 *   2. Third clause `||` changed to `&&` → the schedule, dispatch and labelled-PR scenarios fail (the gate
 *      would then need BOTH a non-PR event and a path change).
 *   3. `run_mobile_maestro` left as the original always-on expression → "Maestro does NOT run on the
 *      automatic path" fails.
 *   4. `run_mobile_maestro` narrowed to `false` outright → "a labelled PR still runs BOTH tiers" fails.
 *   5. `if: github.event_name == 'pull_request'` added to the detect job → the schedule and dispatch
 *      scenarios fail (skip propagation), which is the silent-nightly-death class.
 *   6. Detect job's `outputs.search` renamed without updating the gate → the wiring test fails.
 *   7. The `src/db/**` filter entry deleted → "the filter covers the schema and the ordered migrations"
 *      fails, and so does the migration-file scenario.
 *   8. Filter widened to `packages/services/food-service/**` → the negative-control test fails.
 *   9. `gatedJobRuns`'s skip-propagation loop removed, with mutation 5 re-applied → the dedicated detect
 *      reachability test still fails, but the five scenario failures collapse to that ONE. Recorded honestly
 *      because it corrects the guess this note was first written with: the loop is not what CATCHES a
 *      PR-gated detect job. What it buys is that the scenario assertions stop LYING — without it,
 *      "runs on the nightly schedule" reports green against a pipeline whose nightly run is dead, and a
 *      future scenario added by someone who trusts that green inherits the same blind spot.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { type Truth, evaluateCondition, isSkipTolerant } from './workflow-expression.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** The opt-in caller that owns the gate. */
const CALLER_FILE = 'heavy-e2e.yml';

/** The reusable workflow that owns the heavy jobs. */
const CALLEE_FILE = '_ci-heavy.yml';

/** The job in `heavy-e2e.yml` that calls the heavy tiers. */
const GATED_JOB = 'heavy';

/** The `_ci-heavy.yml` job ids for each tier, as the callee names them. */
const LOAD_TEST_JOBS = ['load-test', 'load-test-food'] as const;
const MAESTRO_JOB = 'e2e-mobile-maestro';

interface WorkflowStep {
    readonly id?: string;
    readonly name?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface WorkflowJob {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly uses?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly outputs?: Readonly<Record<string, string>>;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly on?: Readonly<Record<string, unknown>> | readonly string[] | string;
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

/** Parse one workflow from the real `.github/workflows/` tree. */
function loadWorkflow(file: string): WorkflowDocument {
    return parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as WorkflowDocument;
}

const caller = loadWorkflow(CALLER_FILE);
const callee = loadWorkflow(CALLEE_FILE);

/** A job, or a loud failure naming the file — an absent job must never silently pass a scenario. */
function jobOf(doc: WorkflowDocument, file: string, id: string): WorkflowJob {
    const job = doc.jobs?.[id];

    if (job === undefined) {
        throw new Error(`${file} has no job \`${id}\``);
    }

    return job;
}

/** `needs:` normalised to a list. */
function needsOf(job: WorkflowJob): readonly string[] {
    if (job.needs === undefined) {
        return [];
    }

    return typeof job.needs === 'string' ? [job.needs] : job.needs;
}

/** The event names the caller triggers on, however `on:` is written. */
function triggerEvents(doc: WorkflowDocument): readonly string[] {
    const on = doc.on;

    if (typeof on === 'string') {
        return [on];
    }

    return Array.isArray(on) ? on : Object.keys(on ?? {});
}

// ---------------------------------------------------------------------------------------------------------
// The detection chain, discovered rather than assumed:
//   heavy.if → needs.<detectJob>.outputs.<outputName> → steps.<stepId>.outputs.<filterKey> → filters:
// ---------------------------------------------------------------------------------------------------------

interface DetectionChain {
    /** The upstream job id the gate reads, as named in `needs:`. */
    readonly job: string;
    /** The job output the gate compares against `'true'`. */
    readonly outputName: string;
    /** The `dorny/paths-filter` step id that produces it. */
    readonly stepId: string;
    /** The key inside that step's `filters:` YAML. */
    readonly filterKey: string;
    /** The glob patterns under that key. */
    readonly patterns: readonly string[];
}

/**
 * Follow the gate's `needs.<job>.outputs.<name>` reference all the way down to its glob patterns.
 *
 * Every hop throws rather than degrading, because every hop is a place where a rename leaves an expression
 * that still parses and evaluates to the empty string forever.
 */
function detectionChain(): DetectionChain {
    const gate = jobOf(caller, CALLER_FILE, GATED_JOB);
    const reference = /needs\.([\w-]+)\.outputs\.([\w-]+)/.exec(gate.if ?? '');

    if (reference === null) {
        throw new Error(
            `${CALLER_FILE}::${GATED_JOB} has no \`needs.<job>.outputs.<name>\` term in its \`if:\` — the ` +
                'changed-path leg of the gate is missing, so the load tier runs only on a label again.',
        );
    }

    const [, job, outputName] = reference as unknown as readonly [string, string, string];

    if (!needsOf(gate).includes(job)) {
        throw new Error(
            `${CALLER_FILE}::${GATED_JOB} reads \`needs.${job}.outputs.${outputName}\` but does not \`needs: ` +
                `[${job}]\` — an un-needed job's outputs are always empty, so the gate can never see a change.`,
        );
    }

    const detect = jobOf(caller, CALLER_FILE, job);
    const produced = detect.outputs?.[outputName];

    if (produced === undefined) {
        throw new Error(
            `${CALLER_FILE}::${job} declares no output \`${outputName}\`; the gate would compare the empty ` +
                'string to `true` on every run and the automatic path would never fire.',
        );
    }

    const stepReference = /steps\.([\w-]+)\.outputs\.([\w-]+)/.exec(produced);

    if (stepReference === null) {
        throw new Error(`${CALLER_FILE}::${job} output \`${outputName}\` is not a \`steps.*.outputs.*\` value`);
    }

    const [, stepId, filterKey] = stepReference as unknown as readonly [string, string, string];
    const step = (detect.steps ?? []).find((candidate) => candidate.id === stepId);

    if (step === undefined) {
        throw new Error(`${CALLER_FILE}::${job} has no step with id \`${stepId}\``);
    }

    if (!/dorny\/paths-filter@/.test(step.uses ?? '')) {
        throw new Error(
            `${CALLER_FILE}::${job}::${stepId} is expected to be a pinned \`dorny/paths-filter\` step, ` +
                `not \`${step.uses ?? '(no uses)'}\``,
        );
    }

    const filters = parse(String(step.with?.['filters'] ?? '')) as Readonly<Record<string, readonly string[]>>;
    const patterns = filters?.[filterKey];

    if (patterns === undefined || patterns.length === 0) {
        throw new Error(
            `${CALLER_FILE}::${job}::${stepId} defines no \`${filterKey}\` filter, so its output is always ` +
                'the empty string.',
        );
    }

    return { job, outputName, stepId, filterKey, patterns };
}

const chain = detectionChain();

/** Does any changed path match the discovered filter? The same question `paths-filter` answers. */
function filterMatches(changedFiles: readonly string[]): boolean {
    return changedFiles.some((file) => chain.patterns.some((pattern) => minimatch(file, pattern, { dot: true })));
}

// ---------------------------------------------------------------------------------------------------------
// A fully-specified event, and a TOTAL resolver over it
// ---------------------------------------------------------------------------------------------------------

interface Scenario {
    readonly event: 'schedule' | 'workflow_dispatch' | 'pull_request';
    /** Labels on the PR. Irrelevant to non-PR events. */
    readonly labels?: readonly string[];
    /** Paths this PR changed, relative to the repo root. Irrelevant to non-PR events. */
    readonly changedFiles?: readonly string[];
    /** `workflow_dispatch` input values, as GitHub delivers them: strings. */
    readonly dispatch?: Readonly<Record<string, string>>;
}

/**
 * Resolve one opaque atom under a fully-specified scenario.
 *
 * THROWS on anything it does not model. That is the whole point: an `unknown` here would let a new term
 * silently join the gate without any test noticing it changed the outcome.
 */
function resolveAtom(atom: string, scenario: Scenario): Truth {
    const asTruth = (value: boolean): Truth => (value ? 'true' : 'false');

    const eventComparison = /^github\.event_name\s*(==|!=)\s*'([^']*)'$/.exec(atom);

    if (eventComparison !== null) {
        const equal = eventComparison[2] === scenario.event;

        return asTruth(eventComparison[1] === '==' ? equal : !equal);
    }

    if (atom === "contains(github.event.pull_request.labels.*.name, 'heavy-e2e')") {
        // On a non-`pull_request` event the labels array does not exist, so `contains` is false.
        return asTruth(scenario.event === 'pull_request' && (scenario.labels ?? []).includes('heavy-e2e'));
    }

    const detectOutput = new RegExp(`^needs\\.${chain.job}\\.outputs\\.${chain.outputName}\\s*==\\s*'true'$`).exec(
        atom,
    );

    if (detectOutput !== null) {
        // The detect job only runs `paths-filter` on a PR; on any other event its output is the empty string.
        return asTruth(scenario.event === 'pull_request' && filterMatches(scenario.changedFiles ?? []));
    }

    const dispatchInput = /^github\.event\.inputs\.([\w-]+)\s*==\s*'([^']*)'$/.exec(atom);

    if (dispatchInput !== null) {
        // `github.event.inputs.*` is the empty string on every event other than `workflow_dispatch` — which is
        // exactly why the caller uses it instead of the `inputs` context.
        const value = scenario.event === 'workflow_dispatch' ? (scenario.dispatch?.[dispatchInput[1] ?? ''] ?? '') : '';

        return asTruth(value === dispatchInput[2]);
    }

    throw new Error(
        `unmodelled atom in ${CALLER_FILE}: \`${atom}\`. A new term in the gate must be modelled here (and ` +
            'covered by a scenario) before it can change when the load tier runs.',
    );
}

/** A definite verdict, or a loud failure — an `unknown` gate is an unproven gate. */
function definite(truth: Truth, what: string): boolean {
    if (truth === 'unknown') {
        throw new Error(`${what} did not evaluate to a definite value`);
    }

    return truth === 'true';
}

/**
 * Whether the gated caller job runs, modelling GitHub's SKIP PROPAGATION as well as its own `if:`.
 *
 * The propagation half is load-bearing: a `detect` job gated on `pull_request` leaves `heavy.if` reading
 * perfectly while the nightly run dies, because GitHub skips every dependent of a skipped job unless the
 * dependent opts out of the implicit `success()`.
 */
function gatedJobRuns(scenario: Scenario): boolean {
    const gate = jobOf(caller, CALLER_FILE, GATED_JOB);

    for (const need of needsOf(gate)) {
        const dependency = jobOf(caller, CALLER_FILE, need);
        const dependencyRuns =
            dependency.if === undefined ||
            definite(
                evaluateCondition(dependency.if, (atom) => resolveAtom(atom, scenario)),
                `${CALLER_FILE}::${need}.if`,
            );

        if (!dependencyRuns && !isSkipTolerant(gate.if)) {
            return false;
        }
    }

    if (gate.if === undefined) {
        return true;
    }

    return definite(
        evaluateCondition(gate.if, (atom) => resolveAtom(atom, scenario)),
        `${CALLER_FILE}::${GATED_JOB}.if`,
    );
}

/** One of the caller's `with:` values, evaluated under the scenario — i.e. the callee's `inputs.<name>`. */
function passedInput(name: string, scenario: Scenario): boolean {
    const raw = jobOf(caller, CALLER_FILE, GATED_JOB).with?.[name];

    if (raw === undefined) {
        throw new Error(`${CALLER_FILE}::${GATED_JOB} passes no \`${name}\` input`);
    }

    if (typeof raw === 'boolean') {
        return raw;
    }

    return definite(
        evaluateCondition(String(raw), (atom) => resolveAtom(atom, scenario)),
        `with.${name}`,
    );
}

/**
 * Whether a given heavy job actually runs: the caller's gate, then the input it passes, then the callee job's
 * own `if:`. Anything less than the full chain proves only that a boolean was set.
 */
function heavyJobRuns(jobId: string, scenario: Scenario): boolean {
    if (!gatedJobRuns(scenario)) {
        return false;
    }

    const job = jobOf(callee, CALLEE_FILE, jobId);

    if (job.if === undefined) {
        return true;
    }

    return definite(
        evaluateCondition(job.if, (atom) => {
            const bare = /^inputs\.([\w-]+)$/.exec(atom);

            if (bare !== null) {
                return passedInput(bare[1] ?? '', scenario) ? 'true' : 'false';
            }

            return resolveAtom(atom, scenario);
        }),
        `${CALLEE_FILE}::${jobId}.if`,
    );
}

/** Whether BOTH k6 jobs run (they share one input on purpose — recipe rides along with food). */
function loadTierRuns(scenario: Scenario): boolean {
    return LOAD_TEST_JOBS.every((jobId) => heavyJobRuns(jobId, scenario));
}

/** Whether the ~50-minute Android emulator job runs. */
function maestroRuns(scenario: Scenario): boolean {
    return heavyJobRuns(MAESTRO_JOB, scenario);
}

// ---------------------------------------------------------------------------------------------------------
// Representative paths. Each is asserted to EXIST, so a rename fails here instead of emptying the filter.
// ---------------------------------------------------------------------------------------------------------

/** The query T-198 tuned: 1–2 character searches back onto the GIN index. */
const SEARCH_DAO = 'packages/services/food-service/src/foods/dao/food-search.dao.ts';

/** Where `food_search_vector_idx` is created — dropping or altering it is the central scenario. */
const FTS_MIGRATION = 'packages/services/food-service/src/db/migrations/0001_food_fts.sql';

/** The Drizzle schema the DAOs query through. */
const FOOD_SCHEMA = 'packages/services/food-service/src/db/schema/food.ts';

/** The SC-007 search script — the thing that would report the regression. */
const SEARCH_LOAD_SCRIPT = 'packages/services/food-service/tests/load/search.load.js';

/** The 50,000-food fixture the SC scripts measure against; a smaller fixture hides a regression. */
const PERF_FIXTURE = 'packages/services/food-service/tests/load/prepare-perf-fixture.ts';

/** Same package, no bearing on query latency — the control that proves the filter is not `food-service/**`. */
const UNRELATED_IN_PACKAGE = 'packages/services/food-service/Dockerfile';

/** A different workspace entirely. */
const UNRELATED_ELSEWHERE = 'packages/apps/commise/web/next.config.ts';

const COVERED_PATHS = [SEARCH_DAO, FTS_MIGRATION, FOOD_SCHEMA, SEARCH_LOAD_SCRIPT, PERF_FIXTURE] as const;
const UNCOVERED_PATHS = [UNRELATED_IN_PACKAGE, UNRELATED_ELSEWHERE] as const;

// ---------------------------------------------------------------------------------------------------------

describe('heavy-e2e load tier — the trigger paths', () => {
    it('names only paths that exist (a filter pointing at a moved file matches nothing, forever)', () => {
        for (const path of [...COVERED_PATHS, ...UNCOVERED_PATHS]) {
            expect(existsSync(join(REPO_ROOT, path)), `${path} does not exist`).toBe(true);
        }
    });

    it('covers the search DAO', () => {
        expect(filterMatches([SEARCH_DAO])).toBe(true);
    });

    it('covers the schema and the ordered migrations (the index-drop scenario)', () => {
        expect(filterMatches([FTS_MIGRATION])).toBe(true);
        expect(filterMatches([FOOD_SCHEMA])).toBe(true);
    });

    it('covers the k6 load scripts and the performance fixture that measure it', () => {
        expect(filterMatches([SEARCH_LOAD_SCRIPT])).toBe(true);
        expect(filterMatches([PERF_FIXTURE])).toBe(true);
    });

    it('does NOT cover unrelated files, in the same package or elsewhere', () => {
        // Cost is the reason this tier is opt-in at all (ADR-0007/0008). A filter that matched everything
        // would pay tens of runner-minutes for a Dockerfile tweak.
        for (const path of UNCOVERED_PATHS) {
            expect(filterMatches([path]), `${path} should not trigger the load tier`).toBe(false);
        }
    });

    it('is wired end to end: filter key → step output → job output → the gate expression', () => {
        // `detectionChain()` throws on any broken link, so reaching this point IS the assertion; these
        // re-state it in a form a failure message can show.
        expect(chain.patterns.length).toBeGreaterThan(0);
        expect(jobOf(caller, CALLER_FILE, chain.job).outputs?.[chain.outputName]).toContain(
            `steps.${chain.stepId}.outputs.${chain.filterKey}`,
        );
        expect(jobOf(caller, CALLER_FILE, GATED_JOB).if).toContain(`needs.${chain.job}.outputs.${chain.outputName}`);
    });

    it('detects changes in a job that can run on EVERY trigger, so no event loses the tier to a skip', () => {
        // A skipped dependency skips its dependents. If this job were gated on `pull_request`, the nightly
        // and dispatch runs would silently stop while every `if:` still read correctly (ADR-0010's class).
        const detect = jobOf(caller, CALLER_FILE, chain.job);

        for (const event of triggerEvents(caller)) {
            const scenario = { event } as unknown as Scenario;
            const runs =
                detect.if === undefined ||
                definite(
                    evaluateCondition(detect.if, (atom) => resolveAtom(atom, scenario)),
                    'detect.if',
                );

            expect(runs, `the detect job does not run on \`${event}\``).toBe(true);
        }
    });
});

describe('heavy-e2e load tier — when it runs', () => {
    it('runs on the nightly schedule', () => {
        expect(loadTierRuns({ event: 'schedule' })).toBe(true);
    });

    it('runs on a manual dispatch that asks for it', () => {
        expect(loadTierRuns({ event: 'workflow_dispatch', dispatch: { run_load_test: 'true' } })).toBe(true);
    });

    it('does NOT run on a manual dispatch that switched it off', () => {
        expect(
            loadTierRuns({
                event: 'workflow_dispatch',
                dispatch: { run_load_test: 'false', run_mobile_maestro: 'true' },
            }),
        ).toBe(false);
    });

    it('runs for a PR carrying the heavy-e2e label', () => {
        expect(loadTierRuns({ event: 'pull_request', labels: ['heavy-e2e'], changedFiles: ['README.md'] })).toBe(true);
    });

    it('runs for an UNLABELLED PR that touched the search DAO', () => {
        expect(loadTierRuns({ event: 'pull_request', labels: [], changedFiles: [SEARCH_DAO] })).toBe(true);
    });

    it('runs for an UNLABELLED PR that touched a migration (the dropped-index case)', () => {
        expect(loadTierRuns({ event: 'pull_request', labels: [], changedFiles: [FTS_MIGRATION] })).toBe(true);
    });

    it('does NOT run for an unlabelled PR that touched nothing measured', () => {
        expect(
            loadTierRuns({ event: 'pull_request', labels: [], changedFiles: [UNRELATED_IN_PACKAGE, 'README.md'] }),
        ).toBe(false);
    });
});

describe('heavy-e2e load tier — Maestro stays off the automatic path', () => {
    it('does NOT boot the emulator for an unlabelled PR that only changed search paths', () => {
        // ~50 measured minutes and a Gradle APK build. A latency guard must not drag it along.
        const scenario: Scenario = { event: 'pull_request', labels: [], changedFiles: [SEARCH_DAO] };

        expect(loadTierRuns(scenario)).toBe(true);
        expect(maestroRuns(scenario)).toBe(false);
    });

    it('still runs BOTH tiers for a PR that explicitly asks with the label', () => {
        const scenario: Scenario = { event: 'pull_request', labels: ['heavy-e2e'], changedFiles: [SEARCH_DAO] };

        expect(loadTierRuns(scenario)).toBe(true);
        expect(maestroRuns(scenario)).toBe(true);
    });

    it('still runs both tiers nightly and on a dispatch that asks for both', () => {
        expect(maestroRuns({ event: 'schedule' })).toBe(true);
        expect(
            maestroRuns({
                event: 'workflow_dispatch',
                dispatch: { run_load_test: 'true', run_mobile_maestro: 'true' },
            }),
        ).toBe(true);
    });

    it('honours a dispatch that switched Maestro off but left the load tier on', () => {
        const scenario: Scenario = {
            event: 'workflow_dispatch',
            dispatch: { run_load_test: 'true', run_mobile_maestro: 'false' },
        };

        expect(loadTierRuns(scenario)).toBe(true);
        expect(maestroRuns(scenario)).toBe(false);
    });
});
