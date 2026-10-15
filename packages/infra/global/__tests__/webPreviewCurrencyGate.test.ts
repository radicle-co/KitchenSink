// @vitest-environment node
/**
 * Repo-wide guard: the deployed web tier cannot drive a preview without first proving the preview serves the
 * commit under test.
 *
 * ## The defect this pins
 *
 * CI run 38791689080: the eight Playwright shards drove `pr-91.sandbox.commise.app` while it served a Vercel
 * deployment built from 249a376f1, 29 commits behind the commit under test. Seven shards went green and proved
 * nothing about that commit's web UI. A push does not move the preview alias (ADR-0060), so "the preview built"
 * and "the preview serves this build" are different facts, and only the second one licenses the tier.
 * `packages/apps/commise/web/scripts/previewCurrency.ts` reads the second one from Vercel.
 *
 * ## What is asserted
 *
 *   1. `e2e-web` runs the currency check as a step with NO `if:` and no `continue-on-error`, so nothing can skip
 *      it or turn its red green. It sits BEFORE the AWS sign-in, the Clerk secrets, the pool reset and the suite:
 *      a stale preview stops the shard before it writes anything or runs a test.
 *   2. It compares against the PR's HEAD sha (falling back to `github.sha` for a dispatch). Vercel builds the
 *      branch, never `refs/pull/N/merge`, so `github.sha` alone on a pull request would be red on every run.
 *   3. It fails closed when the Vercel token is missing — executed here under bash, not read as text.
 *   4. The token reaches it through EVERY hop: the tiers file declares it, `_ci.yml` declares and forwards it,
 *      every caller of `_ci.yml` forwards it, and the manual door forwards it. A missing hop is an empty token at
 *      run time, which is the red of rule 3 on every pull request.
 *
 * Every rule is a pure analyzer run over the real tree AND over fixture trees that break it, so each rule is shown
 * to be able to fail.
 *
 * ⛔ Maestro gets no such gate, deliberately. It reaches the web preview only as the Clerk `azp` string the seeder
 * signs in with (`E2E_SEED_WEB_ORIGIN`); the app it drives is built in the same run from this commit
 * (`_mobileAppBuild.yml`) and talks to the service origins directly. A stale web preview cannot change what it tests.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from './serviceSources.js';
import { runWorkflowStep } from './workflowStepRunner.js';
import { scalarText } from './workflowScalar.js';

const WORKFLOW_DIR = join(repoRoot, '.github', 'workflows');
const TIERS = 'deployedE2eTiers.yml';
const PR_PIPELINE = '_ci.yml';
const DOOR = 'deployedE2e.yml';
const WEB_JOB = 'e2e-web';
const SCRIPT = 'packages/apps/commise/web/scripts/previewCurrency.ts';
const SECRET = 'VERCEL_TOKEN';
const FORWARD = '${{ secrets.VERCEL_TOKEN }}';
/** The head commit on a pull request, the dispatched commit otherwise — the only commit a preview can be built from. */
const EXPECTED_SHA = '${{ github.event.pull_request.head.sha || github.sha }}';

interface Step {
    readonly name?: string;
    readonly if?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly 'continue-on-error'?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly uses?: string;
    readonly secrets?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

interface Workflow {
    readonly on?: { readonly workflow_call?: { readonly secrets?: Readonly<Record<string, unknown>> } };
    readonly jobs?: Readonly<Record<string, Job>>;
}

type Tree = ReadonlyMap<string, Workflow>;

const realTree = (): Tree =>
    new Map(
        readdirSync(WORKFLOW_DIR)
            .filter((file) => file.endsWith('.yml'))
            .map((file) => [file, parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as Workflow] as const),
    );

/** The currency step of the web tier, or undefined. Pure. */
function currencyStep(tiers: Workflow | undefined): Step | undefined {
    return (tiers?.jobs?.[WEB_JOB]?.steps ?? []).find((step) => (step.run ?? '').includes(SCRIPT));
}

/** Whether a step is one the currency check must come before: it signs in, loads secrets, seeds or runs the suite. */
const mustFollowTheCheck = (step: Step): boolean =>
    /awsAuth|load-secrets/u.test(step.uses ?? '') || /e2e-seed|test:e2e/u.test(step.run ?? '');

/**
 * What is wrong with the web tier's currency step. Pure.
 *
 * @param tiers - The parsed tiers workflow.
 * @returns One line per defect; empty when the step is present, unconditional, early and correctly fed.
 */
function currencyStepDefects(tiers: Workflow | undefined): readonly string[] {
    const steps = tiers?.jobs?.[WEB_JOB]?.steps ?? [];
    const step = currencyStep(tiers);

    if (step === undefined) {
        return [`${WEB_JOB} never runs ${SCRIPT}`];
    }

    const defects: string[] = [];
    const at = steps.indexOf(step);
    const firstGuarded = steps.findIndex(mustFollowTheCheck);

    if (step.if !== undefined) {
        defects.push(
            `the currency step is conditional (if: ${step.if}) — a skipped check claims the preview is current`,
        );
    }

    if (step['continue-on-error'] !== undefined && scalarText(step['continue-on-error']) !== 'false') {
        defects.push('the currency step has continue-on-error — its red would not stop the shard');
    }

    if (firstGuarded === -1 || at > firstGuarded) {
        defects.push(
            `the currency step runs after "${steps[firstGuarded]?.name ?? '(none)'}" — it must stop the shard before it signs in, seeds or tests`,
        );
    }

    const env = step.env ?? {};
    const expected: Readonly<Record<string, string>> = {
        EXPECTED_COMMIT_SHA: EXPECTED_SHA,
        PR_TOKEN: '${{ inputs.target_stage }}',
        WEB_ORIGIN: '${{ inputs.web_origin }}',
        VERCEL_TOKEN: FORWARD,
        VERCEL_PROJECT_ID: '${{ vars.VERCEL_PROJECT_ID }}',
    };

    for (const [key, value] of Object.entries(expected)) {
        if (scalarText(env[key]) !== value) {
            defects.push(`the currency step's ${key} is '${scalarText(env[key])}', expected '${value}'`);
        }
    }

    return defects;
}

/**
 * Every hop the Vercel token must cross to reach the step, and the ones that drop it. Pure.
 *
 * @param tree - The workflow tree, keyed by file name.
 * @returns One line per missing hop.
 */
function tokenForwardingDefects(tree: Tree): readonly string[] {
    const defects: string[] = [];
    const declares = (file: string): boolean => SECRET in (tree.get(file)?.on?.workflow_call?.secrets ?? {});
    const callsOf = (target: string): readonly (readonly [string, string, Job])[] =>
        [...tree].flatMap(([file, doc]) =>
            Object.entries(doc.jobs ?? {})
                .filter(([, job]) => job.uses === `./.github/workflows/${target}`)
                .map(([key, job]) => [file, key, job] as const),
        );

    for (const file of [TIERS, PR_PIPELINE]) {
        if (!declares(file)) {
            defects.push(`${file} does not declare the ${SECRET} secret`);
        }
    }

    const pipelineCallers = callsOf(PR_PIPELINE);

    if (pipelineCallers.length === 0) {
        defects.push(`nothing calls ${PR_PIPELINE} — the scan read nothing`);
    }

    for (const [file, key, job] of [...pipelineCallers, ...callsOf(TIERS)]) {
        if (scalarText(job.secrets?.[SECRET]) !== FORWARD) {
            defects.push(`${file}::${key} does not forward ${SECRET} to ${job.uses ?? ''}`);
        }
    }

    for (const door of [PR_PIPELINE, DOOR]) {
        if (!callsOf(TIERS).some(([file]) => file === door)) {
            defects.push(`${door} does not call ${TIERS}`);
        }
    }

    return defects;
}

describe('the deployed web tier proves its preview is current before it runs', () => {
    it('⛔ the real tiers file runs the check first, unconditionally, against the head commit', () => {
        expect(currencyStepDefects(realTree().get(TIERS))).toEqual([]);
    });

    it('⛔ the Vercel token reaches the check through every hop', () => {
        expect(tokenForwardingDefects(realTree())).toEqual([]);
    });

    it('⛔ fails closed, and names the secret, when the token is missing — executed, not read', () => {
        const step = currencyStep(realTree().get(TIERS));
        const outcome = runWorkflowStep(step?.run ?? 'exit 0', {
            VERCEL_TOKEN: '',
            WEB_ORIGIN: 'https://pr-91.sandbox.commise.app',
        });

        expect(outcome.status, outcome.log).not.toBe(0);
        expect(outcome.log).toMatch(/::error::.*VERCEL_TOKEN/u);
        // It stopped at the presence test: nothing was installed or fetched.
        expect(outcome.log).not.toMatch(/npx|tsx/u);
    });
});

describe('the analyzers, over trees that break each rule', () => {
    const webJob = (steps: string): string => ['jobs:', `    ${WEB_JOB}:`, '        steps:', steps].join('\n');

    const goodStep = (extra: readonly string[] = [], env: Readonly<Record<string, string>> = {}): string => {
        const fields = {
            EXPECTED_COMMIT_SHA: EXPECTED_SHA,
            PR_TOKEN: '${{ inputs.target_stage }}',
            WEB_ORIGIN: '${{ inputs.web_origin }}',
            VERCEL_TOKEN: FORWARD,
            VERCEL_PROJECT_ID: '${{ vars.VERCEL_PROJECT_ID }}',
            ...env,
        };

        return [
            '            - name: Check the preview',
            ...extra.map((line) => `              ${line}`),
            '              env:',
            ...Object.entries(fields).map(([key, value]) => `                  ${key}: '${value}'`),
            `              run: npx tsx ${SCRIPT}`,
        ].join('\n');
    };

    const signIn = '            - name: Sign in to AWS\n              uses: ./.github/actions/awsAuth';
    const suite = '            - name: Run the suite\n              run: npm run test:e2e --workspace=@commise/web';
    const tiersOf = (text: string): Workflow => parse(text) as Workflow;

    it('accepts the shape the real file must have', () => {
        expect(currencyStepDefects(tiersOf(webJob([goodStep(), signIn, suite].join('\n'))))).toEqual([]);
    });

    it.each([
        ['the step is missing', webJob([signIn, suite].join('\n')), /never runs/u],
        ['the step comes after the sign-in', webJob([signIn, goodStep(), suite].join('\n')), /runs after/u],
        [
            'the step is conditional',
            webJob([goodStep(["if: steps.secrets.outcome == 'success'"]), suite].join('\n')),
            /conditional/u,
        ],
        [
            'the step may fail green',
            webJob([goodStep(['continue-on-error: true']), suite].join('\n')),
            /continue-on-error/u,
        ],
        [
            'the step compares against the merge commit',
            webJob([goodStep([], { EXPECTED_COMMIT_SHA: '${{ github.sha }}' }), suite].join('\n')),
            /EXPECTED_COMMIT_SHA/u,
        ],
        [
            'the step reads another origin',
            webJob([goodStep([], { WEB_ORIGIN: '${{ inputs.recipe_origin }}' }), suite].join('\n')),
            /WEB_ORIGIN/u,
        ],
    ])('flags a tiers file where %s', (_label, text, defect) => {
        const defects = currencyStepDefects(tiersOf(text));

        expect(defects.length).toBeGreaterThan(0);
        expect(defects.join('\n')).toMatch(defect);
    });

    /** A minimal tree in which every hop forwards the token, with one file overridable. */
    const tree = (overrides: Readonly<Record<string, string>> = {}): Tree => {
        const call = (target: string): string =>
            [
                `        uses: ./.github/workflows/${target}`,
                '        secrets:',
                `            ${SECRET}: '${FORWARD}'`,
            ].join('\n');
        const files: Record<string, string> = {
            [TIERS]: `on:\n    workflow_call:\n        secrets:\n            ${SECRET}:\n                required: false\njobs: {}\n`,
            [PR_PIPELINE]: `on:\n    workflow_call:\n        secrets:\n            ${SECRET}:\n                required: false\njobs:\n    tiers:\n${call(TIERS)}\n`,
            'ci-pr.yml': `jobs:\n    ci:\n${call(PR_PIPELINE)}\n`,
            'ci-main.yml': `jobs:\n    ci:\n${call(PR_PIPELINE)}\n`,
            [DOOR]: `jobs:\n    tiers:\n${call(TIERS)}\n`,
            ...overrides,
        };

        return new Map(Object.entries(files).map(([file, text]) => [file, parse(text) as Workflow] as const));
    };

    it('accepts a tree in which every hop forwards the token', () => {
        expect(tokenForwardingDefects(tree())).toEqual([]);
    });

    it.each([
        [
            'a caller of _ci.yml drops it',
            { 'ci-main.yml': 'jobs:\n    ci:\n        uses: ./.github/workflows/_ci.yml\n' },
            /ci-main\.yml::ci/u,
        ],
        [
            '_ci.yml does not declare it',
            {
                [PR_PIPELINE]: `jobs:\n    tiers:\n        uses: ./.github/workflows/${TIERS}\n        secrets:\n            ${SECRET}: '${FORWARD}'\n`,
            },
            /_ci\.yml does not declare/u,
        ],
        [
            '_ci.yml does not forward it to the tiers',
            {
                [PR_PIPELINE]: `on:\n    workflow_call:\n        secrets:\n            ${SECRET}: {}\njobs:\n    tiers:\n        uses: ./.github/workflows/${TIERS}\n`,
            },
            /_ci\.yml::tiers does not forward/u,
        ],
        [
            'the manual door drops it',
            { [DOOR]: `jobs:\n    tiers:\n        uses: ./.github/workflows/${TIERS}\n` },
            /deployedE2e\.yml::tiers/u,
        ],
        [
            'the tiers file does not declare it',
            { [TIERS]: 'on:\n    workflow_call: {}\njobs: {}\n' },
            /deployedE2eTiers\.yml does not declare/u,
        ],
    ])('flags a tree where %s', (_label, overrides, defect) => {
        expect(tokenForwardingDefects(tree(overrides)).join('\n')).toMatch(defect);
    });
});
