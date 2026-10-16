// @vitest-environment node
/**
 * A deploy gate that a pull request reaches must not ask GitHub's capped "list pull request files" API.
 *
 * ## The failure this was written after
 *
 * On a `pull_request` event, `dorny/paths-filter` asks that API for the changed files whenever it has a token, and
 * the API returns AT MOST 3000 files in path order. PR #91 grew past that, so `packages/infra/**` and
 * `packages/services/**` fell off the end of the list. `sandbox-identity-deploy.yml` then answered "nothing changed"
 * for all three of its legs, deployed nothing, and ran the migrate step against the runner it already had. The
 * manifest check refused it (`SchemaManifestMismatchError`, runner on 0004–0017, tree on 0018), so the failure was
 * loud there. `sandboxPreview.yml`'s gate has no such backstop: a missed match keeps an old build serving a preview,
 * which is the stale-preview class `deployedSmoke.ts` records for `pr-73`.
 *
 * The action has an uncapped path of its own. With `token: ''` it diffs the pull-request base against the checked-out
 * commit with git, so the filter lists stay where `deployLegsWatchTheirLibraries.test.ts` reads them. Git mode needs
 * the base commit locally, so the job's checkout takes the full history (`fetch-depth: 0`).
 *
 * `_ci.yml`'s `infra-shared` publish gate met the same cap first and moved to a hand-written git diff
 * (`sharedInfraPublishGate.test.ts`). The mobile-flow detector stays on the API by decision: a missed match there
 * attributes no vertical, and `runMaestroFlows.sh` then runs the whole suite, so the cap costs only runner minutes.
 *
 * DESIGN PATTERN: Specification module — a pure verdict over each workflow's own text, held by a fixture table and
 * then applied to the tree.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflowsDir = path.join(repoRoot, '.github/workflows');

interface Step {
    readonly id?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly steps?: readonly Step[];
}

interface Workflow {
    readonly on: unknown;
    readonly jobs: Readonly<Record<string, Job>>;
}

/** Triggers under which `github.event_name` can be `pull_request`. A called workflow inherits its caller's event. */
const PULL_REQUEST_REACHABLE = new Set(['pull_request', 'pull_request_target', 'workflow_call']);

/**
 * Filters that stay on the capped API by decision, keyed `<workflow file>#<job>`, each with the reason a missed match
 * is harmless there.
 */
const CAPPED_BY_DECISION: Readonly<Record<string, string>> = {
    '_ci.yml#detect-mobile-flows':
        'a missed match attributes no vertical, and runMaestroFlows.sh then runs the whole suite — never less coverage',
};

/**
 * The trigger names of a workflow's `on:` block, in any of its three YAML shapes.
 *
 * @param on - The parsed `on:` value.
 * @returns The trigger names. Pure.
 */
function triggersOf(on: unknown): readonly string[] {
    if (typeof on === 'string') {
        return [on];
    }

    if (Array.isArray(on)) {
        return on.filter((trigger): trigger is string => typeof trigger === 'string');
    }

    if (on !== null && typeof on === 'object') {
        return Object.keys(on);
    }

    return [];
}

/**
 * Why one job's `dorny/paths-filter` step would read the capped API on a pull request, or `undefined` when it cannot.
 *
 * @param triggers - The workflow's trigger names.
 * @param job - The job that holds the step.
 * @param step - The `dorny/paths-filter` step.
 * @returns The defect, or `undefined`. Pure.
 */
function cappedApiDefect(triggers: readonly string[], job: Job, step: Step): string | undefined {
    if (!triggers.some((trigger) => PULL_REQUEST_REACHABLE.has(trigger))) {
        return undefined;
    }

    if (step.with?.['token'] !== '') {
        return "a pull request reaches it with a token, so it reads the 3000-file API; set `token: ''` to diff with git";
    }

    // The checkout that feeds the filter is the last one before it.
    const steps = job.steps ?? [];
    const checkout = steps
        .slice(0, steps.indexOf(step))
        .findLast((candidate) => (candidate.uses ?? '').startsWith('actions/checkout@'));

    if (String(checkout?.with?.['fetch-depth']) !== '0') {
        return 'git mode needs the pull-request base locally; check out with `fetch-depth: 0`';
    }

    return undefined;
}

const FILTER = 'dorny/paths-filter@0e4a8c6effa4802afeda77dc8d303f8176d7dfad';
const FULL_CHECKOUT: Step = { uses: 'actions/checkout@sha', with: { 'fetch-depth': 0 } };
const SHALLOW_CHECKOUT: Step = { uses: 'actions/checkout@sha', with: { 'persist-credentials': false } };

describe('cappedApiDefect — the rule, over shapes the tree does and does not hold', () => {
    it.each([
        {
            shape: 'pull_request trigger, token defaulted',
            triggers: ['pull_request'],
            steps: [FULL_CHECKOUT, { uses: FILTER, with: { filters: 'x' } }],
            defective: true,
        },
        {
            shape: 'called workflow (inherits pull_request), token defaulted',
            triggers: ['workflow_call'],
            steps: [FULL_CHECKOUT, { uses: FILTER, with: { filters: 'x' } }],
            defective: true,
        },
        {
            shape: 'pull_request_target trigger, token defaulted',
            triggers: ['pull_request_target'],
            steps: [FULL_CHECKOUT, { uses: FILTER }],
            defective: true,
        },
        {
            shape: "token: '' but a shallow checkout",
            triggers: ['pull_request'],
            steps: [SHALLOW_CHECKOUT, { uses: FILTER, with: { token: '' } }],
            defective: true,
        },
        {
            shape: "token: '' and fetch-depth: 0",
            triggers: ['pull_request', 'workflow_dispatch'],
            steps: [FULL_CHECKOUT, { uses: FILTER, with: { token: '' } }],
            defective: false,
        },
        {
            shape: "fetch-depth given as the string '0'",
            triggers: ['workflow_call'],
            steps: [
                { uses: 'actions/checkout@sha', with: { 'fetch-depth': '0' } },
                { uses: FILTER, with: { token: '' } },
            ],
            defective: false,
        },
        {
            shape: 'a full checkout AFTER the filter, a shallow one before it',
            triggers: ['pull_request'],
            steps: [SHALLOW_CHECKOUT, { uses: FILTER, with: { token: '' } }, FULL_CHECKOUT],
            defective: true,
        },
        {
            shape: 'a full checkout, then a shallow one that feeds the filter',
            triggers: ['pull_request'],
            steps: [FULL_CHECKOUT, SHALLOW_CHECKOUT, { uses: FILTER, with: { token: '' } }],
            defective: true,
        },
        {
            shape: 'push-only workflow (the action uses git there anyway)',
            triggers: ['push', 'workflow_dispatch'],
            steps: [SHALLOW_CHECKOUT, { uses: FILTER }],
            defective: false,
        },
    ])('$shape → defective: $defective', ({ triggers, steps, defective }) => {
        const filter = steps.find((step) => step.uses === FILTER) as Step;

        expect(cappedApiDefect(triggers, { steps }, filter) !== undefined).toBe(defective);
    });

    it('reads every shape of `on:`', () => {
        expect(triggersOf('pull_request')).toEqual(['pull_request']);
        expect(triggersOf(['push', 'pull_request'])).toEqual(['push', 'pull_request']);
        expect(triggersOf({ workflow_call: null, push: {} })).toEqual(['workflow_call', 'push']);
        expect(triggersOf(undefined)).toEqual([]);
    });
});

describe('every pull-request-reachable paths filter in the tree answers from git', () => {
    const filters = readdirSync(workflowsDir)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const workflow = parse(readFileSync(path.join(workflowsDir, file), 'utf8')) as Workflow;

            return Object.entries(workflow.jobs).flatMap(([jobName, job]) =>
                (job.steps ?? [])
                    .filter((step) => (step.uses ?? '').startsWith('dorny/paths-filter@'))
                    .map((step) => ({ key: `${file}#${jobName}`, triggers: triggersOf(workflow.on), job, step })),
            );
        });

    it('is not vacuous: the two deploy gates are among the filters found', () => {
        const keys = filters.map((filter) => filter.key);

        expect(keys).toContain('sandbox-identity-deploy.yml#deploy');
        expect(keys).toContain('sandboxPreview.yml#gate');
    });

    it('has no defect outside the decided exceptions', () => {
        const defects = filters
            .filter((filter) => !(filter.key in CAPPED_BY_DECISION))
            .map((filter) => ({ key: filter.key, defect: cappedApiDefect(filter.triggers, filter.job, filter.step) }))
            .filter((found) => found.defect !== undefined);

        expect(defects).toEqual([]);
    });

    it('lists no exception that the tree no longer holds', () => {
        const keys = new Set(filters.map((filter) => filter.key));

        expect(Object.keys(CAPPED_BY_DECISION).filter((key) => !keys.has(key))).toEqual([]);
    });
});
