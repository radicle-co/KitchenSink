// @vitest-environment node
/**
 * A workflow may not reference a step-scoped context outside a job's `steps:`.
 *
 * ## The defect this was written for
 *
 * `_ci.yml` carried, in a JOB-LEVEL `env:` block:
 *
 * ```yaml
 *     LINKAGE_CREDENTIALS: ${{ runner.temp }}/linkage/linkage-credentials.json
 * ```
 *
 * The `runner` context does not exist until a runner has been assigned to a job, so it is unavailable at
 * job level. GitHub does not warn and does not skip the job — **it refuses to LOAD the workflow file**. The
 * run is created, reports "This run likely failed because of a workflow file issue", and contains **zero
 * jobs**.
 *
 * ⛔ That failure mode is why this needs a gate rather than a fix. Every check the pipeline would have
 * published simply never existed, so the PR showed no red test, no failing lint, no missing coverage —
 * nothing to click into. `chore/code-quality-enforcement-phase-1-2` ran that way for **three days and
 * fifteen implementation units**, from 2026-08-19 20:12 (the commit that introduced the line) to
 * 2026-08-22, with **every** `ci-pr` run failing at startup and nobody's status page showing a failure that
 * pointed at a cause. Absence of work is not distinguishable from success on a PR page; only the run's own
 * job count says so.
 *
 * ## The rule, and why it is narrow on purpose
 *
 * Context availability varies per key — `matrix` is legal in a job's `env:` but not in its own `strategy:`,
 * `needs` is legal in `if:` but not in `runs-on:` of the job it belongs to, and so on. Encoding that whole
 * matrix would be a second, drifting copy of GitHub's documentation.
 *
 * So this asserts only the part that is unconditional: **`runner`, `steps`, `env` and `job` are NEVER
 * available anywhere outside a job's `steps:` list.** Each is scoped to a running step or a running job, and
 * none of them can be resolved at the moment the workflow is parsed. A narrow rule with no false positives
 * survives; a broad one gets a blanket ignore added to it.
 *
 * ⚠️ It is not a substitute for `actionlint`, which knows the full matrix. It is the part of `actionlint`
 * that can run with no binary to install, aimed at the one mistake that costs a silent pipeline.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link jobLevelContextViolations} is a verdict
 * over parsed workflow data, fired at a deliberately-violating fake as well as at every committed workflow.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { presentFiles, repoRoot } from './serviceSources.js';

/** Contexts that exist only once a job (or a step within it) is RUNNING, so never at parse time. */
const STEP_SCOPED_CONTEXTS = ['runner', 'steps', 'env', 'job'] as const;

/**
 * Job-level keys evaluated LATE — while or after the job runs — where every context is legally available.
 *
 * `steps` is the obvious one. `outputs` is the one that makes this a set rather than a special case: a job
 * output is resolved when the job FINISHES, so `${{ steps.detect.outputs.mobile }}` is both legal and the
 * documented way to publish a step's result (`heavy-e2e.yml`'s `detect` job does it seven times). A gate
 * that reported those would be answered with an ignore rule and would then stop catching the real thing.
 */
const EVALUATED_WHILE_RUNNING = new Set(['steps', 'outputs']);

/** One illegal context reference. */
interface ContextViolation {
    /** Repo-relative workflow path. */
    readonly file: string;
    /** The job that carries it. */
    readonly job: string;
    /** Dotted path to the offending value within the job, e.g. `env.LINKAGE_CREDENTIALS`. */
    readonly at: string;
    /** The context that is not available there. */
    readonly context: string;
}

/** Every `${{ … }}` expression body inside a string. Pure. */
function expressions(value: string): readonly string[] {
    return [...value.matchAll(/\$\{\{(.*?)\}\}/gsu)].map((match) => match[1] ?? '');
}

/**
 * Walk a job's configuration — everything EXCEPT its `steps:` — reporting illegal context references.
 *
 * @param file - Repo-relative workflow path, for reporting.
 * @param job - The job's key, for reporting.
 * @param node - The job object, or a subtree of it.
 * @param at - Dotted path accumulated so far.
 * @returns One entry per illegal reference. Pure.
 */
function walkJob(file: string, job: string, node: unknown, at: string): readonly ContextViolation[] {
    if (typeof node === 'string') {
        return expressions(node).flatMap((expression) =>
            STEP_SCOPED_CONTEXTS.filter((context) =>
                new RegExp(String.raw`(^|[^.\w])${context}\s*\.`, 'u').test(expression),
            ).map((context) => ({ file, job, at, context })),
        );
    }

    if (Array.isArray(node)) {
        return node.flatMap((item, index) => walkJob(file, job, item, `${at}[${index}]`));
    }

    if (typeof node === 'object' && node !== null) {
        return Object.entries(node).flatMap(([key, value]) =>
            EVALUATED_WHILE_RUNNING.has(key) && at === ''
                ? []
                : walkJob(file, job, value, at === '' ? key : `${at}.${key}`),
        );
    }

    return [];
}

/**
 * Illegal job-level context references across a set of parsed workflows.
 *
 * @param workflows - Repo-relative path paired with the parsed document.
 * @returns One entry per violation, sorted. Pure.
 */
export function jobLevelContextViolations(
    workflows: readonly { readonly file: string; readonly document: unknown }[],
): readonly ContextViolation[] {
    return workflows
        .flatMap(({ file, document }) => {
            const jobs = (document as { jobs?: Record<string, unknown> } | null)?.jobs ?? {};

            return Object.entries(jobs).flatMap(([job, config]) => walkJob(file, job, config, ''));
        })
        .sort((a, b) => `${a.file}:${a.job}:${a.at}`.localeCompare(`${b.file}:${b.job}:${b.at}`));
}

/**
 * Every committed workflow, parsed.
 *
 * @returns Repo-relative path paired with the parsed document.
 * @sideEffect Shells out to git and reads the working tree.
 */
function committedWorkflows(): readonly { file: string; document: unknown }[] {
    return presentFiles(['.github/workflows'])
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map((file) => ({ file, document: parse(readFileSync(path.join(repoRoot, file), 'utf8')) as unknown }));
}

describe('workflow context availability', () => {
    it('keeps step-scoped contexts inside steps', () => {
        const workflows = committedWorkflows();

        expect(workflows.length, 'no workflow found — the gate has stopped discovering').toBeGreaterThan(0);

        expect(
            jobLevelContextViolations(workflows),
            'GitHub does not warn about these — it refuses to LOAD the workflow, so the run reports "a ' +
                'workflow file issue" and contains ZERO jobs. Every check the pipeline would publish is then ' +
                'absent rather than red, which on a PR page is indistinguishable from success.',
        ).toEqual([]);
    });

    it('reports a job-level reference and ignores the same context inside a step', () => {
        const fake = {
            file: 'fake.yml',
            document: {
                jobs: {
                    bad: {
                        env: { CREDS: '${{ runner.temp }}/creds.json' },
                        steps: [{ run: 'echo ${{ runner.temp }}', with: { key: '${{ runner.os }}-node' } }],
                    },
                    good: {
                        'runs-on': 'ubuntu-latest',
                        if: "${{ github.event_name == 'push' }}",
                        env: { STAGE: '${{ inputs.stage }}', SHARD: '${{ matrix.shard }}' },
                        // Resolved when the job FINISHES, so every context is available here.
                        outputs: { mobile: '${{ steps.detect.outputs.mobile }}' },
                        steps: [{ run: 'echo ${{ steps.mint.outputs.path }}' }],
                    },
                },
            },
        };

        expect(jobLevelContextViolations([fake])).toEqual([
            { file: 'fake.yml', job: 'bad', at: 'env.CREDS', context: 'runner' },
        ]);
    });

    it('does not fire on a word that merely ends in a context name', () => {
        // `steps.secrets.outcome` is legal INSIDE a step, and `_ci.yml` uses a step id called `secrets`;
        // a gate matching bare substrings would report both, get an ignore comment, and stop working.
        const fake = {
            file: 'fake.yml',
            document: { jobs: { j: { env: { A: '${{ github.job }}', B: '${{ needs.build.outputs.env }}' } } } },
        };

        expect(jobLevelContextViolations([fake])).toEqual([]);
    });
});
