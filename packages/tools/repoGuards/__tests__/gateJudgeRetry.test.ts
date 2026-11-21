// @vitest-environment node
/**
 * Repo-wide guard: **`gate.yml` retries the judge once, and only when the judge finished but gave no structured result.**
 *
 * The judge (`anthropics/claude-code-action` with `--json-schema`) sometimes ends in a prose report and never calls the
 * structured output tool. The action then fails the step with "--json-schema was provided but Claude did not return
 * structured_output. Result subtype: success", and the GATE posted `failure` on 7 of 7 sampled runs. The fix has two
 * parts: the prompt's closing paragraph says the final action MUST be the structured output, and the `retry` step
 * reads the action's execution file and allows ONE more judge run for exactly that shape. Every other failure (a
 * timeout, `error_max_turns`, an error result, a missing file) stays fail-closed with no retry (ADR-0098 decision 6).
 *
 * The retry rule is a `jq` filter held in the `retry` step's `env`, so this test runs the very text CI runs against
 * fixtures of the execution file. Nothing else about the model can be proved offline: see the PR for the live runs.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const GATE_YML = path.join(repoRoot, '.github/workflows/gate.yml');

interface Step {
    readonly id?: string;
    readonly name?: string;
    readonly if?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly env?: Record<string, string>;
    readonly with?: Record<string, string>;
    readonly 'continue-on-error'?: boolean;
}

const steps: readonly Step[] = (parse(readFileSync(GATE_YML, 'utf8')) as { jobs: { gate: { steps: Step[] } } }).jobs
    .gate.steps;

const step = (id: string): Step => {
    const found = steps.find((candidate) => candidate.id === id);

    if (found === undefined) {
        throw new Error(`gate.yml has no step with id ${id}`);
    }

    return found;
};

const judgeSteps = steps.filter((candidate) => candidate.uses?.startsWith('anthropics/claude-code-action@'));

const dirs: string[] = [];

afterAll(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** Whether the `retry` step's filter allows a retry for this execution file text; a missing file is `undefined`. */
function retryAllowed(executionFile: string | undefined): boolean {
    const filter = step('retry').env?.['RETRY_FILTER'];

    if (filter === undefined) {
        throw new Error('the retry step has no RETRY_FILTER');
    }

    const dir = mkdtempSync(path.join(tmpdir(), 'gateJudgeRetry-'));
    dirs.push(dir);
    const file = path.join(dir, 'claude-execution-output.json');

    if (executionFile !== undefined) {
        writeFileSync(file, executionFile);
    }

    return spawnSync('/usr/bin/jq', ['-e', filter, file], { encoding: 'utf8' }).status === 0;
}

const result = (fields: Record<string, unknown>): string =>
    JSON.stringify([{ type: 'system', subtype: 'init' }, { type: 'assistant' }, { type: 'result', ...fields }]);

describe('gate.yml judge retry', () => {
    it('runs the judge action exactly twice: the judge and one retry, never a loop', () => {
        expect(judgeSteps.map((candidate) => candidate.id)).toEqual(['judge', 'judge-retry']);
    });

    it('lets the job reach the retry: the first judge may fail without ending the job', () => {
        expect(step('judge')['continue-on-error']).toBe(true);
    });

    it('retries only when the retry step says so, and only after the first judge failed', () => {
        const condition = step('judge-retry').if ?? '';

        expect(condition).toContain("steps.retry.outputs.retry == 'true'");
        expect(step('retry').if ?? '').toContain("steps.judge.outcome == 'failure'");
    });

    it('does not start a judge for a run a newer push cancelled: both new steps use !cancelled(), not always()', () => {
        for (const id of ['retry', 'judge-retry']) {
            // Mutation: always() would run a full model judge for a head nobody waits for.
            expect(step(id).if, id).toContain('!cancelled()');
            expect(step(id).if, id).not.toContain('always()');
        }
    });

    it('gives both judge steps the same action, tools, model, schema and trust settings', () => {
        const [first, second] = judgeSteps;

        expect(second?.uses).toBe(first?.uses);
        expect(second?.with?.['claude_args']).toBe(first?.with?.['claude_args']);
        expect(second?.with?.['allowed_non_write_users']).toBe(first?.with?.['allowed_non_write_users']);
        expect(second?.with?.['claude_code_oauth_token']).toBe(first?.with?.['claude_code_oauth_token']);
    });

    it('keeps the retry prompt equal to the judge prompt plus one closing paragraph', () => {
        const first = (judgeSteps[0]?.with?.['prompt'] ?? '').trimEnd();
        const second = (judgeSteps[1]?.with?.['prompt'] ?? '').trimEnd();

        expect(first.length).toBeGreaterThan(0);
        expect(second.startsWith(first)).toBe(true);
        expect(second.length).toBeGreaterThan(first.length);
    });

    it('ends the judge prompt by requiring the structured output, so prose alone is a failed GATE', () => {
        const prompt = judgeSteps[0]?.with?.['prompt'] ?? '';
        const closing =
            prompt
                .trimEnd()
                .split(/\n\s*\n/u)
                .at(-1) ?? '';

        expect(closing).toMatch(/final\s+action\s+MUST\s+be\s+the\s+structured\s+output/u);
        expect(closing).toMatch(/prose\s+report\s+alone/u);
    });

    it('reads the retry answer in the verdict step through env, never an expression inside run', () => {
        const verdict = step('verdict');

        for (const name of ['STRUCTURED_OUTPUT', 'JUDGE_OUTCOME']) {
            const value = verdict.env?.[name] ?? '';

            expect(value, name).toContain('judge-retry');
            expect(value, name).toContain('steps.judge.');
        }

        for (const id of ['retry', 'verdict']) {
            expect(step(id).run ?? '', `${id} run`).not.toContain('${{');
        }
    });

    describe('the retry filter', () => {
        it('retries a judge that finished with a success result and no structured output', () => {
            expect(retryAllowed(result({ subtype: 'success', is_error: false, num_turns: 16 }))).toBe(true);
        });

        it('does not retry a result that has the structured output', () => {
            expect(
                retryAllowed(
                    result({
                        subtype: 'success',
                        is_error: false,
                        structured_output: { verdict: 'PASS', findings: [] },
                    }),
                ),
            ).toBe(false);
        });

        it.each(['error_max_turns', 'error_during_execution', 'error_max_structured_output_retries'])(
            'does not retry %s',
            (subtype) => {
                expect(retryAllowed(result({ subtype, is_error: true }))).toBe(false);
            },
        );

        it('does not retry a success result that reports is_error', () => {
            expect(retryAllowed(result({ subtype: 'success', is_error: true }))).toBe(false);
        });

        it('does not retry a run with no result entry, an empty file or a missing file', () => {
            expect(retryAllowed(JSON.stringify([{ type: 'system', subtype: 'init' }]))).toBe(false);
            expect(retryAllowed('[]')).toBe(false);
            expect(retryAllowed(undefined)).toBe(false);
        });

        it('reads the last result entry, not an earlier one', () => {
            const earlier = { type: 'result', subtype: 'success', is_error: false };
            const later = { type: 'result', subtype: 'error_max_turns', is_error: true };

            expect(retryAllowed(JSON.stringify([earlier, later]))).toBe(false);
        });
    });
});
