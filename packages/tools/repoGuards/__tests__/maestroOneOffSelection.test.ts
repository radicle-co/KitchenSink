// @vitest-environment node
/**
 * Repo guard: how the Maestro runner takes the staged one-off flows (`maestro:lanes --one-off`).
 *
 * A one-off has no row in the runner's flow registry, so run mode cannot select it. Instead the door hands the lane
 * `MAESTRO_ONE_OFF_FLOWS` (the staged ids), and `runMaestroFlows.sh one-off-selection` turns them into the same
 * `flow=` lines the registry selection prints, after checking each id is a staged name and its file is there.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const FLOW_DIR = 'packages/apps/commise/mobile/.maestro';

const scratch: string[] = [];

afterEach(() => {
    for (const dir of scratch.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** A working directory holding the staged files given, as the door would leave them. */
function cwdWith(...ids: string[]): string {
    const cwd = mkdtempSync(join(tmpdir(), 'oneOffSel-'));
    scratch.push(cwd);

    for (const id of ids) {
        const file = join(cwd, FLOW_DIR, `${id}.yaml`);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, '- launchApp\n');
    }

    return cwd;
}

function selection(
    cwd: string,
    ids: string,
    shard = { index: 1, count: 1 },
): { code: number | null; stdout: string; stderr: string } {
    const result = spawnSync('bash', [SCRIPT, 'one-off-selection'], {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            MAESTRO_PLATFORM: 'android',
            MAESTRO_ONE_OFF_FLOWS: ids,
            MAESTRO_SHARD_INDEX: String(shard.index),
            MAESTRO_SHARD_COUNT: String(shard.count),
        },
    });

    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('runMaestroFlows.sh one-off-selection', () => {
    it('prints each staged flow as a flow= line, in the order given', () => {
        const cwd = cwdWith('oneOff/run1/shots', 'oneOff/run1/more');
        const out = selection(cwd, 'oneOff/run1/shots oneOff/run1/more');

        expect(out.code).toBe(0);
        expect(out.stdout.split('\n').filter((line) => line.startsWith('flow='))).toEqual([
            'flow=oneOff/run1/shots',
            'flow=oneOff/run1/more',
        ]);
        expect(out.stdout).toMatch(/^selection-reason=/mu);
        expect(out.stdout).toMatch(/^shard-reason=/mu);
    });

    it('gives each lane its own share of the ids, and together the lanes run every one once', () => {
        const ids = ['oneOff/run1/a', 'oneOff/run1/b', 'oneOff/run1/c'];
        const cwd = cwdWith(...ids);
        const shares = [1, 2].map((index) => {
            const out = selection(cwd, ids.join(' '), { index, count: 2 });

            expect(out.code, out.stderr).toBe(0);

            return out.stdout
                .split('\n')
                .filter((line) => line.startsWith('flow='))
                .map((line) => line.slice(5));
        });

        expect(shares.every((share) => share.length > 0)).toBe(true);
        expect(shares.flat().sort()).toEqual(ids);
    });

    it('refuses a staged id whose file is missing, names it, and prints nothing on stdout', () => {
        const out = selection(cwdWith('oneOff/run1/shots'), 'oneOff/run1/shots oneOff/run1/gone');

        expect(out.code).toBe(2);
        expect(out.stderr).toContain('oneOff/run1/gone');
        expect(out.stdout).toBe('');
    });

    it.each([
        'recipes/rating',
        '../x',
        'oneOff/run1',
        'oneOff/run1/a/b',
        'oneOff/run1/.hidden',
        'oneOff/../shots',
        'oneOff/../recipes/rating',
        'oneOff/run1/../rating',
    ])('refuses the id %j, which is not a staged name, even when a committed file answers to it', (id) => {
        const out = selection(cwdWith('recipes/rating', 'oneOff/run1/placeholder'), id);

        expect(out.code).toBe(2);
        expect(out.stderr).toContain(id);
    });

    it.each(['', '  '])('refuses the empty list %j rather than run nothing, with nothing on stdout', (ids) => {
        const out = selection(cwdWith(), ids);

        expect(out.code).toBe(2);
        expect(out.stdout).toBe('');
    });
});

describe('run mode', () => {
    it('takes its flows from one-off-selection, and not from the registry, when MAESTRO_ONE_OFF_FLOWS is set', () => {
        const script = readFileSync(SCRIPT, 'utf8');
        const runFlows = script.slice(script.indexOf('maestro_run_flows() {'));

        expect(runFlows).toMatch(/MAESTRO_ONE_OFF_FLOWS[\s\S]{0,200}maestro_one_off_selection/u);
    });
});

describe('the runner packer over one-off ids', () => {
    const pack = (index: number, count: number): { code: number | null; stdout: string; stderr: string } => {
        const result = spawnSync(
            'bash',
            [
                SCRIPT,
                'pack',
                'android',
                String(index),
                String(count),
                'oneOff/run1/a',
                'oneOff/run1/b',
                'oneOff/run1/c',
            ],
            { encoding: 'utf8' },
        );

        return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    };

    it('gives every lane its own non-empty share and loses none, so the door can pack them like any flows', () => {
        const shares = [1, 2].map((index) => {
            const out = pack(index, 2);

            expect(out.code, out.stderr).toBe(0);

            return out.stdout
                .split('\n')
                .filter((line) => line.startsWith('flow='))
                .map((line) => line.slice(5));
        });

        expect(shares.every((share) => share.length > 0)).toBe(true);
        expect(shares.flat().sort()).toEqual(['oneOff/run1/a', 'oneOff/run1/b', 'oneOff/run1/c']);
    });
});
