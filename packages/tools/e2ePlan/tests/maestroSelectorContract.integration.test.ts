/**
 * Contract: the selector keys `maestroSelector` writes are the keys the real Maestro runner reads.
 *
 * It EXECUTES `runMaestroFlows.sh` (`select`), so a rename of a flow, or a change to the key syntax on
 * either side, fails here and not on a runner. What it proves: every flow id the runner plans is accepted as a
 * `flow:<id>=true` key and selects exactly that flow plus the spine, and an id that no flow has widens to everything
 * (the runner's fail-safe), so a typo cannot narrow a run.
 * What it does not prove: that the selector picks the right flows (the e2ePlan suites do), or run mode on a device.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { maestroSelector } from '../src/ciMatrix.js';

const RUNNER = resolve(import.meta.dirname, '../../../apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

const runner = (...args: string[]): string[] => {
    const result = spawnSync('bash', [RUNNER, ...args], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', MAESTRO_PLATFORM: 'android' },
    });

    return result.stdout.split('\n').filter((line) => line !== '');
};

const valuesOf = (lines: readonly string[], key: string): string[] =>
    lines.filter((line) => line.startsWith(`${key}=`)).map((line) => line.slice(key.length + 1));

// `select` with no key is the whole plan: the runner's own answer to "every flow".
const planned = valuesOf(runner('select'), 'flow');
const spine = ['auth/loginFlow'];

describe('maestroSelector against the real runner', () => {
    it('finds flows to select (a vacuous plan would pass every case below)', () => {
        expect(planned.length).toBeGreaterThan(10);
        expect(planned).toContain('home');
    });

    it('selects exactly the named flow and the spine, for every planned flow', () => {
        const wrong = planned.flatMap((id) => {
            const selector = maestroSelector({ kind: 'some', ids: [id] });
            const flows = valuesOf(runner('select', ...selector.split(' ')), 'flow');
            const expected = [...new Set([...spine, id])];

            return JSON.stringify(flows) === JSON.stringify(expected) ? [] : [`${id}: ${flows.join(',')}`];
        });

        expect(wrong).toEqual([]);
    }, 120_000);

    it('runs every flow for an id that no flow has, instead of narrowing to nothing', () => {
        const flows = valuesOf(
            runner('select', ...maestroSelector({ kind: 'some', ids: ['nope/missing'] }).split(' ')),
            'flow',
        );

        expect(flows).toEqual(planned);
    });

    it('runs every flow for the empty selector of the whole suite', () => {
        expect(valuesOf(runner('select'), 'flow')).toEqual(planned);
    });
});
