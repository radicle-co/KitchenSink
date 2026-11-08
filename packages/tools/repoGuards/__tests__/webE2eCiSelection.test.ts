// @vitest-environment node
/**
 * Behaviour guard: the CI branch of `web/scripts/e2e.sh` runs exactly the selected tests, and refuses a run whose
 * list does not hold the number of tests the selection step counted.
 *
 * It EXECUTES the script with a fake `npx` first on PATH, so it sees the real argument list and the real exit code.
 * What it proves: `E2E_SPECS` become file filters after the caller's own arguments; the count check runs
 * BEFORE Playwright and a failing check stops the run; and with neither variable set the call is the old one,
 * byte for byte (the `webE2eProductionBuild` spelling). It does not prove that Playwright honours `--test-list`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(import.meta.dirname, '../../../apps/commise/web/scripts/e2e.sh');

function runScript(env: Record<string, string>, checkExit: number): { status: number | null; calls: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-sh-'));
    const log = join(dir, 'calls.log');

    // The fake logs its argv; the count check (`tsx scripts/e2eCountCheck.ts`) exits with `checkExit`.
    writeFileSync(
        join(dir, 'npx'),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${log}"\nif [[ "$1" == "tsx" ]]; then exit ${checkExit}; fi\nexit 0\n`,
    );
    chmodSync(join(dir, 'npx'), 0o755);

    const result = spawnSync('bash', [SCRIPT, '--shard=2/4', '--reporter=blob'], {
        env: { PATH: `${dir}:${process.env['PATH'] ?? ''}`, CI: '1', ...env },
        encoding: 'utf8',
    });
    const calls = (() => {
        try {
            return readFileSync(log, 'utf8').trim().split('\n');
        } catch {
            return [];
        }
    })();

    return { status: result.status, calls };
}

describe('web/scripts/e2e.sh on CI', () => {
    it('is the plain Playwright call when nothing was selected', () => {
        expect(runScript({}, 0)).toEqual({
            status: 0,
            calls: ['playwright test --shard=2/4 --reporter=blob'],
        });
    });

    it('adds the selected specs after the caller arguments', () => {
        const { status, calls } = runScript({ E2E_SPECS: 'tests/e2e/a\\.spec\\.ts$ tests/e2e/b\\.spec\\.ts$' }, 0);

        expect(status).toBe(0);
        expect(calls).toEqual([
            'playwright test --shard=2/4 --reporter=blob tests/e2e/a\\.spec\\.ts$ tests/e2e/b\\.spec\\.ts$',
        ]);
    });

    it('checks the count before Playwright and runs when it holds', () => {
        const { status, calls } = runScript({ E2E_SPECS: 'tests/e2e/a\\.spec\\.ts$', E2E_EXPECTED_TESTS: '30' }, 0);

        expect(status).toBe(0);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toBe('tsx scripts/e2eCountCheck.ts 30 tests/e2e/a\\.spec\\.ts$');
        expect(calls[1]).toBe('playwright test --shard=2/4 --reporter=blob tests/e2e/a\\.spec\\.ts$');
    });

    it('stops before Playwright when the count does not hold', () => {
        const { status, calls } = runScript({ E2E_SPECS: 'tests/e2e/a\\.spec\\.ts$', E2E_EXPECTED_TESTS: '30' }, 1);

        expect(status).not.toBe(0);
        expect(calls.some((call) => call.startsWith('playwright'))).toBe(false);
    });

    it('checks the whole suite against its count when there is a count but no list', () => {
        const { calls } = runScript({ E2E_EXPECTED_TESTS: '696' }, 0);

        expect(calls[0]).toBe('tsx scripts/e2eCountCheck.ts 696');
    });
});
