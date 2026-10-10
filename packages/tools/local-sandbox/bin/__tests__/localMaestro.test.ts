/**
 * The decisions `bin/localMaestro.sh` makes before it touches a device: which flows run, that every device call is
 * pinned to the emulator this runner owns, how the Clerk keys are held, and that nothing after the key read can reach
 * real AWS.
 *
 * Each case sources the REAL script (and through it CI's `runMaestroFlows.sh`) in a fresh `bash`, with fake `adb`,
 * `maestro` and `aws` binaries first on `PATH`. Nothing here touches a device, a network or AWS.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const SCRIPT = path.join(REPO_ROOT, 'packages/tools/local-sandbox/bin/localMaestro.sh');
const FLOWS_DIR = path.join(REPO_ROOT, 'packages/apps/commise/mobile/.maestro');

/** The values the fake `aws` hands back. Distinctive, so a leak into any output is unmistakable. */
const FAKE_PUBLISHABLE = 'pk_test_FAKEPUBLISHABLEaaaa';
const FAKE_SECRET = 'sk_test_FAKESECRETzzzz';

interface Sandbox {
    readonly bin: string;
    readonly calls: string;
    readonly state: string;
}

/**
 * A temp directory holding fake `adb`, `maestro` and `aws` that append their argv (one call per line) to a log.
 *
 * @sideEffect Creates files under the OS temp directory.
 */
function makeSandbox(): Sandbox {
    const root = mkdtempSync(path.join(tmpdir(), 'localMaestro-'));
    const bin = path.join(root, 'bin');
    const calls = path.join(root, 'calls.log');

    mkdirSync(bin);
    writeFileSync(calls, '');

    for (const tool of ['adb', 'maestro']) {
        writeFileSync(path.join(bin, tool), `#!/usr/bin/env bash\necho "${tool} $*" >> "${calls}"\n`);
        chmodSync(path.join(bin, tool), 0o755);
    }

    // The fake AWS CLI records its argv AND the AWS environment it was given, then answers the Clerk secret.
    writeFileSync(
        path.join(bin, 'aws'),
        [
            '#!/usr/bin/env bash',
            `echo "aws $* endpoint=\${AWS_ENDPOINT_URL:-unset}" >> "${calls}"`,
            `printf '%s' '{"PUBLISHABLE_KEY":"${FAKE_PUBLISHABLE}","SECRET_KEY":"${FAKE_SECRET}","WEBHOOK_SIGNING_SECRET":"whsec_x"}'`,
            '',
        ].join('\n'),
    );
    chmodSync(path.join(bin, 'aws'), 0o755);

    return { bin, calls, state: path.join(root, 'state') };
}

/**
 * Source the script and run `body` after it.
 *
 * @sideEffect Spawns `bash`.
 */
function run(sandbox: Sandbox, body: string, env: Readonly<Record<string, string>> = {}) {
    const result = spawnSync('bash', ['-c', `source "${SCRIPT}"\n${body}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
            PATH: `${sandbox.bin}:${process.env['PATH'] ?? ''}`,
            HOME: process.env['HOME'] ?? '',
            LOCAL_MAESTRO_STATE_DIR: sandbox.state,
            ...env,
        },
    });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('local_maestro_flows — which flows a command runs', () => {
    it('`all` runs CI’s own plan, in CI’s order, with nothing added or dropped', () => {
        const sandbox = makeSandbox();
        const ours = run(sandbox, 'local_maestro_flows all');
        const ci = spawnSync('bash', [path.join(FLOWS_DIR, '../tests/e2e/runMaestroFlows.sh'), 'select'], {
            encoding: 'utf8',
        });
        const ciFlows = ci.stdout
            .split('\n')
            .filter((line) => line.startsWith('flow='))
            .map((line) => line.slice('flow='.length));

        expect(ours.status).toBe(0);
        expect(ciFlows.length).toBeGreaterThan(10);
        expect(ours.stdout.trim().split('\n')).toEqual(ciFlows);
    });

    it('`flows` runs exactly the named flows, in the order given', () => {
        const result = run(makeSandbox(), 'local_maestro_flows flows recipes/create home');

        expect(result.status).toBe(0);
        expect(result.stdout.trim().split('\n')).toEqual(['recipes/create', 'home']);
    });

    it('accepts a flow named with its `.yaml` suffix, the way a shell completes it', () => {
        const result = run(makeSandbox(), 'local_maestro_flows flows recipes/create.yaml');

        expect(result.stdout.trim()).toBe('recipes/create');
    });

    it.each([
        ['a flow that does not exist', 'recipes/nope'],
        // Both of these name a file that EXISTS, so only the path rule refuses them.
        ['a path that climbs out of the flows directory', '../.maestro/home'],
        ['a path with a `..` inside it', 'recipes/../home'],
        ['an absolute path', '/etc/passwd'],
        ['a sub-flow directory rather than a flow', 'recipes'],
    ])('refuses %s, and runs nothing', (_case, flow) => {
        const result = run(makeSandbox(), `local_maestro_flows flows recipes/create '${flow}'`);

        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain(flow);
    });

    it('refuses `flows` with no flow named — an empty run is not a passing one', () => {
        const result = run(makeSandbox(), 'local_maestro_flows flows');

        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe('');
    });
});

describe('the device pin — every adb and maestro call targets emulator-5556', () => {
    it('pins a bare `adb` call', () => {
        const sandbox = makeSandbox();

        run(sandbox, 'adb devices');

        expect(readFileSync(sandbox.calls, 'utf8').trim()).toBe('adb -s emulator-5556 devices');
    });

    it('pins the calls CI’s own sourced per-flow functions make', () => {
        const sandbox = makeSandbox();

        run(sandbox, 'maestro_reset_driver');

        const calls = readFileSync(sandbox.calls, 'utf8').trim().split('\n');

        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every((call) => call.startsWith('adb -s emulator-5556 '))).toBe(true);
    });

    it('pins `maestro`, as a global option ahead of the subcommand', () => {
        const sandbox = makeSandbox();

        run(sandbox, 'maestro test flow.yaml');

        expect(readFileSync(sandbox.calls, 'utf8').trim()).toBe('maestro --device emulator-5556 test flow.yaml');
    });

    it('is not overridable from the environment', () => {
        const sandbox = makeSandbox();

        run(sandbox, 'adb devices', { ANDROID_SERIAL: 'emulator-5554', LOCAL_MAESTRO_SERIAL: 'emulator-5554' });

        expect(readFileSync(sandbox.calls, 'utf8').trim()).toBe('adb -s emulator-5556 devices');
    });
});

describe('local_maestro_load_clerk_keys — the one read of real AWS', () => {
    it('exports both keys, and prints neither', () => {
        const sandbox = makeSandbox();
        const result = run(
            sandbox,
            'local_maestro_load_clerk_keys && [ "$CLERK_SECRET_KEY" = "' +
                FAKE_SECRET +
                '" ] && [ "$CLERK_PUBLISHABLE_KEY" = "' +
                FAKE_PUBLISHABLE +
                '" ] && echo exported',
        );

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('exported');
        expect(result.stdout + result.stderr).not.toContain(FAKE_SECRET);
        expect(result.stdout + result.stderr).not.toContain(FAKE_PUBLISHABLE);
    });

    it('reads the sandbox Clerk secret only — never with a LocalStack endpoint in force', () => {
        const sandbox = makeSandbox();

        run(sandbox, 'local_maestro_load_clerk_keys', { AWS_ENDPOINT_URL: 'http://localhost:4566' });

        const calls = readFileSync(sandbox.calls, 'utf8').trim().split('\n');

        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('secretsmanager get-secret-value');
        expect(calls[0]).toContain('--secret-id kitchensink/sandbox/identity/keys');
        expect(calls[0]).toContain('endpoint=unset');
    });

    it('holds each key in an owner-only file, in an owner-only directory, outside the repository', () => {
        const sandbox = makeSandbox();

        run(sandbox, 'local_maestro_load_clerk_keys');

        const dir = path.join(sandbox.state, 'secrets');

        expect(statSync(dir).mode & 0o777).toBe(0o700);

        for (const file of ['clerkSecretKey', 'clerkPublishableKey']) {
            expect(statSync(path.join(dir, file)).mode & 0o777).toBe(0o600);
        }

        expect(readFileSync(path.join(dir, 'clerkSecretKey'), 'utf8').trim()).toBe(FAKE_SECRET);
    });

    it('reads AWS once — a second load uses the files it wrote', () => {
        const sandbox = makeSandbox();

        run(sandbox, 'local_maestro_load_clerk_keys');
        run(sandbox, 'local_maestro_load_clerk_keys');

        expect(readFileSync(sandbox.calls, 'utf8').trim().split('\n')).toHaveLength(1);
    });

    it('refuses a state directory inside the repository', () => {
        const sandbox = makeSandbox();
        const result = run(sandbox, 'local_maestro_load_clerk_keys', {
            LOCAL_MAESTRO_STATE_DIR: path.join(REPO_ROOT, 'packages/tools/local-sandbox/stateInRepo'),
        });

        expect(result.status).not.toBe(0);
        expect(readFileSync(sandbox.calls, 'utf8')).toBe('');
    });

    it('fails when the secret has no key, rather than exporting an empty one', () => {
        const sandbox = makeSandbox();

        writeFileSync(path.join(sandbox.bin, 'aws'), "#!/usr/bin/env bash\nprintf '%s' '{}'\n");
        chmodSync(path.join(sandbox.bin, 'aws'), 0o755);

        expect(run(sandbox, 'local_maestro_load_clerk_keys').status).not.toBe(0);
    });
});

describe('local_maestro_pin_aws — nothing after the key read can reach real AWS', () => {
    it('points every SDK client at LocalStack, with throwaway credentials, and drops the profile', () => {
        const result = run(
            makeSandbox(),
            'local_maestro_pin_aws && printf "%s|%s|%s|%s|%s|%s\\n" "$AWS_ENDPOINT_URL" "$AWS_ACCESS_KEY_ID" ' +
                '"$AWS_SECRET_ACCESS_KEY" "${AWS_PROFILE-unset}" "${AWS_SESSION_TOKEN-unset}" "$AWS_REGION"',
            { AWS_PROFILE: 'real', AWS_SESSION_TOKEN: 'real-token', AWS_ACCESS_KEY_ID: 'AKIAREAL' },
        );

        expect(result.stdout.trim()).toBe('http://localhost:4566|test|test|unset|unset|us-east-1');
    });
});

/**
 * ⛔ A dev bundle carries the app's `.env` files as modules that override `process.env`, so the bundle — not the
 * runner's environment — decides which backend the app talks to. The first proof run's bundle carried `.env.local`'s
 * deployed preview origins: the app read `recipe-pr-91` while the seeder wrote locally.
 */
describe('local_maestro_check_bundle_env — the bundle names only local origins', () => {
    const write = (sandbox: Sandbox, body: string): string => {
        const file = path.join(path.dirname(sandbox.calls), 'bundle.js');

        writeFileSync(file, body);

        return file;
    };

    const envModule = (name: string, entries: Record<string, string>): string =>
        `__d(function(){var _default = ${JSON.stringify(entries)};},1,[],"${name}");\n`;

    it('passes a bundle whose env modules name only loopback origins', () => {
        const sandbox = makeSandbox();
        const file = write(
            sandbox,
            envModule('.env.development', {
                EXPO_PUBLIC_RECIPE_API_URL: 'http://localhost:3000',
                EXPO_PUBLIC_IDENTITY_API_URL: 'http://localhost:4000',
            }),
        );

        expect(run(sandbox, `local_maestro_check_bundle_env '${file}'`).status).toBe(0);
    });

    it('refuses a bundle that names a deployed origin, and says which', () => {
        const sandbox = makeSandbox();
        const file = write(
            sandbox,
            envModule('.env.development', { EXPO_PUBLIC_RECIPE_API_URL: 'http://localhost:3000' }) +
                envModule('.env.local', { EXPO_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-91.commise.app' }),
        );
        const result = run(sandbox, `local_maestro_check_bundle_env '${file}'`);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('recipe-pr-91.commise.app');
    });

    it('refuses an empty bundle — nothing checked is not a pass', () => {
        const sandbox = makeSandbox();

        expect(run(sandbox, `local_maestro_check_bundle_env '${write(sandbox, '')}'`).status).not.toBe(0);
    });
});

/**
 * ⛔ The local identity database must resolve each pool user to the app-user id its Clerk `external_id` names
 * (`src/identityAlignment.ts`), or every owner-gated control is hidden on the cook's own recipes. The device's first
 * request is what would otherwise mint a fresh id, so the alignment has to run BEFORE the flows — and a failed
 * alignment must stop the run rather than leave five owner flows to fail one by one.
 */
describe('local_maestro_align_identities — the local identity agrees with Clerk before any flow runs', () => {
    const fakeNpx = (sandbox: Sandbox, exitCode: number): void => {
        writeFileSync(
            path.join(sandbox.bin, 'npx'),
            `#!/usr/bin/env bash\necho "npx $* shard=\${COMMISE_E2E_SHARD:-unset}" >> "${sandbox.calls}"\nexit ${exitCode}\n`,
        );
        chmodSync(path.join(sandbox.bin, 'npx'), 0o755);
    };

    it('runs the aligner for this run’s shard', () => {
        const sandbox = makeSandbox();
        fakeNpx(sandbox, 0);

        expect(run(sandbox, 'COMMISE_E2E_SHARD=1 local_maestro_align_identities').status).toBe(0);
        expect(readFileSync(sandbox.calls, 'utf8')).toContain(
            'npx tsx packages/tools/local-sandbox/bin/alignIdentities.ts shard=1',
        );
    });

    it('fails when the aligner fails', () => {
        const sandbox = makeSandbox();
        fakeNpx(sandbox, 1);

        expect(run(sandbox, 'local_maestro_align_identities').status).not.toBe(0);
    });

    it('runs after the pool reset and before the world is seeded and any flow runs', () => {
        const body = run(makeSandbox(), 'declare -f local_maestro_main').stdout;
        const at = (needle: string): number => body.indexOf(needle);

        expect(at('local_maestro_align_identities')).toBeGreaterThan(at('local_maestro_reset_pool'));
        expect(at('local_maestro_align_identities')).toBeLessThan(at('e2e-seed/src/provision.ts'));
        expect(at('local_maestro_align_identities')).toBeLessThan(at('maestro_run_flow_list'));
    });
});
