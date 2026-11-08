/**
 * Which specs a local run executes: whether the selector decides, what it decided, the Playwright filters and the
 * `--test-list` text for it, and listing what Playwright would run.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { runPlan } from '@kitchensink/e2e-plan/runPlan';
import type { StampStart } from '@kitchensink/e2e-plan/stampRun';

import type { Env } from './e2eEnv';
import { LANE_LOG_DIR, REPO_ROOT } from './e2ePaths';
import { run } from './e2eProcess';
import { flattenReport, parseReport, type PlaywrightReport, type ReportedTest } from './e2eReport';

/** What to run: an optional `--test-list` file, then the caller's own arguments. */
export const selection = (passthrough: readonly string[], testList: string | undefined): readonly string[] => [
    ...(testList === undefined ? [] : ['--test-list', testList]),
    ...passthrough,
];

/**
 * Whether this run should ask the selector which specs to run.
 *
 * Only a bare local run does. A caller that named a spec, set a test list, or forced the whole suite has already
 * chosen, and the selector must not override it.
 *
 * @param passthrough - The arguments after `npm run test:e2e --`.
 * @param env - The caller's environment.
 * @returns True when the selector decides.
 */
export const wantsSelection = (passthrough: readonly string[], env: Env): boolean =>
    passthrough.length === 0 && env['FULL_SUITE'] !== '1' && (env['E2E_TEST_LIST'] ?? '') === '';

/**
 * Whether the selector, and not a person, chose which specs run. Only then may a passing run move the green stamp: a
 * stamp says the selector's own choice passed. A forced full suite counts, because the selector was asked and said so.
 *
 * @param passthrough - The arguments after `npm run test:e2e --`.
 * @param env - The caller's environment.
 * @returns True when no spec, test list or Playwright argument was named.
 */
export const selectorChose = (passthrough: readonly string[], env: Env): boolean =>
    passthrough.length === 0 && (env['E2E_TEST_LIST'] ?? '') === '';

/**
 * Playwright file filters that match exactly the named specs.
 *
 * Playwright reads a positional argument as a regular expression matched anywhere in the path, so a bare
 * `home.spec.ts` would also match `older/home.spec.ts` and `home.spec.tsx`; each filter is escaped, starts at the
 * test folder and ends at the file name.
 *
 * @param ids - Spec paths under `tests/e2e`.
 * @returns One filter per spec.
 */
export const specFilters = (ids: readonly string[]): readonly string[] =>
    ids.map((id) => `tests/e2e/${id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`);

/**
 * The text of a `--test-list` file for the listed tests: `[project] › file › describe › title`, one per line.
 *
 * `setup` is left out because Playwright runs it as a dependency of every project that needs it.
 *
 * @param tests - The tests of a `--list` report.
 * @returns The file text.
 */
export const testListText = (tests: readonly ReportedTest[]): string =>
    tests
        .filter((test) => test.project !== 'setup')
        .map((test) => `[${test.project}] › ${test.id.slice(test.project.length + ' › '.length)}\n`)
        .join('');

/**
 * Lists the tests a run would execute.
 *
 * @sideEffect Runs `playwright test --list`, which writes its JSON report to a file: stdout also carries whatever
 * the config prints while it loads.
 */
export function listTests(passthrough: readonly string[], testList: string | undefined, env: Env): PlaywrightReport {
    mkdirSync(LANE_LOG_DIR, { recursive: true });

    const file = `${LANE_LOG_DIR}/listed.json`;
    const status = run(
        'npx',
        ['playwright', 'test', '--list', '--reporter=json', ...selection(passthrough, testList)],
        { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: file },
    );

    if (status !== 0) {
        throw new Error('error: playwright --list failed');
    }

    return parseReport(readFileSync(file, 'utf8'));
}

/** What step 1 decided about which specs to run, before the list is written. */
export type Decision =
    /** Run what Playwright was going to run anyway; `note` says why the selection was dropped, if it was. */
    | { readonly kind: 'unselected'; readonly note?: string }
    /** The change touches no spec's screens: run nothing, and say why. */
    | { readonly kind: 'none'; readonly why: string }
    /** Run exactly these tests. */
    | { readonly kind: 'list'; readonly specs: number; readonly tests: readonly ReportedTest[] };

/** Step 1's answer: what to run, and the stamp context when the selector chose it. */
export interface Selected {
    readonly choice: Choice;
    readonly start: StampStart | undefined;
}

/** What step 1 decided, with the list written. */
export type Choice =
    | Exclude<Decision, { kind: 'list' }>
    /** Run exactly the tests in this `--test-list` file. */
    | { readonly kind: 'list'; readonly file: string; readonly specs: number; readonly tests: number };

/**
 * Step 1's decision, as a pure function of the selector's answer and of what Playwright lists.
 *
 * Every branch that is not a plain "these specs" widens: a selection that lists nothing is a skipped test that looks
 * like a pass, so it runs every spec instead of none.
 *
 * @param web - The selector's answer for the web tier.
 * @param list - Lists the tests of the named specs (`playwright test --list`); may throw.
 * @returns What to run.
 */
export function decideSpecs(
    web:
        | { readonly kind: 'all'; readonly reasons: readonly string[] }
        | { readonly kind: 'some'; readonly ids: readonly string[] },
    list: (ids: readonly string[]) => readonly ReportedTest[],
): Decision {
    if (web.kind === 'all') {
        return { kind: 'unselected' };
    }

    if (web.ids.length === 0) {
        return { kind: 'none', why: 'no change touches a screen or a test that a web spec covers' };
    }

    let tests: readonly ReportedTest[];

    try {
        tests = list(web.ids).filter((test) => test.project !== 'setup');
    } catch (error) {
        return {
            kind: 'unselected',
            note: `could not list the selected specs (${error instanceof Error ? error.message : String(error)})`,
        };
    }

    const listed = new Set(tests.map((test) => test.id.split(' › ')[1]));
    const silent = web.ids.filter((id) => !listed.has(id));

    if (silent.length > 0) {
        return {
            kind: 'unselected',
            note: `the selected spec(s) ${silent.join(', ')} list no test in this configuration, so the selection cannot be trusted`,
        };
    }

    return { kind: 'list', specs: web.ids.length, tests };
}

/**
 * Step 1: asks the impacted-test selector which specs the change affects.
 *
 * Fails SAFE: if the selector cannot answer, the whole suite runs.
 *
 * @sideEffect Runs the selector (git, dependency-cruiser) and `playwright test --list`, and writes the test list.
 * @param passthrough - The arguments after `npm run test:e2e --`.
 * @param env - The caller's environment.
 * @returns What to run.
 */
export async function chooseSelection(passthrough: readonly string[], env: Env): Promise<Selected> {
    if (!selectorChose(passthrough, env)) {
        return { choice: { kind: 'unselected' }, start: undefined };
    }

    let plan: Awaited<ReturnType<typeof runPlan>>;

    try {
        plan = await runPlan(REPO_ROOT, env as NodeJS.ProcessEnv, { platform: 'web' });
    } catch (error) {
        console.warn(
            `warning: the selector could not run (${error instanceof Error ? error.message : String(error)}); running every spec`,
        );

        return { choice: { kind: 'unselected' }, start: undefined };
    }

    plan.warnings.forEach((warning) => console.warn(`warning: ${warning}`));

    const start: StampStart | undefined =
        plan.treeAtStart === null ? undefined : { planTree: plan.treeAtStart, previous: plan.previous ?? undefined };

    if (plan.base.kind === 'stamp' && plan.base.owed.length > 0) {
        console.log(`▶ owed           : ${plan.base.owed.join(', ')} (sandbox-only flows not yet run)`);
    }

    if (!wantsSelection(passthrough, env)) {
        return { choice: { kind: 'unselected' }, start };
    }

    if (plan.web.kind === 'all') {
        console.log(
            `▶ selection      : every spec (${plan.web.reasons.length} reason${plan.web.reasons.length === 1 ? '' : 's'})`,
        );
        plan.web.reasons.slice(0, 5).forEach((reason) => console.log(`    ${reason}`));
    }

    const decision = decideSpecs(plan.web, (ids) => flattenReport(listTests(specFilters(ids), undefined, env)));

    if (decision.kind === 'unselected' && decision.note !== undefined) {
        console.warn(`warning: ${decision.note}; running every spec`);
    }

    if (decision.kind !== 'list') {
        return { choice: decision, start };
    }

    mkdirSync(LANE_LOG_DIR, { recursive: true });

    const file = `${LANE_LOG_DIR}/selected.txt`;

    writeFileSync(file, testListText(decision.tests));

    return { choice: { kind: 'list', file, specs: decision.specs, tests: decision.tests.length }, start };
}
