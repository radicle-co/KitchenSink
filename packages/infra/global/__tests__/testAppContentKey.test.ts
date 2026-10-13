// @vitest-environment node
/**
 * The content key of a built mobile test app is TURBO'S OWN task hash — and it must cover exactly what the build reads.
 *
 * ## What the key is for (owner, 2026-10-13: "when the inputs of a built app did not change, reuse it")
 *
 * `_mobileAppBuild.yml` names the app artifact `commise-test-app-<platform>-<contentKey>` and reuses an unexpired artifact
 * of that name instead of building. So the key is a CLAIM: "these exact inputs were already compiled into this
 * artifact". It is sound only if the hash covers every input of the build, and it is wasteful only if it covers files
 * the build never reads. Both directions are asserted here, against turbo's RESOLVED graph (`--dry=json`, the posture
 * `turboGlobalHash.test.ts` takes) and never against the text of `turbo.json`, because a setting that is present but
 * inert agrees with a config that is wrong.
 *
 * Pattern: Memoization key — the intent is satisfied by turbo's hashing, so there is no hasher of our own to test.
 *
 * ## The four assertions
 *
 *   1. **Dependencies are in the hash.** The app bundles every `@commise/*` and `@kitchensink/*` package it depends on,
 *      and most of them export `./src` with no `build` script of their own, so `^build` would skip them. The `transit`
 *      task (a no-op node every package gets, `dependsOn: ["^transit"]`) is what walks the whole closure.
 *   2. **The build recipe is in the hash.** `scripts/buildTestApp.sh` and `_mobileAppBuild.yml` are INPUTS: change how
 *      the app is built and the old artifact must not be served for the new recipe.
 *   3. **Test-only files are NOT.** `.maestro/` and `tests/` change on nearly every mobile PR and never reach the
 *      binary; hashing them would make every key unique and the reuse a permanent miss wearing correctness as a costume.
 *   4. **Every value baked into the binary is in the hash.** The three origins and the publishable key are compiled into
 *      the JS bundle (`EXPO_PUBLIC_*`), `TEST_APP_CACHE_EPOCH` is the manual flush, and iOS's `DEVELOPER_DIR` selects the
 *      Xcode that compiles it.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** The platforms a test app is built for — the suffix of the turbo task name `testApp:<platform>`. */
const PLATFORMS = ['android', 'ios'] as const;

interface DryTask {
    readonly taskId: string;
    readonly hash?: string;
    readonly dependencies?: readonly string[];
    readonly inputs?: Readonly<Record<string, string>>;
    readonly environmentVariables?: { readonly specified?: { readonly env?: readonly string[] } };
}

/** The environment a dry run starts from: no ambient value of anything the hash reads. */
const BASE_ENV: Readonly<Record<string, string>> = {
    EXPO_PUBLIC_RECIPE_API_URL: 'https://recipe-pr-1.example.test',
    EXPO_PUBLIC_FOOD_API_URL: 'https://food-pr-1.example.test',
    EXPO_PUBLIC_IDENTITY_API_URL: 'https://identity.example.test',
    EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: 'pk_test_example',
    TEST_APP_CACHE_EPOCH: '1',
    DEVELOPER_DIR: '/Applications/Xcode_26.5.app/Contents/Developer',
};

/**
 * Turbo's resolved plan for one platform's build task.
 *
 * @param platform - `android` or `ios`.
 * @param env - Overrides on top of {@link BASE_ENV}.
 * @returns That task's entry of the dry run.
 * @sideEffect Runs the turbo CLI against the working tree.
 */
function plan(platform: (typeof PLATFORMS)[number], env: Readonly<Record<string, string>> = {}): DryTask {
    const stdout = execFileSync(
        'npx',
        ['turbo', 'run', `testApp:${platform}`, '--filter=@commise/mobile', '--dry=json'],
        {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            // stderr is CAPTURED (it carries turbo's banner and, on failure, the reason) rather than inherited.
            stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024,
            env: { ...process.env, ...BASE_ENV, ...env },
        },
    );
    const parsed = JSON.parse(stdout) as { tasks?: readonly DryTask[] };
    const task = parsed.tasks?.find((candidate) => candidate.taskId === `@commise/mobile#testApp:${platform}`);

    if (task === undefined) {
        throw new Error(`turbo resolved no @commise/mobile#testApp:${platform} task`);
    }

    return task;
}

describe.each(PLATFORMS)('the %s test app’s content key (turbo’s task hash)', (platform) => {
    const task = plan(platform);

    it('is a real hash — an empty one would name every build the same artifact', () => {
        expect(task.hash, 'turbo emitted no hash for this task').toMatch(/^[0-9a-f]{8,}$/u);
    });

    it('⛔ covers the whole dependency closure through `transit`, including packages that have no build script', () => {
        expect(task.dependencies).toEqual(
            expect.arrayContaining(['@commise/features-recipes#transit', '@commise/ui#transit']),
        );
    });

    it('⛔ covers the build recipe: the script and the workflow that runs it', () => {
        const inputs = Object.keys(task.inputs ?? {});

        expect(inputs).toContain('scripts/buildTestApp.sh');
        expect(inputs.some((file) => file.endsWith('.github/workflows/_mobileAppBuild.yml'))).toBe(true);
    });

    it('⛔ does NOT cover files that never reach the binary: Maestro flows, tests, generated native projects', () => {
        const inputs = Object.keys(task.inputs ?? {});

        expect(
            inputs.length,
            'the dry run listed no inputs at all, so the exclusions below prove nothing',
        ).toBeGreaterThan(20);
        expect(inputs.filter((file) => file.startsWith('.maestro/'))).toEqual([]);
        expect(inputs.filter((file) => file.startsWith('tests/'))).toEqual([]);
        expect(inputs.filter((file) => /(^|\/)__tests__\//u.test(file))).toEqual([]);
        expect(inputs.filter((file) => file.startsWith('android/') || file.startsWith('ios/'))).toEqual([]);
        expect(inputs.filter((file) => file.startsWith('dist/') || file.startsWith('dist-testApp/'))).toEqual([]);
    });

    it('does cover the app’s own source, so a code change is a new key', () => {
        const inputs = Object.keys(task.inputs ?? {});

        expect(inputs).toContain('App.tsx');
        expect(inputs.some((file) => file.startsWith('src/'))).toBe(true);
    });
});

/**
 * ⛔ EVERY VALUE BAKED INTO THE BINARY CHANGES THE HASH. Declared `env` entries are hashed by VALUE, so one differing
 * origin yields a different key: that is what stops a build for `pr-91`'s origins being served to a run for `pr-92`.
 * Derived per platform, from what each build actually reads.
 */
describe.each([
    ['android', ['EXPO_PUBLIC_RECIPE_API_URL', 'EXPO_PUBLIC_FOOD_API_URL', 'EXPO_PUBLIC_IDENTITY_API_URL']],
    ['ios', ['EXPO_PUBLIC_RECIPE_API_URL', 'EXPO_PUBLIC_FOOD_API_URL', 'EXPO_PUBLIC_IDENTITY_API_URL']],
] as const)('what is baked into the %s binary', (platform, origins) => {
    const baseline = plan(platform).hash;
    const variables = [...origins, 'EXPO_PUBLIC_IDP_PUBLISHABLE_KEY', 'TEST_APP_CACHE_EPOCH'];

    it.each(variables)('changing %s changes the key', (name) => {
        expect(plan(platform, { [name]: 'a-different-value' }).hash).not.toBe(baseline);
    });

    it('declares exactly those variables (plus the Xcode path on iOS) — no more, or an unrelated value would flush the key', () => {
        const declared = [...(plan(platform).environmentVariables?.specified?.env ?? [])].sort();
        const expected = platform === 'ios' ? [...variables, 'DEVELOPER_DIR'].sort() : [...variables].sort();

        expect(declared).toEqual(expected);
    });

    it('is stable: the same inputs give the same key', () => {
        expect(plan(platform).hash).toBe(baseline);
    });
});

describe('the platforms keep separate keys', () => {
    it('an Android key is never the iOS key for the same inputs', () => {
        expect(plan('android').hash).not.toBe(plan('ios').hash);
    });

    it('⛔ DEVELOPER_DIR moves the iOS key and NOT the Android one — the Xcode path has no business in an APK’s name', () => {
        const other = { DEVELOPER_DIR: '/Applications/Xcode_99.0.app/Contents/Developer' };

        expect(plan('ios', other).hash).not.toBe(plan('ios').hash);
        expect(plan('android', other).hash).toBe(plan('android').hash);
    });
});

/**
 * `buildTestApp.sh content-key` is how a workflow job obtains the key, and it must print EXACTLY turbo's hash: a script
 * that reformatted it, or read another task's, would name artifacts differently from the job that looks them up.
 */
describe.each(PLATFORMS)('buildTestApp.sh content-key %s', (platform) => {
    it('prints exactly the task hash turbo resolves, and nothing else', () => {
        const printed = execFileSync(
            'bash',
            [`${REPO_ROOT}packages/apps/commise/mobile/scripts/buildTestApp.sh`, 'content-key', platform],
            {
                cwd: REPO_ROOT,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...BASE_ENV },
            },
        );

        expect(printed).toBe(`${plan(platform).hash ?? ''}\n`);
    });
});

/**
 * ADDED 2026-10-13 (reviewer). The plan job (Ubuntu) and a build job (Ubuntu or macOS) each compute the key and the build
 * refuses to proceed if they differ. A refusal that says only "key A is not key B" cannot be diagnosed from the logs, so
 * `content-key` also prints what turbo hashed — every input file with its hash, the declared environment variable NAMES
 * with a digest of each VALUE, the dependency hash — to STDERR, once per side, so two logs can be diffed. Stdout stays the
 * key alone (asserted above), and no environment value is ever printed: the origins and the publishable key are not
 * secrets, but "hashes only" is a rule that has no exceptions to argue about.
 */
describe.each(PLATFORMS)('buildTestApp.sh content-key %s diagnostics', (platform) => {
    const run = (env: Record<string, string> = {}) =>
        spawnSync(
            'bash',
            [`${REPO_ROOT}packages/apps/commise/mobile/scripts/buildTestApp.sh`, 'content-key', platform],
            {
                cwd: REPO_ROOT,
                encoding: 'utf8',
                env: { ...process.env, ...BASE_ENV, ...env },
            },
        );
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16);

    it('lists every input file turbo hashed, with the hash turbo reports for it', () => {
        const result = run();
        const hashed = plan(platform).inputs ?? {};

        expect(result.status, result.stderr).toBe(0);
        expect(Object.keys(hashed).length).toBeGreaterThan(20);

        for (const [file, hash] of Object.entries(hashed)) {
            expect(result.stderr, file).toContain(`input ${file} ${hash}`);
        }
    });

    it('lists each declared environment variable by NAME with a digest of its value', () => {
        const result = run();
        const names = plan(platform).environmentVariables?.specified?.env ?? [];

        expect(names.length).toBeGreaterThan(0);

        for (const name of names) {
            expect(result.stderr, name).toContain(`env ${name} ${digest(BASE_ENV[name] ?? '')}`);
        }
    });

    it('⛔ prints no environment VALUE — only digests', () => {
        const result = run();

        // (A one-character value such as the epoch `1` is a substring of any number, so only values long enough to be
        // recognisable are searched for.)
        for (const [name, value] of Object.entries(BASE_ENV).filter(([, candidate]) => candidate.length > 6)) {
            expect(result.stderr, `${name}'s value leaked into the diagnostics`).not.toContain(value);
        }
    });

    it('reports a variable that is not set as unset, rather than hashing the empty string', () => {
        const result = run({ TEST_APP_CACHE_EPOCH: '' });

        expect(result.stderr).toMatch(/^env TEST_APP_CACHE_EPOCH \(unset\)$/mu);
    });

    it('shows the difference when one variable differs, so two logs can be diffed down to the cause', () => {
        const base = run().stderr.split('\n');
        const other = run({ EXPO_PUBLIC_FOOD_API_URL: 'https://food-pr-2.example.test' }).stderr.split('\n');
        const differing = base.filter((line, index) => line !== other[index]);

        expect(differing.some((line) => line.startsWith('env EXPO_PUBLIC_FOOD_API_URL '))).toBe(true);
        expect(differing.some((line) => line.startsWith('task hash '))).toBe(true);
        expect(
            differing.filter((line) => line.startsWith('input ')),
            'a changed env var must not move any input',
        ).toEqual([]);
    });
});
