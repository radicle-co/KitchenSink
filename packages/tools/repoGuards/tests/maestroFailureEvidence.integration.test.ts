/**
 * A FAILED FLOW'S DEBUG FOLDER AND DEVICE LOG ARE KEPT, THROUGH THE REAL RUNNER; A PASSED FLOW KEEPS NOTHING.
 *
 * The sibling of `maestroFailureEvidence.test.ts`, which pins the copy. This one runs the loop with `maestro` stubbed
 * to leave a debug folder for every flow, as the real one does, and fails one of two flows: only the failed one may
 * appear under `MAESTRO_EVIDENCE_DIR`.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAESTRO_ERASURE_SHARD, maestroErasureSlots } from '@kitchensink/e2e-fixtures/testPool';
import { deriveFixtureManifest, manifestToEnvLines } from '@kitchensink/e2e-seed';
import { afterAll, describe, expect, it } from 'vitest';

/** What `provision` decides at run time: the leased erasure subject and the verified remote probe words. */
const provisioned = (erasureEmail: string | null): Parameters<typeof manifestToEnvLines>[1] => ({
    erasureEmail,
    probeWords: {
        appendWord: 'paneer',
        appendFood: 'paneer run',
        changeWord: 'gochujang',
        unresolvedWord: 'halloumi',
        ambiguityWord: 'mirin',
        noMatchFood: 'Maestro Zorbleflax',
    },
});

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const UDID = 'AAAAAAAA-1111-2222-3333-444444444444';
// An iOS subject: the manifest refuses any other platform's (`manifestToEnvLines`, 2026-10-13).
const ERASURE_SUBJECT = maestroErasureSlots('ios', MAESTRO_ERASURE_SHARD)[0]?.email ?? '';

/** Every directory this file created, removed in `afterAll` so a failing test still cleans up. */
const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

interface Recorded {
    readonly evidence: string;
    readonly calls: readonly string[];
    readonly output: string;
    readonly status: number;
}

/**
 * Run the script once with `adb`, `maestro`, `npx`, `node` and `xcrun` stubbed to record their argv.
 *
 * @param args - The script's arguments.
 * @param env - Environment overrides on top of the stub `PATH` and the fixture manifest.
 * @sideEffect Creates a scratch directory and spawns bash.
 */
function runWithStubs(args: readonly string[], env: Readonly<Record<string, string>>): Recorded {
    const dir = mkdtempSync(join(tmpdir(), 'maestro-evidence-'));

    scratch.push(dir);

    const log = join(dir, 'calls.log');

    writeFileSync(log, '', 'utf8');

    for (const name of ['adb', 'maestro', 'node', 'npx', 'xcrun']) {
        const path = join(dir, name);
        // Test-only failure injection, read from the environment the script is run with: `MAESTRO_STUB_FAIL_FLOWS` names
        // flows whose `maestro test` exits 1, and `MAESTRO_STUB_NPX_FAIL_CALL` makes that numbered `npx` call (the per-flow
        // e2e-seed reset) exit 1. Everything else exits 0, so a case that sets neither behaves exactly as before.
        const injected =
            name === 'maestro'
                ? 'last="${!#}"; stem="${last##*/}"; stem="${stem%.yaml}"; mkdir -p "$HOME/.maestro/tests/2026-11-08_000001/$stem/screenshots"; echo png > "$HOME/.maestro/tests/2026-11-08_000001/$stem/screenshots/s.png"; for f in ${MAESTRO_STUB_FAIL_FLOWS:-}; do case "$last" in */"$f".yaml) exit 1 ;; esac; done\n'
                : name === 'npx'
                  ? `n=$(($(cat "${log}.npx" 2>/dev/null || echo 0) + 1)); echo "$n" > "${log}.npx"; [ "$n" = "\${MAESTRO_STUB_NPX_FAIL_CALL:-0}" ] && exit 1\n`
                  : name === 'xcrun'
                    ? // The device holds the Reduce Motion setting it was just written, as a real Simulator does: the
                      // runner reads it back and refuses a device that does not (`maestroReduceMotion.test.ts`).
                      'case "$*" in *"defaults read com.apple.Accessibility ReduceMotionEnabled"*) echo 1 ;; esac\n'
                    : '';

        // ONE field per argument, so a flattened argv is visible.
        writeFileSync(
            path,
            `#!/usr/bin/env bash\n{ printf '%s' "${name}"; printf '\\t%s' "$@"; printf '\\n'; } >> "${log}"\n${injected}exit 0\n`,
            'utf8',
        );
        chmodSync(path, 0o755);
    }

    const manifest = deriveFixtureManifest('pr91-ios-lifecycle', 'ios', 1);
    const manifestFile = join(dir, 'fixture.env');

    writeFileSync(manifestFile, `${manifestToEnvLines(manifest, provisioned(ERASURE_SUBJECT)).join('\n')}\n`, 'utf8');

    const app = join(dir, 'Commise.app');

    mkdirSync(app);

    const result = spawnSync('bash', [SCRIPT, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${dir}:${process.env['PATH'] ?? ''}`,
            // Empty is unset to `runCli.sh`: a caller's bundle directory must not route the resets away from the `npx` stub.
            E2E_SEED_CLI_DIR: '',
            MAESTRO_FIXTURE_ENV_FILE: manifestFile,
            MAESTRO_IOS_APP: app,
            HOME: join(dir, 'home'),
            MAESTRO_EVIDENCE_DIR: join(dir, 'evidence'),
            ...env,
        },
    });

    return {
        evidence: join(dir, 'evidence'),
        calls: existsSync(log)
            ? readFileSync(log, 'utf8')
                  .split('\n')
                  .filter((line) => line.trim().length > 0)
            : [],
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        status: result.status ?? -1,
    };
}

const IOS = { MAESTRO_PLATFORM: 'ios', MAESTRO_IOS_UDID: UDID } as const;

describe('failure evidence through the real flow loop', () => {
    const recorded = runWithStubs(['run-one', 'recipes/passes', 'recipes/fails'], {
        ...IOS,
        MAESTRO_STUB_FAIL_FLOWS: 'fails',
    });

    it('keeps the failed flow: its debug folder, with the screenshot, and its device log', () => {
        expect(
            existsSync(join(recorded.evidence, 'recipes__fails/debug/fails/screenshots/s.png')),
            recorded.output,
        ).toBe(true);
        expect(existsSync(join(recorded.evidence, 'recipes__fails/deviceLog.txt'))).toBe(true);
    });

    it('keeps nothing for the flow that passed', () => {
        expect(existsSync(join(recorded.evidence, 'recipes__passes'))).toBe(false);
    });

    it('says where the evidence is', () => {
        expect(recorded.output).toContain(
            `failure evidence for recipes/fails: ${join(recorded.evidence, 'recipes__fails')}`,
        );
    });
});
