// @vitest-environment node
/**
 * `stackCurrency.sh decide`: is ONE deployed stack already what this commit would deploy? (ADR-0067)
 *
 * A stack is CURRENT only when all three hold: it is in a usable resting state (`deployGate.sh`'s own list, the one
 * authority), its deployed template equals the freshly synthesized one (`cdk diff --method=template --fail` exited 0),
 * and every SSM parameter it resolved at deploy time still holds the value it resolved. Anything else is STALE and
 * deploys, including an answer the gate could not read: ADR-0010's bias is toward deploying, never toward a skip
 * behind a green check.
 *
 * Executed for real: the cases run THIS script, never a re-implementation.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github', 'scripts', 'stackCurrency.sh');

const decide = (...args: string[]) => spawnSync('bash', [SCRIPT, 'decide', ...args], { encoding: 'utf8' });

const verdict = (...args: string[]): string => {
    const result = decide(...args);

    expect(result.status, result.stderr).toBe(0);

    return result.stdout;
};

describe('stackCurrency.sh decide', () => {
    it('answers current for a usable stack whose template and resolved parameters are unchanged', () => {
        expect(verdict('UPDATE_COMPLETE', '0', '/kitchensink/sandbox/a', 'x', 'x')).toBe(
            'current=true\nreason=unchanged\n',
        );
    });

    it('answers current with no SSM parameters at all', () => {
        expect(verdict('CREATE_COMPLETE', '0')).toContain('current=true\n');
    });

    it('treats a rolled-back update as current: the stack is intact at its previous revision', () => {
        expect(verdict('UPDATE_ROLLBACK_COMPLETE', '0')).toContain('current=true\n');
    });

    it.each([
        ['the stack is absent', 'ABSENT', '0', 'absent'],
        ['a failed rollback', 'UPDATE_ROLLBACK_FAILED', '0', 'UPDATE_ROLLBACK_FAILED'],
        ['an update still in progress', 'UPDATE_IN_PROGRESS', '0', 'UPDATE_IN_PROGRESS'],
        ['a create that never succeeded', 'ROLLBACK_COMPLETE', '0', 'ROLLBACK_COMPLETE'],
        ['the template differs', 'UPDATE_COMPLETE', '1', 'template'],
        ['the diff itself failed', 'UPDATE_COMPLETE', '2', 'diff'],
    ])('answers stale when %s', (_label, status, diffExit, reason) => {
        const out = verdict(status, diffExit);

        expect(out).toContain('current=false\n');
        expect(out).toContain(reason);
    });

    it('answers stale when an SSM parameter now holds a different value, and names it', () => {
        const out = verdict(
            'UPDATE_COMPLETE',
            '0',
            '/kitchensink/sandbox/a',
            'x',
            'x',
            '/kitchensink/sandbox/b',
            'x',
            'y',
        );

        expect(out).toContain('current=false\n');
        expect(out).toContain('/kitchensink/sandbox/b');
    });

    it('answers stale when an SSM parameter could not be read (an empty current value)', () => {
        expect(verdict('UPDATE_COMPLETE', '0', '/kitchensink/sandbox/a', 'x', '')).toContain('current=false\n');
    });

    it.each([
        ['no arguments', []],
        ['no diff exit', ['UPDATE_COMPLETE']],
        ['a non-numeric diff exit', ['UPDATE_COMPLETE', 'yes']],
        ['an SSM parameter without both values', ['UPDATE_COMPLETE', '0', '/kitchensink/sandbox/a', 'x']],
    ])('refuses %s with the usage status and no verdict', (_label, args) => {
        const result = decide(...(args as string[]));

        expect(result.status).toBe(2);
        expect(result.stdout).toBe('');
    });
});
