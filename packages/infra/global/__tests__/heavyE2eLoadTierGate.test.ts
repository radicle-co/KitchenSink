// @vitest-environment node
/**
 * Repo-wide guard: each HEAVY tier auto-runs on any PR that can plausibly break what that tier measures —
 * without a human remembering a label, and without either tier dragging the other along.
 *
 * ## The invariant this protects
 *
 * **k6 (T-198).** T-198 put 1–2 character food searches back on the `food_search_vector_idx` GIN index
 * (156ms → 14ms). Deterministic tests now run on every PR and make the OLD query SHAPE structurally
 * impossible to reintroduce. They cannot see a pure LATENCY regression: drop the index, alter the schema, or
 * grow the RESOLVED population past the tested size and every one of those tests still passes. The only
 * thing that fails is the k6 tier.
 *
 * **Maestro.** The identical argument one tier over: nothing in the base pipeline RUNS the mobile app.
 * `_ci.yml` type-checks it and runs its vitest component/screen tests, but the only tier that builds a real
 * APK and drives it on a real Android emulator is `e2e-mobile-maestro` — and it used to require the LABEL on
 * a `pull_request`, so a PR that broke the mobile app shipped GREEN unless a human remembered to label it.
 *
 * **A guard that depends on a human remembering a label is not a guard** — the sentence that justified the
 * k6 path, now applied to the tier it originally excluded.
 *
 * So `heavy-e2e.yml`'s `heavy` job runs when ANY of four things is true:
 *
 *   1. the event is not a `pull_request` (the nightly schedule and manual dispatch), OR
 *   2. the PR carries `heavy-e2e` (the explicit opt-in — still the only path that runs BOTH tiers
 *      regardless of what changed), OR
 *   3. the PR changed one of food's measured query paths, OR
 *   4. the PR changed the mobile app's surface.
 *
 * …and then the two `with:` inputs SPLIT it per tier, which is the part most worth protecting: clause 3
 * admits k6 only, clause 4 admits Maestro only. Neither tier may ride the other's trigger.
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
 * - **A tier rides along on the other's trigger.** A food-search change has no business booting an Android
 *   emulator for ~50 measured minutes, and a `.native.tsx` change has no business driving three k6 load
 *   tests. `run_mobile_maestro` must be OFF on the food path, `run_load_test` OFF on the mobile path, and
 *   BOTH ON for the label. Asserted in both directions, because the cost mistake is symmetric.
 * - **A filter is widened into "always".** `dorny/paths-filter` answers "does ANY pattern match", so ONE
 *   leading-`!` negation is true for every unrelated file and silently converts a filter into an
 *   unconditional trigger — a ~50-minute emulator on every PR in the repo. A dedicated test rejects any
 *   negation, which is also what keeps this file's `minimatch`-based model an honest stand-in for the action.
 * - **The filter points at a file that moved.** Every representative path is asserted to EXIST, so renaming
 *   `foodSearch.dao.ts`, the migrations directory, or a Maestro flow fails here instead of silently
 *   emptying the filter.
 *
 * ## How it is asserted
 *
 * By EVALUATING the real expressions from the real YAML, through the whole caller → `with:` → callee chain:
 * `heavy-e2e.yml`'s gate decides whether the reusable workflow is called, its `with:` values become
 * `_ci-heavy.yml`'s `inputs.*`, and each heavy job's own `if:` decides whether that tier runs. A structural
 * assertion ("the `if` contains this substring") would pass just as happily with the terms `&&`-ed together
 * instead of `||`-ed, which is precisely the mistake worth catching.
 *
 * The boolean grammar comes from `./workflowExpression.ts` — shared with `workflowInvariants.test.ts`, so
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
 *  10. `run_mobile_maestro` reverted to its label-only form (the exact pre-change expression) → 4 fail,
 *      led by "runs Maestro for an UNLABELLED PR that touched the mobile app". This is the regression that
 *      would re-open the silent-mobile-breakage hole, so it is the single most important one here.
 *  11. `'!**\/__tests__\/**'` appended to the `mobile` filter → 4 fail: the dedicated negation guard, AND
 *      three behavioural tests ("does NOT cover food, web, or infra", "does NOT run Maestro for an
 *      unlabelled PR that touched nothing mobile", "does NOT boot the emulator … only changed search
 *      paths"). Proof the negation hazard is real and not theoretical: ONE `!` pattern made the mobile
 *      filter match food and infra paths, i.e. a ~53-minute emulator on essentially every PR.
 *  12. The `services/recipe-service/src/**` entry deleted → "covers the BACKEND the job boots" fails,
 *      which is the backend-only-PR-ships-green hole.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { type Truth, evaluateCondition, isSkipTolerant } from './workflowExpression.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** The opt-in caller that owns the gate. */
const CALLER_FILE = 'heavy-e2e.yml';

/** The reusable workflow that owns the heavy jobs. */
const CALLEE_FILE = '_ci-heavy.yml';

/** The job in `heavy-e2e.yml` that calls the heavy tiers. */
const GATED_JOB = 'heavy';

/**
 * The `_ci-heavy.yml` job ids for each tier, as the callee names them.
 *
 * All THREE k6 jobs share the single `run_load_test` input on purpose (see the callee's header), so every
 * scenario below asserts the whole tier moves together. Identity is listed for the same reason food is: its
 * four scripts existed for weeks with no job running them, and a list that omitted the new job would let it
 * be quietly gated differently — or dropped — without any scenario noticing.
 */
// ⚠️ ONE job since 2026-09-05, not three. `load-test`, `load-test-food` and `load-test-identity` were
// DELETED when k6 moved to deployed origins (owner ruling: "K6 should also be hitting sandbox or
// production … It follows the same pattern as the end to end tests"). Once the local substrate went,
// what remained of the three was one script against one origin — data, not three jobs. Per-service
// attribution survives as a STEP inside this job, each gated on its own origin's liveness.
const LOAD_TEST_JOBS = ['load-test-deployed'] as const;
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

/** Every `needs.<job>.outputs.<name>` reference in an expression, in order of appearance. */
function outputReferences(expression: string): readonly (readonly [string, string])[] {
    return [...expression.matchAll(/needs\.([\w-]+)\.outputs\.([\w-]+)/g)].map(
        (match) => [match[1] ?? '', match[2] ?? ''] as const,
    );
}

/**
 * Follow ONE `needs.<job>.outputs.<name>` reference all the way down to its glob patterns.
 *
 * Every hop throws rather than degrading, because every hop is a place where a rename leaves an expression
 * that still parses and evaluates to the empty string forever.
 */
function resolveChain(job: string, outputName: string): DetectionChain {
    const gate = jobOf(caller, CALLER_FILE, GATED_JOB);

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

/**
 * Every detection chain the caller actually uses, discovered from the gate AND from each `with:` value.
 *
 * There are TWO now (`search` -> k6, `mobile` -> Maestro), and they are found rather than listed: a tier whose
 * changed-path clause is deleted disappears from this map, and the scenario asserting that tier auto-runs then
 * fails on a missing chain instead of quietly passing through the label clause.
 */
function detectionChains(): ReadonlyMap<string, DetectionChain> {
    const gate = jobOf(caller, CALLER_FILE, GATED_JOB);
    const expressions = [gate.if ?? '', ...Object.values(gate.with ?? {}).map((value) => String(value))];
    const chains = new Map<string, DetectionChain>();

    for (const expression of expressions) {
        for (const [job, outputName] of outputReferences(expression)) {
            if (!chains.has(outputName)) {
                chains.set(outputName, resolveChain(job, outputName));
            }
        }
    }

    if (chains.size === 0) {
        throw new Error(
            `${CALLER_FILE}::${GATED_JOB} has no \`needs.<job>.outputs.<name>\` term in its \`if:\` or its ` +
                '`with:` values — every changed-path leg is missing, so the heavy tiers run only on a label again.',
        );
    }

    return chains;
}

const chains = detectionChains();

/** The chain for one filter key, or a loud failure — a missing tier must never pass silently. */
function chainFor(outputName: string): DetectionChain {
    const chain = chains.get(outputName);

    if (chain === undefined) {
        throw new Error(
            `no detection chain for \`${outputName}\`: nothing in ${CALLER_FILE}::${GATED_JOB}'s \`if:\` or ` +
                `\`with:\` reads \`needs.*.outputs.${outputName}\`, so that tier has no automatic trigger.`,
        );
    }

    return chain;
}

/** The food-search chain (k6) and the mobile chain (Maestro), as the caller names their outputs. */
const SEARCH_OUTPUT = 'search';
const MOBILE_OUTPUT = 'mobile';

/**
 * Does any changed path match a given filter? The same question `paths-filter` answers.
 *
 * NOTE the deliberate absence of negation handling: `paths-filter` answers "does ANY pattern match", so a
 * leading-`!` pattern is TRUE for every unrelated file and would make its filter fire on every PR. The
 * dedicated test below asserts no pattern starts with `!`, which is what keeps this simple `.some()` an honest
 * model of the action's behaviour.
 */
function filterMatches(outputName: string, changedFiles: readonly string[]): boolean {
    const { patterns } = chainFor(outputName);

    return changedFiles.some((file) => patterns.some((pattern) => minimatch(file, pattern, { dot: true })));
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

    const detectOutput = /^needs\.([\w-]+)\.outputs\.([\w-]+)\s*==\s*'true'$/.exec(atom);

    if (detectOutput !== null) {
        // Resolving through `chainFor` (rather than any name) keeps this TOTAL: a term naming an output no
        // filter produces throws here instead of silently evaluating false forever.
        const producingJob = detectOutput[1] ?? '';
        const outputName = detectOutput[2] ?? '';

        // ⛔ A SANDBOX-LIVENESS TERM IS ASSUMED TRUE — this guard's subject is the TRIGGER (which events,
        // labels and changed paths reach each heavy tier), not whether a preview is deployed. Owner ruling
        // 2026-09-05 gated both tiers on `needs.resolve-*.outputs.live`, an intra-workflow term no
        // `paths-filter` produces, so `chainFor` threw and took all eight trigger scenarios with it.
        //
        // ⚠️ DELIBERATELY NARROW — the resolve-job/`live` shape, never "any unknown output". The `chainFor`
        // call below is what keeps this resolver TOTAL: a term naming an output no filter produces still
        // THROWS rather than evaluating false forever, which is what makes a green run here mean anything.
        if (outputName === 'live' && producingJob.startsWith('resolve')) {
            return asTruth(true);
        }

        chainFor(outputName);

        // The detect job only runs `paths-filter` on a PR; on any other event its output is the empty string.
        return asTruth(scenario.event === 'pull_request' && filterMatches(outputName, scenario.changedFiles ?? []));
    }

    if (atom === "vars.REMOTE_E2E_ENABLED == 'true'") {
        // The TEMPORARY kill switch (owner directive 2026-08-31): the sandbox remote services both heavy
        // tiers depend on are unreachable, so heavy-e2e.yml's gate is vars-wrapped (a repo VARIABLE rather
        // than a literal `false`, because actionlint's if-cond check rejects constant expressions). The
        // variable is unset in this model — the disabled state; the scenario suite evaluates the UNDERLYING
        // gate via stripKillSwitch, so the logic cannot rot while the switch is in.
        return asTruth(false);
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

    // ⛔ The TEMPORARY kill switch (owner directive 2026-08-31) is STRIPPED before evaluation, on purpose:
    // the scenario suite's job is to keep the UNDERLYING gate logic from rotting while the switch is in —
    // the day the `false &&` comes out, these scenarios must still hold, or its removal ships a broken
    // gate. The switch itself is pinned by its own dated test below, so the disable is verified too.
    return definite(
        evaluateCondition(stripKillSwitch(gate.if), (atom) => resolveAtom(atom, scenario)),
        `${CALLER_FILE}::${GATED_JOB}.if`,
    );
}

/** Strip the vars kill-switch wrapper, returning the underlying gate expression. Pure. */
function stripKillSwitch(expression: string): string {
    const match = /^\s*vars\.REMOTE_E2E_ENABLED == 'true'\s*&&\s*\(([\s\S]*)\)\s*$/.exec(expression.trim());

    return match?.[1] ?? expression;
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
const SEARCH_DAO = 'packages/services/food-service/src/foods/dao/foodSearch.dao.ts';

/** Where `food_search_vector_idx` is created — dropping or altering it is the central scenario. */
const FTS_MIGRATION = 'packages/services/food-service/src/db/migrations/0001_food_fts.sql';

/** The Drizzle schema the DAOs query through. */
const FOOD_SCHEMA = 'packages/services/food-service/src/db/schema/food.ts';

/** The SC-007 search script — the thing that would report the regression. */
const SEARCH_LOAD_SCRIPT = 'packages/services/food-service/tests/load/search.load.js';

/** The 50,000-food fixture the SC scripts measure against; a smaller fixture hides a regression. */
const PERF_FIXTURE = 'packages/services/food-service/tests/load/preparePerfFixture.ts';

/** Same package, no bearing on query latency — the control that proves the filter is not `food-service/**`. */
const UNRELATED_IN_PACKAGE = 'packages/services/food-service/Dockerfile';

/** A different workspace entirely. */
const UNRELATED_ELSEWHERE = 'packages/apps/commise/web/next.config.ts';

const COVERED_PATHS = [SEARCH_DAO, FTS_MIGRATION, FOOD_SCHEMA, SEARCH_LOAD_SCRIPT, PERF_FIXTURE] as const;
const UNCOVERED_PATHS = [UNRELATED_IN_PACKAGE, UNRELATED_ELSEWHERE] as const;

// --- and the same, for the MOBILE tier -------------------------------------------------------------------

/** A mobile screen. The most ordinary way to break the app the emulator drives. */
const MOBILE_SCREEN = 'packages/apps/commise/mobile/src/screens/login.tsx';

/** A Maestro flow itself — changing what is asserted must re-run the assertions. */
const MAESTRO_FLOW = 'packages/apps/commise/mobile/.maestro/auth/login-flow.yaml';

/** The harness the emulator job executes; a break here fails every flow. */
const MAESTRO_HARNESS = 'packages/apps/commise/mobile/tests/e2e/run-maestro-flows.sh';

/** A design-system `.native.tsx` — renders inside the APK, invisible to the web suite. */
const UI_NATIVE = 'packages/apps/commise/ui/src/button/Button.native.tsx';

/** A shared feature package's native surface — `features/recipes` holds 42 of these. */
const FEATURE_NATIVE = 'packages/apps/commise/features/recipes/src/list/RecipeList.native.tsx';

/** Flows match localized copy as LITERAL TEXT, so a string change breaks them and nothing else. */
const I18N_STRINGS = 'packages/apps/commise/i18n/src/dictionary.ts';

/** The API client the app calls (46 import sites in mobile). */
const RECIPE_CLIENT = 'packages/clients/recipe-service/src/index.ts';

/**
 * The BACKEND the flows actually drive. The Maestro job builds, boots, migrates and seeds recipe-service, so a
 * backend-only PR can break every flow — and a mobile-paths-only filter would have let it ship green, which is
 * the "not a guard" defect one layer down.
 */
const RECIPE_SERVICE = 'packages/services/recipe-service/src/recipes/recipes.service.ts';

/** `dist` is COPY'd into the recipe image, so a break here fails the image build the job boots. */
const FOOD_CLIENT = 'packages/clients/food-service/src/index.ts';

const MOBILE_COVERED_PATHS = [
    MOBILE_SCREEN,
    MAESTRO_FLOW,
    MAESTRO_HARNESS,
    UI_NATIVE,
    FEATURE_NATIVE,
    I18N_STRINGS,
    RECIPE_CLIENT,
    RECIPE_SERVICE,
    FOOD_CLIENT,
] as const;

/**
 * Paths that must NEVER boot the emulator. `SEARCH_DAO` is the load-bearing one: the food service is not even
 * booted by the Maestro job (`FOOD_SERVICE_URL` points at nothing on purpose and the catalog flow asserts the
 * DEGRADED path), so a query change cannot alter a flow's outcome — and ~50 minutes is the price of getting
 * this wrong. The web app and the CDK infra have no edge to the APK at all.
 */
const MOBILE_UNCOVERED_PATHS = [
    SEARCH_DAO,
    UNRELATED_IN_PACKAGE,
    UNRELATED_ELSEWHERE,
    'packages/infra/global/bin/app.ts',
    'docs/CI_ARCHITECTURE.md',
] as const;

// ---------------------------------------------------------------------------------------------------------

describe('heavy-e2e load tier — the trigger paths', () => {
    it('names only paths that exist (a filter pointing at a moved file matches nothing, forever)', () => {
        for (const path of [...COVERED_PATHS, ...UNCOVERED_PATHS, ...MOBILE_COVERED_PATHS]) {
            expect(existsSync(join(REPO_ROOT, path)), `${path} does not exist`).toBe(true);
        }
    });

    it('covers the search DAO', () => {
        expect(filterMatches(SEARCH_OUTPUT, [SEARCH_DAO])).toBe(true);
    });

    it('covers the schema and the ordered migrations (the index-drop scenario)', () => {
        expect(filterMatches(SEARCH_OUTPUT, [FTS_MIGRATION])).toBe(true);
        expect(filterMatches(SEARCH_OUTPUT, [FOOD_SCHEMA])).toBe(true);
    });

    it('covers the k6 load scripts and the performance fixture that measure it', () => {
        expect(filterMatches(SEARCH_OUTPUT, [SEARCH_LOAD_SCRIPT])).toBe(true);
        expect(filterMatches(SEARCH_OUTPUT, [PERF_FIXTURE])).toBe(true);
    });

    it('does NOT cover unrelated files, in the same package or elsewhere', () => {
        // Cost is the reason this tier is opt-in at all (ADR-0007/0008). A filter that matched everything
        // would pay tens of runner-minutes for a Dockerfile tweak.
        for (const path of UNCOVERED_PATHS) {
            expect(filterMatches(SEARCH_OUTPUT, [path]), `${path} should not trigger the load tier`).toBe(false);
        }
    });

    it('is wired end to end: filter key → step output → job output → the caller expression', () => {
        // `detectionChains()` throws on any broken link, so reaching this point IS the assertion; these
        // re-state it in a form a failure message can show. Asserted for EVERY discovered chain, so a
        // second tier's wiring cannot drift while the first one's keeps the suite green.
        const gate = jobOf(caller, CALLER_FILE, GATED_JOB);
        const expressions = [gate.if ?? '', ...Object.values(gate.with ?? {}).map((value) => String(value))].join('\n');

        expect(chains.size).toBeGreaterThanOrEqual(2);

        for (const chain of chains.values()) {
            expect(chain.patterns.length).toBeGreaterThan(0);
            expect(jobOf(caller, CALLER_FILE, chain.job).outputs?.[chain.outputName]).toContain(
                `steps.${chain.stepId}.outputs.${chain.filterKey}`,
            );
            expect(expressions).toContain(`needs.${chain.job}.outputs.${chain.outputName}`);
        }
    });

    it('uses POSITIVE patterns only — a `!` negation would make its tier fire on every PR', () => {
        // `dorny/paths-filter` answers "does ANY pattern match". Under that rule a leading-`!` pattern is
        // TRUE for every file it does not name, so ONE negation turns a filter into "always" — a ~50-minute
        // emulator, or three k6 jobs, on every PR in the repo. Precision comes from narrow positives.
        for (const chain of chains.values()) {
            for (const pattern of chain.patterns) {
                expect(pattern.startsWith('!'), `${chain.filterKey} pattern \`${pattern}\` is a negation`).toBe(false);
            }
        }
    });

    it('detects changes in a job that can run on EVERY trigger, so no event loses a tier to a skip', () => {
        // A skipped dependency skips its dependents. If this job were gated on `pull_request`, the nightly
        // and dispatch runs would silently stop while every `if:` still read correctly (ADR-0010's class).
        for (const chain of chains.values()) {
            const detect = jobOf(caller, CALLER_FILE, chain.job);

            for (const event of triggerEvents(caller)) {
                const scenario = { event } as unknown as Scenario;
                const runs =
                    detect.if === undefined ||
                    definite(
                        evaluateCondition(detect.if, (atom) => resolveAtom(atom, scenario)),
                        'detect.if',
                    );

                expect(runs, `the ${chain.job} job does not run on \`${event}\``).toBe(true);
            }
        }
    });

    it('computes BOTH filters in ONE job, so neither tier can be lost to a per-tier skip', () => {
        // A second detect job gated on `pull_request` is the tempting shape and the wrong one: it would
        // silently kill whichever tier depended on it for the nightly/dispatch runs.
        expect(new Set([...chains.values()].map((chain) => chain.job)).size).toBe(1);
        expect(new Set([...chains.values()].map((chain) => chain.stepId)).size).toBe(1);
    });
});

describe('heavy-e2e mobile tier — Maestro now has a trigger of its OWN', () => {
    it('covers the mobile app, its Maestro flows, and the harness that runs them', () => {
        expect(filterMatches(MOBILE_OUTPUT, [MOBILE_SCREEN])).toBe(true);
        expect(filterMatches(MOBILE_OUTPUT, [MAESTRO_FLOW])).toBe(true);
        expect(filterMatches(MOBILE_OUTPUT, [MAESTRO_HARNESS])).toBe(true);
    });

    it('covers the shared design-system and feature packages the APK renders', () => {
        expect(filterMatches(MOBILE_OUTPUT, [UI_NATIVE])).toBe(true);
        expect(filterMatches(MOBILE_OUTPUT, [FEATURE_NATIVE])).toBe(true);
    });

    it('covers the localized copy the flows match as literal text, and the API client', () => {
        expect(filterMatches(MOBILE_OUTPUT, [I18N_STRINGS])).toBe(true);
        expect(filterMatches(MOBILE_OUTPUT, [RECIPE_CLIENT])).toBe(true);
    });

    it('covers the BACKEND the job boots — a backend-only PR must not break flows unseen', () => {
        // The job builds the recipe-service image, boots it, migrates + seeds it, and re-seeds between flows.
        // Filtering on mobile paths alone would have let a recipe API change red every flow behind a green PR.
        expect(filterMatches(MOBILE_OUTPUT, [RECIPE_SERVICE])).toBe(true);
        // `dist` COPY'd into that image — a break fails the image build before any flow runs.
        expect(filterMatches(MOBILE_OUTPUT, [FOOD_CLIENT])).toBe(true);
    });

    it('still excludes the food SERVICE — the only catalog flow is not in the executed FLOWS list', () => {
        // Measured, not assumed: `tests/e2e/run-maestro-flows.sh` runs a hardcoded 23-flow list, and
        // `.maestro/recipes/ingredient-catalog-blend.yaml` is NOT in it. So a food-service change could not
        // change any flow's outcome, and booting a ~53-minute emulator for one would buy zero coverage. Its
        // CLIENT is covered above, because that IS compiled into the recipe image.
        expect(filterMatches(MOBILE_OUTPUT, ['packages/services/food-service/src/foods/foods.service.ts'])).toBe(false);
        expect(filterMatches(MOBILE_OUTPUT, [SEARCH_DAO])).toBe(false);
    });

    it('does NOT cover food, web, or infra — a ~50-minute emulator is the cost of getting this wrong', () => {
        for (const path of MOBILE_UNCOVERED_PATHS) {
            expect(filterMatches(MOBILE_OUTPUT, [path]), `${path} should not boot the emulator`).toBe(false);
        }
    });

    it('runs Maestro for an UNLABELLED PR that touched the mobile app (the whole point)', () => {
        // The defect this closes: before it, a PR that broke the mobile app passed CI green unless a human
        // remembered to apply a label.
        const scenario: Scenario = { event: 'pull_request', labels: [], changedFiles: [MOBILE_SCREEN] };

        expect(maestroRuns(scenario)).toBe(true);
    });

    it('runs Maestro for an unlabelled PR that only changed a shared native component', () => {
        expect(maestroRuns({ event: 'pull_request', labels: [], changedFiles: [UI_NATIVE] })).toBe(true);
    });

    it('does NOT run the k6 tier for a mobile-only PR (the per-tier split, in the other direction)', () => {
        // Symmetry with "Maestro stays off the automatic path": neither tier may ride the other's trigger.
        const scenario: Scenario = { event: 'pull_request', labels: [], changedFiles: [MOBILE_SCREEN, UI_NATIVE] };

        expect(maestroRuns(scenario)).toBe(true);
        expect(loadTierRuns(scenario)).toBe(false);
    });

    it('does NOT run Maestro for an unlabelled PR that touched nothing mobile', () => {
        expect(
            maestroRuns({ event: 'pull_request', labels: [], changedFiles: [UNRELATED_IN_PACKAGE, 'README.md'] }),
        ).toBe(false);
    });

    it('runs BOTH tiers for a PR that touched food queries AND the mobile app', () => {
        const scenario: Scenario = {
            event: 'pull_request',
            labels: [],
            changedFiles: [SEARCH_DAO, MOBILE_SCREEN],
        };

        expect(loadTierRuns(scenario)).toBe(true);
        expect(maestroRuns(scenario)).toBe(true);
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

describe('the temporary heavy-tier kill switch (owner directive 2026-08-31)', () => {
    it('is present, as a REMOTE_E2E_ENABLED vars clause wrapping the whole gate', () => {
        const gate = jobOf(caller, CALLER_FILE, GATED_JOB);

        // Both heavy tiers reach REMOTE sandbox services (Clerk from the emulator, k6 against sandbox
        // hosts), which are unreachable right now. Set the repo variable REMOTE_E2E_ENABLED=true (or
        // delete the clause and this test) to re-enable — the scenario suite evaluates the UNDERLYING
        // expression either way, so re-enabling cannot ship a gate that rotted while it was off. A vars
        // gate rather than a literal `false` because actionlint's if-cond check rejects constants.
        expect(
            gate.if
                ?.trim()
                .replace(/^\$\{\{\s*/u, '')
                .startsWith("vars.REMOTE_E2E_ENABLED == 'true' &&"),
        ).toBe(true);
    });
});
