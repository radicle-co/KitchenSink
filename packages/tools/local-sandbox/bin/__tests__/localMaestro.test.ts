/**
 * The decisions `bin/localMaestro.sh` makes before it touches a device: which flows run, that every device call is
 * pinned to the emulator this runner owns, how the Clerk keys are held, and that nothing after the key read can reach
 * real AWS.
 *
 * Each case sources the REAL script (and through it CI's `runMaestroFlows.sh`) in a fresh `bash`, with fake `adb`,
 * `maestro` and `aws` binaries first on `PATH`. Nothing here touches a device, a network or AWS.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
    /**
     * REWRITTEN 2026-10-29. It used to assert "nothing added or dropped"; five flows (`MAESTRO_SANDBOX_ONLY_FLOWS`) need
     * the deployed sandbox (four its food catalog and verification worker, `auth/loginFlow` its Clerk instance's Google
     * sign-in), which the local stack cannot run. They are dropped from
     * the LOCAL list ON PURPOSE and named on stderr, never run to fail and never counted as passed. The deployed plan is
     * untouched (`maestroSandboxOnlyFlows.test.ts`), so this still asserts CI's order for everything else.
     */
    it('`all` runs CI’s own plan in CI’s order, minus the flows that need the sandbox, and NAMES those', () => {
        const sandbox = makeSandbox();
        const ours = run(sandbox, 'local_maestro_flows all');
        const ci = spawnSync('bash', [path.join(FLOWS_DIR, '../tests/e2e/runMaestroFlows.sh'), 'select'], {
            encoding: 'utf8',
        });
        const ciFlows = ci.stdout
            .split('\n')
            .filter((line) => line.startsWith('flow='))
            .map((line) => line.slice('flow='.length));
        const sandboxOnly = [
            'recipes/pasteListSettle',
            'recipes/ingredientCandidates',
            'recipes/ambiguityReview',
            'auth/loginFlow',
        ];

        expect(ours.status).toBe(0);
        expect(ciFlows.length).toBeGreaterThan(10);
        expect(ours.stdout.trim().split('\n')).toEqual(ciFlows.filter((flow) => !sandboxOnly.includes(flow)));

        for (const flow of sandboxOnly) {
            expect(ciFlows).toContain(flow);
            expect(ours.stderr).toContain(`not run locally: needs sandbox - ${flow}`);
        }
    });

    it('`flows` still runs a sandbox-only flow when it is NAMED - the developer asked for exactly that', () => {
        const result = run(makeSandbox(), 'local_maestro_flows flows recipes/pasteListSettle');

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('recipes/pasteListSettle');
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

/**
 * Puts a fake `npx` first on PATH that answers the selector (`npx tsx .../plan.ts --tier mobile`) with `answer` and
 * the given exit code, and logs that it was called.
 *
 * @sideEffect Writes an executable into the sandbox.
 */
function fakeSelector(sandbox: Sandbox, answer: string, exitCode = 0): void {
    writeFileSync(
        path.join(sandbox.bin, 'npx'),
        `#!/usr/bin/env bash\necho "npx $*" >> "${sandbox.calls}"\nprintf '%s' '${answer}'\nexit ${exitCode}\n`,
    );
    chmodSync(path.join(sandbox.bin, 'npx'), 0o755);
}

describe('local_maestro_flows changed — the flows the impacted-test selector picked', () => {
    const selectorCalls = (sandbox: Sandbox): readonly string[] =>
        readFileSync(sandbox.calls, 'utf8')
            .split('\n')
            .filter((line) => line.startsWith('npx '));

    it('runs exactly the picked flows, in the order the selector gave', () => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, 'some\nhome\nrecipes/create\n');

        const result = run(sandbox, 'local_maestro_flows changed');

        expect(result.status).toBe(0);
        expect(result.stdout.trim().split('\n')).toEqual(['home', 'recipes/create']);
        expect(selectorCalls(sandbox).join('\n')).toContain('--tier mobile');
    });

    it('runs what `all` runs when the selector says all', () => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, 'all\n');

        expect(run(sandbox, 'local_maestro_flows changed').stdout).toBe(run(sandbox, 'local_maestro_flows all').stdout);
    });

    it('runs what `all` runs, without asking the selector, when FULL_SUITE=1', () => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, 'some\nhome\n');

        const result = run(sandbox, 'local_maestro_flows changed', { FULL_SUITE: '1' });

        expect(result.stdout).toBe(run(sandbox, 'local_maestro_flows all').stdout);
        expect(selectorCalls(sandbox)).toEqual([]);
    });

    it.each([
        ['fails', '', 1],
        ['prints something that is not a selection', 'hello\n', 0],
        ['names a flow that has no file', 'some\nghost/flow\n', 0],
    ])('runs everything, and says so, when the selector %s', (_name, answer, code) => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, answer, code);

        const result = run(sandbox, 'local_maestro_flows changed');

        expect(result.status).toBe(0);
        expect(result.stdout).toBe(run(makeSandbox(), 'local_maestro_flows all').stdout);
        expect(result.stderr).toMatch(/running every flow/u);
    });

    it('leaves out a picked flow that needs the sandbox, and NAMES it', () => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, 'some\nhome\nrecipes/ambiguityReview\n');

        const result = run(sandbox, 'local_maestro_flows changed');

        expect(result.stdout.trim().split('\n')).toEqual(['home']);
        expect(result.stderr).toContain('not run locally: needs sandbox - recipes/ambiguityReview');
    });

    it('returns 3 and says why when the change touches no flow, never a list of zero flows', () => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, 'some\n');

        const result = run(sandbox, 'local_maestro_flows changed');

        expect(result.status).toBe(3);
        expect(result.stdout).toBe('');
        expect(result.stderr).toMatch(/nothing to run/u);
    });

    it('returns 3 and names them when every picked flow needs the sandbox', () => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, 'some\nrecipes/ambiguityReview\n');

        const result = run(sandbox, 'local_maestro_flows changed');

        expect(result.status).toBe(3);
        expect(result.stderr).toContain('not run locally: needs sandbox - recipes/ambiguityReview');
    });

    it('exits 0 from the main command, touching no device, AWS or Metro, when there is nothing to run', () => {
        const sandbox = makeSandbox();

        fakeSelector(sandbox, 'some\n');

        const result = run(sandbox, 'local_maestro_main changed');

        expect(result.status).toBe(0);
        expect(result.stderr).toMatch(/nothing to run/u);
        expect(readFileSync(sandbox.calls, 'utf8').split('\n').filter((line) => line !== '' && !line.startsWith('npx '))).toEqual([]);
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

/**
 * ADDED 2026-10-13: iOS has pool lanes of its own, so every seed and reset step names its platform. A local run is
 * the Android emulator, and it says so EXPLICITLY — an absent platform would default to android in the seed tools, but
 * a default is a decision nobody wrote down here, and `resetPool` refuses one outright.
 */
describe('the local run names its platform', () => {
    const fakeNpx = (sandbox: Sandbox): void => {
        writeFileSync(
            path.join(sandbox.bin, 'npx'),
            `#!/usr/bin/env bash\necho "npx $* platform=\${MAESTRO_PLATFORM:-unset}" >> "${sandbox.calls}"\nexit 0\n`,
        );
        chmodSync(path.join(sandbox.bin, 'npx'), 0o755);
    };

    it('⛔ resets the pool for android shard 1, with --platform on the command line', () => {
        const sandbox = makeSandbox();
        fakeNpx(sandbox);

        expect(run(sandbox, 'local_maestro_reset_pool').status).toBe(0);
        expect(readFileSync(sandbox.calls, 'utf8')).toContain(
            'resetPool.ts --tier maestro --platform android --shard 1',
        );
    });

    it('exports MAESTRO_PLATFORM=android for the seed tools, beside the shard', () => {
        const sandbox = makeSandbox();
        const result = run(
            sandbox,
            `local_maestro_seed_env '${sandbox.state}'; echo "$MAESTRO_PLATFORM $COMMISE_E2E_SHARD"`,
        );

        expect(result.stdout.trim().split('\n').at(-1)).toBe('android 1');
    });

    // `e2e-seed provision` reads its signer's entitlement from identity, so it refuses to start without this origin.
    it('points the seed tools at the local identity service', () => {
        const sandbox = makeSandbox();
        const result = run(sandbox, `local_maestro_seed_env '${sandbox.state}'; echo "$E2E_SEED_IDENTITY_URL"`);

        expect(result.stdout.trim().split('\n').at(-1)).toBe('http://localhost:3001');
    });
});

/**
 * ADDED 2026-10-27: a local run signs in users of its own (`E2E_POOL_NAMESPACE=local`). The shared pool's erasure
 * subjects are CI's, and the local stack runs no identity webhook to write a user's `external_id`; see `testPool.ts`.
 */
describe('the local run uses its own pool users', () => {
    const fakeNpx = (sandbox: Sandbox): void => {
        writeFileSync(
            path.join(sandbox.bin, 'npx'),
            `#!/usr/bin/env bash\necho "npx $* ns=\${E2E_POOL_NAMESPACE:-unset}" >> "${sandbox.calls}"\nexit 0\n`,
        );
        chmodSync(path.join(sandbox.bin, 'npx'), 0o755);
    };

    it('⛔ selects the local namespace for every seed tool', () => {
        const sandbox = makeSandbox();
        const result = run(sandbox, `local_maestro_seed_env '${sandbox.state}'; echo "$E2E_POOL_NAMESPACE"`);

        expect(result.stdout.trim().split('\n').at(-1)).toBe('local');
    });

    it('creates the lane’s users, recycling its erasure subjects, with the namespace in force', () => {
        const sandbox = makeSandbox();
        fakeNpx(sandbox);

        expect(
            run(sandbox, `local_maestro_seed_env '${sandbox.state}'; local_maestro_provision_lane_users`).status,
        ).toBe(0);
        expect(readFileSync(sandbox.calls, 'utf8')).toContain(
            'poolAdmin.ts --apply --recycle --maestro-lane --platform android --shard 1 ns=local',
        );
    });

    it('provisions the users after the Clerk keys are loaded and before the pool is reset', () => {
        const body = run(makeSandbox(), 'declare -f local_maestro_main').stdout;
        const at = (needle: string): number => body.indexOf(needle);

        expect(at('local_maestro_provision_lane_users')).toBeGreaterThan(at('local_maestro_load_clerk_keys'));
        // The reset that matters is the first one AFTER the provisioning (an earlier one belongs to the `reset` command).
        const resetAfter = body.indexOf('local_maestro_reset_pool', at('local_maestro_provision_lane_users'));

        expect(resetAfter).toBeGreaterThan(at('local_maestro_provision_lane_users'));
        expect(resetAfter).toBeLessThan(at('local_maestro_align_identities'));
    });
});

describe('a recipe host port something else holds', () => {
    it('seeds against the moved host port, while the device keeps addressing :3000', () => {
        const sandbox = makeSandbox();
        const result = run(
            sandbox,
            `local_maestro_seed_env '${sandbox.state}'; echo "$E2E_SEED_RECIPE_URL $LOCAL_MAESTRO_RECIPE_ORIGIN"`,
            { LOCAL_MAESTRO_RECIPE_HOST_PORT: '3050' },
        );

        expect(result.stdout.trim().split('\n').at(-1)).toBe('http://localhost:3050 http://localhost:3000');
    });

    it('defaults to the service’s own port', () => {
        const sandbox = makeSandbox();
        const result = run(sandbox, `local_maestro_seed_env '${sandbox.state}'; echo "$E2E_SEED_RECIPE_URL"`);

        expect(result.stdout.trim().split('\n').at(-1)).toBe('http://localhost:3000');
    });
});

describe('local_maestro_provision_lane_users — what it may do to Clerk', () => {
    /** `npx` is faked so the test sees the command a real run would issue, and nothing is created or deleted. */
    function provision(env: Readonly<Record<string, string>>): string {
        const sandbox = makeSandbox();

        writeFileSync(path.join(sandbox.bin, 'npx'), `#!/usr/bin/env bash\necho "npx $*" >> "${sandbox.calls}"\n`);
        chmodSync(path.join(sandbox.bin, 'npx'), 0o755);

        const result = run(sandbox, 'local_maestro_provision_lane_users', env);

        expect(result.status).toBe(0);

        return readFileSync(sandbox.calls, 'utf8');
    }

    it('by default recycles the lane users and creates NO role users', () => {
        const calls = provision({});

        expect(calls).toContain('--apply --recycle --maestro-lane --platform android --shard 1');
        expect(calls).not.toContain('--local-roles');
    });

    it('⛔ LOCAL_MAESTRO_REUSE_USERS=1 issues no poolAdmin command at all - nothing is created or deleted in Clerk', () => {
        expect(provision({ LOCAL_MAESTRO_REUSE_USERS: '1' })).not.toContain('poolAdmin');
    });

    it('LOCAL_MAESTRO_ROLE_USERS=1 adds the capacity-checked --local-roles step, never --recycle with it', () => {
        const calls = provision({ LOCAL_MAESTRO_REUSE_USERS: '1', LOCAL_MAESTRO_ROLE_USERS: '1' });
        const roles = calls.split('\n').filter((line) => line.includes('--local-roles'));

        expect(roles).toHaveLength(1);
        expect(roles[0]).not.toContain('--recycle');
    });

    it('LOCAL_MAESTRO_ROLE_USERS=1 points the five read-only role lanes at the shared pool, and only then', () => {
        const sandbox = makeSandbox();
        const on = run(sandbox, 'local_maestro_seed_env /tmp/x; echo "ns=${E2E_ROLE_USERS_NAMESPACE:-unset}"', {
            LOCAL_MAESTRO_ROLE_USERS: '1',
        });
        const off = run(sandbox, 'local_maestro_seed_env /tmp/x; echo "ns=${E2E_ROLE_USERS_NAMESPACE:-unset}"');

        expect(on.stdout).toContain('ns=shared');
        expect(off.stdout).toContain('ns=unset');
    });

    it('anything but exactly 1 leaves both opt-ins off', () => {
        const calls = provision({ LOCAL_MAESTRO_REUSE_USERS: 'true', LOCAL_MAESTRO_ROLE_USERS: 'yes' });

        expect(calls).toContain('--recycle');
        expect(calls).not.toContain('--local-roles');
    });
});

/**
 * STEP 4 of the pool trim (2026-11-06): the lane's erasure subject exists only DURING a run. The cleanup trap deletes it, so
 * a failed run, an interrupt and a green run all leave no `test-local-*` consumable in Clerk. It deletes through
 * `poolAdmin --delete-consumables`, which is delete-only and refuses any shared user.
 */
describe('a local run deletes its erasure subject when it ends', () => {
    function withFakeNpx(): Sandbox {
        const sandbox = makeSandbox();

        writeFileSync(
            path.join(sandbox.bin, 'npx'),
            `#!/usr/bin/env bash\necho "npx $* ns=\${E2E_POOL_NAMESPACE:-unset}" >> "${sandbox.calls}"\nexit 0\n`,
        );
        chmodSync(path.join(sandbox.bin, 'npx'), 0o755);

        return sandbox;
    }

    it('issues the delete-only command with the local namespace in force', () => {
        const sandbox = withFakeNpx();

        expect(run(sandbox, `local_maestro_seed_env '${sandbox.state}'; local_maestro_delete_lane_users`).status).toBe(
            0,
        );
        expect(readFileSync(sandbox.calls, 'utf8')).toContain(
            'poolAdmin.ts --apply --delete-consumables --maestro-lane --platform android --shard 1 ns=local',
        );
    });

    it('⛔ LOCAL_MAESTRO_REUSE_USERS=1 deletes nothing - a run that reuses standing users must not remove them', () => {
        const sandbox = withFakeNpx();

        run(sandbox, `local_maestro_seed_env '${sandbox.state}'; local_maestro_delete_lane_users`, {
            LOCAL_MAESTRO_REUSE_USERS: '1',
        });

        expect(existsSync(sandbox.calls) ? readFileSync(sandbox.calls, 'utf8') : '').not.toContain('poolAdmin');
    });

    it('runs from the exit trap once provisioning began, and keeps the run’s own exit status', () => {
        const sandbox = withFakeNpx();
        const result = run(
            sandbox,
            `local_maestro_seed_env '${sandbox.state}'; LOCAL_MAESTRO_USERS_PROVISIONING=true; (exit 7); local_maestro_cleanup`,
        );

        expect(result.status).toBe(7);
        expect(readFileSync(sandbox.calls, 'utf8')).toContain('--delete-consumables');
    });

    it('does not touch Clerk when the run ended before it made any user', () => {
        const sandbox = withFakeNpx();

        run(sandbox, `local_maestro_seed_env '${sandbox.state}'; (exit 3); local_maestro_cleanup`);

        expect(existsSync(sandbox.calls) ? readFileSync(sandbox.calls, 'utf8') : '').not.toContain('poolAdmin');
    });

    it('marks provisioning as begun BEFORE it creates the first user, so a failure part-way is still cleaned', () => {
        const body = run(makeSandbox(), 'declare -f local_maestro_provision_lane_users').stdout;

        expect(body.indexOf('LOCAL_MAESTRO_USERS_PROVISIONING=true')).toBeGreaterThanOrEqual(0);
        expect(body.indexOf('LOCAL_MAESTRO_USERS_PROVISIONING=true')).toBeLessThan(body.indexOf('poolAdmin.ts'));
    });
});

describe('local_maestro_pin_cli — the Maestro on PATH is CI’s pin, not whichever one is installed', () => {
    /** The pin CI installs: the one `MAESTRO_VERSION` in `_ci-heavy.yml`. */
    const CI_PIN = /MAESTRO_VERSION:\s*'([0-9.]+)'/u.exec(
        readFileSync(path.join(REPO_ROOT, '.github/workflows/_ci-heavy.yml'), 'utf8'),
    )?.[1];

    /**
     * A fake Maestro distribution (`<dir>/bin/maestro`) that answers `--version` with `version`.
     *
     * @sideEffect Creates files under the OS temp directory.
     */
    function makeDist(root: string, name: string, version: string): string {
        const dir = path.join(root, name);

        mkdirSync(path.join(dir, 'bin'), { recursive: true });
        writeFileSync(path.join(dir, 'bin', 'maestro'), `#!/usr/bin/env bash\necho "${version}"\n`);
        chmodSync(path.join(dir, 'bin', 'maestro'), 0o755);

        return dir;
    }

    it('reads the pin from CI’s workflow, so the version is stated once', () => {
        expect(CI_PIN).toBeDefined();

        const result = run(makeSandbox(), 'local_maestro_ci_pin');

        expect(result.stdout.trim()).toBe(CI_PIN);
    });

    it('puts the pinned distribution first on PATH even when an older one is installed as ~/.maestro', () => {
        const sandbox = makeSandbox();
        const home = path.join(path.dirname(sandbox.bin), 'home');
        const stale = makeDist(home, '.maestro', '2.6.1');
        const pinned = makeDist(home, 'maestro2110', CI_PIN ?? '');
        const result = run(sandbox, 'local_maestro_pin_cli && type -P maestro && maestro --version', {
            HOME: home,
        });

        expect(result.status).toBe(0);
        expect(result.stdout.split('\n')[0]).toBe(path.join(pinned, 'bin', 'maestro'));
        expect(result.stdout).not.toContain(stale);
        expect(result.stdout).toContain(CI_PIN);
    });

    it('honours LOCAL_MAESTRO_DIST, and refuses it when it is the wrong version', () => {
        const sandbox = makeSandbox();
        const home = path.join(path.dirname(sandbox.bin), 'home');
        const wrong = makeDist(home, 'elsewhere', '2.6.1');
        const result = run(sandbox, 'local_maestro_pin_cli', { HOME: home, LOCAL_MAESTRO_DIST: wrong });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(String(CI_PIN));
    });

    it('fails, naming the pin, when no installed distribution is that version', () => {
        const sandbox = makeSandbox();
        const home = path.join(path.dirname(sandbox.bin), 'home');

        makeDist(home, '.maestro', '2.6.1');

        const result = run(sandbox, 'local_maestro_pin_cli', { HOME: home });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(String(CI_PIN));
        expect(result.stderr).toContain('2.6.1');
    });
});

describe('local_maestro_export_build_env — the APK build carries the public Clerk key CI’s build carries', () => {
    it('exports EXPO_PUBLIC_IDP_PUBLISHABLE_KEY from the loaded key, and prints nothing', () => {
        const result = run(
            makeSandbox(),
            'local_maestro_export_build_env && [ "$EXPO_PUBLIC_IDP_PUBLISHABLE_KEY" = "$CLERK_PUBLISHABLE_KEY" ] && echo same',
            { CLERK_PUBLISHABLE_KEY: FAKE_PUBLISHABLE },
        );

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('same');
        expect(result.stderr).not.toContain(FAKE_PUBLISHABLE);
    });

    it('refuses to build with no key — the Google button would be missing', () => {
        const result = run(makeSandbox(), 'local_maestro_export_build_env', { CLERK_PUBLISHABLE_KEY: '' });

        expect(result.status).not.toBe(0);
    });

    it('refuses a key that is not a test publishable key, and never echoes it', () => {
        const live = 'pk_live_SHOULDNEVERBEUSED';
        const result = run(makeSandbox(), 'local_maestro_export_build_env', { CLERK_PUBLISHABLE_KEY: live });

        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).not.toContain(live);
    });

    it('is called by the APK build, ahead of expo prebuild', () => {
        const script = readFileSync(SCRIPT, 'utf8');
        const build = script.slice(script.indexOf('local_maestro_install_app()'));

        expect(build.indexOf('local_maestro_export_build_env')).toBeGreaterThan(-1);
        expect(build.indexOf('local_maestro_export_build_env')).toBeLessThan(build.indexOf('npx expo prebuild'));
    });
});
