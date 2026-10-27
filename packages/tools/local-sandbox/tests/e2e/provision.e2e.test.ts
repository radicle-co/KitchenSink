/**
 * LOCAL e2e (`docs/CODING_STANDARDS.md` §7.1a): `e2e-seed provision` passes against the LOCAL stack.
 *
 * ⛔ THE FAILURE THIS REPLACES. With no remote search on local food every probe answered `unavailable` and provision threw
 * `RemoteProbeExhaustedError` at its first word, so EVERY lane stopped at setup (measured 2026-10-21). That is this
 * suite's red evidence: it was observed as that error, not written first and watched fail. What it asserts now is the
 * outcome the stand-in exists for — provision exits 0 and its manifest names a word for each remote-food role — run through
 * the real food service, the real search function behind the stand-in edge, and real Clerk for the local-namespace users.
 *
 * Needs, and THROWS without: the local stack up (`LOCAL_SANDBOX_HOST_PORTS=recipes=<port> npm run local:up` when 3000 is
 * held) with the account-erasure consumer running (`npm run consumer --workspace=@kitchensink/local-sandbox --
 * accountErasureWorker`), `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` (a development instance's), and LocalStack
 * pinned (`AWS_ENDPOINT_URL`). `LOCAL_RECIPE_PORT` names the recipe host port (default 3000).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const RECIPE_PORT = process.env['LOCAL_RECIPE_PORT'] ?? '3000';

function required(name: string): string {
    const value = process.env[name];

    if (value === undefined || value === '') {
        throw new Error(`${name} is required: this LOCAL tier never skips.`);
    }

    return value;
}

/** Run a repo script under tsx with the lane's environment; returns its output. */
function tsx(script: string, args: readonly string[], env: Readonly<Record<string, string>>) {
    return spawnSync('npx', ['tsx', path.join(REPO_ROOT, script), ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
}

let lane: Record<string, string>;
let stateDir: string;

beforeAll(async () => {
    required('CLERK_SECRET_KEY');
    required('CLERK_PUBLISHABLE_KEY');
    required('AWS_ENDPOINT_URL');

    for (const [name, port] of [
        ['recipe', RECIPE_PORT],
        ['identity', '3001'],
        ['food', '3002'],
    ] as const) {
        const response = await fetch(`http://localhost:${port}/health`).catch(() => undefined);

        if (response?.ok !== true) {
            throw new Error(`the local ${name} service does not answer on :${port} — run \`npm run local:up\` first`);
        }
    }

    stateDir = mkdtempSync(path.join(tmpdir(), 'localProvision-'));
    lane = {
        E2E_POOL_NAMESPACE: 'local',
        MAESTRO_PLATFORM: 'android',
        COMMISE_E2E_SHARD: '1',
        E2E_SEED_RECIPE_URL: `http://localhost:${RECIPE_PORT}`,
        E2E_SEED_FOOD_URL: 'http://localhost:3002',
        E2E_SEED_IDENTITY_URL: 'http://localhost:3001',
        E2E_SEED_WEB_ORIGIN: 'http://localhost:3000',
        E2E_SEED_STATE_DIR: stateDir,
    };
});

describe('e2e-seed provision against the local stack', () => {
    it('makes the local pool users, aligns them, and provisions with a verified word for each remote-food role', () => {
        const steps: readonly [string, readonly string[]][] = [
            [
                'packages/tools/e2e-fixtures/src/poolAdmin.ts',
                ['--apply', '--recycle', '--maestro-lane', '--platform', 'android', '--shard', '1'],
            ],
            [
                'packages/tools/e2e-seed/src/resetPool.ts',
                ['--tier', 'maestro', '--platform', 'android', '--shard', '1'],
            ],
            ['packages/tools/local-sandbox/bin/alignIdentities.ts', []],
        ];

        for (const [script, args] of steps) {
            const result = tsx(script, args, lane);

            expect(result.status, `${script}\n${result.stderr}`).toBe(0);
        }

        const provisioned = tsx('packages/tools/e2e-seed/src/provision.ts', [], lane);

        expect(provisioned.status, provisioned.stderr).toBe(0);

        const manifest = provisioned.stdout;
        const file = path.join(stateDir, 'fixture.env');

        writeFileSync(file, manifest);

        const lines = readFileSync(file, 'utf8').split('\n');

        for (const key of ['E2E_REMOTE_APPEND_WORD', 'E2E_REMOTE_CHANGE_WORD']) {
            expect(
                lines.some((line) => line.startsWith(`${key}=`) && line.length > key.length + 1),
                `${key} is in the manifest`,
            ).toBe(true);
        }

        // The erasure subject is one of the LOCAL namespace's, never a user CI owns.
        expect(lines.find((line) => line.startsWith('E2E_ERASURE_EMAIL='))).toMatch(
            /^E2E_ERASURE_EMAIL=test-local-erasure/u,
        );
    });
});
