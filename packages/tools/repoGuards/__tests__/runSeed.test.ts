/**
 * `runSeed.sh`'s command-line contract (curated catalog plan U2): misuse is never a skip, and sourcing the script
 * runs nothing. The impure half — resolve, invoke, classify — is `tests/runSeed.integration.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/runSeed.sh', import.meta.url));

/** A stand-in `aws` that only leaves a marker, so a test can prove the script never reached AWS. */
const markerBin = mkdtempSync(join(tmpdir(), 'runSeedMarker-'));
const MARKER = join(markerBin, 'called');

writeFileSync(join(markerBin, 'aws'), `#!/usr/bin/env bash\ntouch "${MARKER}"\n`);
chmodSync(join(markerBin, 'aws'), 0o755);

afterAll(() => {
    rmSync(markerBin, { recursive: true, force: true });
});

/** Run the script with the marker `aws` first on `PATH`. */
function run(args: readonly string[]): number {
    const result = spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${markerBin}:${process.env['PATH'] ?? ''}` },
    });

    return result.status ?? -1;
}

describe('runSeed.sh', () => {
    it.each([
        ['no subcommand', []],
        ['an unknown subcommand', ['reseed']],
        ['`run` with four arguments', ['run', 'us-east-1', 'stack', 'Output', 'food']],
        ['`run` with an empty argument', ['run', 'us-east-1', '', 'Output', 'food', '/tmp']],
    ] as const)('⛔ treats %s as misuse (exit 2), never reaching AWS', (_case, args) => {
        expect(run(args)).toBe(2);
        expect(existsSync(MARKER)).toBe(false);
    });

    it('defines its functions when sourced, and runs nothing', () => {
        const result = spawnSync(
            'bash',
            // `$0` is a neutral name: were it the script's own path, sourcing would trip the CLI dispatch.
            ['-c', 'source "$1" && declare -F run_seed_render run_seed_manifest run_seed_run', 'bash', SCRIPT],
            { encoding: 'utf8', env: { ...process.env, PATH: `${markerBin}:${process.env['PATH'] ?? ''}` } },
        );

        expect(result.status).toBe(0);
        expect(result.stdout.trim().split('\n')).toHaveLength(3);
        expect(existsSync(MARKER)).toBe(false);
    });
});
