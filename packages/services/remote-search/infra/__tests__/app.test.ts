/**
 * The CDK app itself refuses every stage but `prod` and a pull request's preview: a copy at a stage food never runs
 * at cannot be synthesized, whichever way the stage arrives. It also refuses to run without the domain its hostname
 * belongs to. Run as the pipeline runs it, in a child process.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const INFRA_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(INFRA_ROOT, 'node_modules/.bin/tsx');
const outdir = mkdtempSync(join(tmpdir(), 'remote-search-app-'));

afterAll(() => {
    rmSync(outdir, { recursive: true, force: true });
});

/**
 * Run the app.
 *
 * @param environment - The variables the app reads.
 * @param context - `-c` context, as `--context stage=…` would pass it.
 * @returns Its exit status and error output.
 * @sideEffect Spawns a process.
 */
function runApp(
    environment: Readonly<Record<string, string>>,
    context: Readonly<Record<string, string>> = {},
): { readonly status: number | null; readonly stderr: string } {
    const result = spawnSync(TSX, ['bin/app.ts'], {
        cwd: INFRA_ROOT,
        encoding: 'utf8',
        env: {
            PATH: process.env['PATH'] ?? '',
            HOME: process.env['HOME'] ?? '',
            CDK_OUTDIR: outdir,
            ...(Object.keys(context).length === 0 ? {} : { CDK_CONTEXT_JSON: JSON.stringify(context) }),
            ...environment,
        },
    });

    return { status: result.status, stderr: result.stderr };
}

describe('the remote search app', () => {
    it.each([
        ['the shared sandbox tier, which food never runs at', { STAGE: 'sandbox' }],
        ['the local stage', { STAGE: 'local' }],
        ['a malformed preview stage', { STAGE: 'pr-0' }],
        ['no stage at all', {}],
    ])('refuses %s', (_label, environment) => {
        const { status, stderr } = runApp(environment);

        expect(status).not.toBe(0);
        expect(stderr).toMatch(/Refusing to synthesize the remote search service/u);
    });

    it.each(['prod', 'pr-91'])('refuses %s without the domain its hostname and certificate belong to', (stage) => {
        const { status, stderr } = runApp({ STAGE: stage });

        expect(status).not.toBe(0);
        expect(stderr).toMatch(/DOMAIN_NAME env var is required/u);
    });

    it('refuses a stage passed as context, ahead of the environment', () => {
        const { status, stderr } = runApp({ STAGE: 'prod' }, { stage: 'sandbox' });

        expect(status).not.toBe(0);
        expect(stderr).toMatch(/"sandbox"/u);
    });
});
