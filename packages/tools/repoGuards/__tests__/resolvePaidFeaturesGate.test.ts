// @vitest-environment node
/**
 * `.github/scripts/resolvePaidFeaturesGate.sh` — the one way a deploy path turns the owner's two GitHub variables
 * (`PAID_FEATURES_GATE_SANDBOX`, `PAID_FEATURES_GATE_PROD`) into the `PAID_FEATURES_GATE` identity's CDK app reads at
 * synth (plan 2026-10-14-009 D9). Run as the real script, so the stage mapping and the fail-closed default are its
 * own.
 *
 * Owner ruling 2026-10-13: both variables stay `false` and the owner alone flips them. So an unset, empty or
 * misspelt variable must resolve to `false` — the direction that shows no upsell.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/resolvePaidFeaturesGate.sh');

/**
 * Run the script with the given variables.
 *
 * @param args - The script's arguments.
 * @param vars - The two gate variables as the workflow passes them (absent = not set in the environment).
 * @returns The exit status and what the script exported.
 * @sideEffect Writes a temp directory.
 */
function run(
    args: readonly string[],
    vars: { readonly sandbox?: string; readonly prod?: string } = {},
): { readonly status: number | null; readonly exported: string } {
    const directory = mkdtempSync(path.join(tmpdir(), 'paid-gate-'));
    const envFile = path.join(directory, 'github_env');

    writeFileSync(envFile, '');

    const result = spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: {
            PATH: process.env['PATH'] ?? '',
            GITHUB_ENV: envFile,
            ...(vars.sandbox === undefined ? {} : { PAID_FEATURES_GATE_SANDBOX: vars.sandbox }),
            ...(vars.prod === undefined ? {} : { PAID_FEATURES_GATE_PROD: vars.prod }),
        },
    });

    return { status: result.status, exported: readFileSync(envFile, 'utf8') };
}

describe('resolvePaidFeaturesGate.sh', () => {
    it.each([
        ['prod reads the PROD variable', 'prod', { prod: 'true', sandbox: 'false' }, 'true'],
        ['prod ignores the SANDBOX variable', 'prod', { prod: 'false', sandbox: 'true' }, 'false'],
        ['sandbox reads the SANDBOX variable', 'sandbox', { sandbox: 'true', prod: 'false' }, 'true'],
        ['sandbox ignores the PROD variable', 'sandbox', { sandbox: 'false', prod: 'true' }, 'false'],
        ['an unset variable is false', 'prod', {}, 'false'],
        ['an empty variable is false', 'sandbox', { sandbox: '' }, 'false'],
        ['only the exact string true counts (TRUE)', 'prod', { prod: 'TRUE' }, 'false'],
        ['only the exact string true counts (1)', 'sandbox', { sandbox: '1' }, 'false'],
        ['only the exact string true counts (padded)', 'prod', { prod: ' true' }, 'false'],
        [
            'a stage that is neither is false, whatever the variables say',
            'pr-91',
            { sandbox: 'true', prod: 'true' },
            'false',
        ],
        ['a dev stage is false', 'dev', { sandbox: 'true', prod: 'true' }, 'false'],
    ] as const)('%s', (_label, stage, vars, expected) => {
        const { status, exported } = run([stage], vars);

        expect(status).toBe(0);
        expect(exported.trim()).toBe(`PAID_FEATURES_GATE=${expected}`);
    });

    it('a variable carrying a newline cannot smuggle a second assignment', () => {
        const { status, exported } = run(['prod'], { prod: 'true\nNODE_OPTIONS=--require=/tmp/x' });

        expect(status).toBe(0);
        expect(exported.trim()).toBe('PAID_FEATURES_GATE=false');
    });

    it.each([[[]], [['']], [['prod', 'extra']]] as const)('refuses the usage %j', (args) => {
        const { status, exported } = run(args);

        expect(status).toBe(2);
        expect(exported).toBe('');
    });
});
