// @vitest-environment node
/**
 * `buildTestApp.sh verify-manifest` — the Specification a shard applies to a downloaded test app before it spends a
 * minute of an emulator on it.
 *
 * ## What the manifest is for (owner, 2026-10-13)
 *
 * The built app is REUSED when its content key matches (`_mobileAppBuild.yml`), so a shard receives a binary some other
 * run built. A binary baked for `pr-91`'s origins and driven against `pr-92` does not fail loudly: it signs in, then every
 * request goes to the wrong stage and the flows report defects that are not defects. So the artifact carries
 * `testApp.manifest` — what it was built FROM — and the shard refuses anything that is not exactly what THIS run
 * resolved. The refusal is a guard clause: no app, or the wrong app, is a red job, never a green one.
 *
 * ## What is asserted, and why a fixture table
 *
 * Executed against the real script (never re-implemented here), over a table of manifests: one exact match, each
 * compared field mutated in turn, and each structural fault — a missing file, a missing key, an unknown key, a duplicate,
 * a blank value, the other platform's manifest. A test that only fed the happy path would pass a verifier that returned 0
 * unconditionally, so the table is built from the faults and the match is one row of it.
 *
 * `builtFromSha` and `builtInRun` are PROVENANCE: they must be present and are never compared, because they differ on
 * every reused artifact by design. A row proves that, too.
 *
 * Pattern: Specification — `verify-manifest` is a pure predicate over (manifest, expectations); `write-manifest` is its
 * only producer, and the round-trip row is what keeps the two from drifting apart.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/scripts/buildTestApp.sh');

const scratch = mkdtempSync(join(tmpdir(), 'build-test-app-manifest-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

type Platform = 'android' | 'ios';

/** What THIS run resolved — the expectations a downloaded app is held to. */
const EXPECTED = {
    contentKey: '4f684c1e9bbb30ad',
    recipeOrigin: 'https://recipe-pr-91.commise.app',
    foodOrigin: 'https://food-pr-91.commise.app',
    identityOrigin: 'https://identity.sandbox.commise.app',
    publishableKey: 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk',
    xcodeVersion: 'Xcode 26.5 Build version 17F42',
} as const;

/** The expectation environment `verify-manifest` reads. */
const expectEnv = (platform: Platform): Record<string, string> => ({
    EXPECT_CONTENT_KEY: EXPECTED.contentKey,
    EXPECT_RECIPE_ORIGIN: EXPECTED.recipeOrigin,
    EXPECT_FOOD_ORIGIN: EXPECTED.foodOrigin,
    EXPECT_IDENTITY_ORIGIN: EXPECTED.identityOrigin,
    EXPECT_PUBLISHABLE_KEY: EXPECTED.publishableKey,
    ...(platform === 'ios' ? { EXPECT_XCODE_VERSION: EXPECTED.xcodeVersion } : {}),
});

/** The digest the script is expected to record for the publishable key (hex SHA-256 of its bytes, no newline). */
const KEY_SHA256 = createHash('sha256').update(EXPECTED.publishableKey).digest('hex');

/** A manifest as the script writes it, as ordered `[key, value]` pairs so a case can break one line. */
const goodPairs = (platform: Platform): [string, string][] => [
    ['platform', platform],
    ['contentKey', EXPECTED.contentKey],
    ['recipeOrigin', EXPECTED.recipeOrigin],
    ['foodOrigin', EXPECTED.foodOrigin],
    ['identityOrigin', EXPECTED.identityOrigin],
    ['publishableKeySha256', KEY_SHA256],
    platform === 'android' ? ['abis', 'x86_64'] : ['xcodeVersion', EXPECTED.xcodeVersion],
    ['builtFromSha', '0123456789abcdef0123456789abcdef01234567'],
    ['builtInRun', '38322183404'],
];

let counter = 0;

/** Write a manifest body to a fresh file and return its path. */
function manifestFile(body: string): string {
    counter += 1;

    const file = join(scratch, `testApp-${counter}.manifest`);

    writeFileSync(file, body, 'utf8');

    return file;
}

const render = (pairs: readonly (readonly [string, string])[]): string =>
    `${pairs.map(([key, value]) => `${key}=${value}`).join('\n')}\n`;

interface Outcome {
    readonly status: number;
    readonly output: string;
}

/** Run `verify-manifest` over a file with the given expectation environment. */
function verify(file: string, platform: string, env: Record<string, string>): Outcome {
    const result = spawnSync('bash', [SCRIPT, 'verify-manifest', file, platform], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', HOME: scratch, ...env },
    });

    return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('verify-manifest — the exact match', () => {
    it.each(['android', 'ios'] as const)('accepts the %s manifest this run expects', (platform) => {
        const outcome = verify(manifestFile(render(goodPairs(platform))), platform, expectEnv(platform));

        expect(outcome.status, outcome.output).toBe(0);
    });

    it('⛔ never compares provenance: a different commit and run still match', () => {
        const pairs = goodPairs('android').map(([key, value]): [string, string] =>
            key === 'builtFromSha'
                ? [key, 'ffffffffffffffffffffffffffffffffffffffff']
                : key === 'builtInRun'
                  ? [key, '1']
                  : [key, value],
        );

        expect(verify(manifestFile(render(pairs)), 'android', expectEnv('android')).status).toBe(0);
    });
});

/**
 * ⛔ EACH COMPARED FIELD, MUTATED. A verifier that skipped one field would accept a binary built for another origin, another
 * key or another Xcode — and only the field it skipped would show it, so every field has its own row.
 */
describe('verify-manifest — a field that differs is refused', () => {
    const compared = [
        ['platform', 'ios', 'android'],
        ['contentKey', 'deadbeefdeadbeef', 'android'],
        ['recipeOrigin', 'https://recipe-pr-92.commise.app', 'android'],
        ['foodOrigin', 'https://food-pr-92.commise.app', 'android'],
        ['identityOrigin', 'https://identity.prod.commise.app', 'android'],
        ['publishableKeySha256', '0'.repeat(64), 'android'],
        ['abis', 'arm64-v8a,x86_64', 'android'],
        ['platform', 'android', 'ios'],
        ['contentKey', 'deadbeefdeadbeef', 'ios'],
        ['recipeOrigin', 'https://recipe-pr-92.commise.app', 'ios'],
        ['foodOrigin', 'https://food-pr-92.commise.app', 'ios'],
        ['identityOrigin', 'https://identity.prod.commise.app', 'ios'],
        ['publishableKeySha256', '0'.repeat(64), 'ios'],
        ['xcodeVersion', 'Xcode 26.4 Build version 17E1', 'ios'],
    ] as const;

    it.each(compared)('%s := %s on %s', (field, value, platform) => {
        const pairs = goodPairs(platform).map(([key, current]): [string, string] =>
            key === field ? [key, value] : [key, current],
        );
        const outcome = verify(manifestFile(render(pairs)), platform, expectEnv(platform));

        expect(outcome.status, 'a mutated field was accepted').not.toBe(0);
        expect(outcome.output).toContain(field);
    });

    it.each([
        ['a trailing space', (value: string) => `${value} `],
        ['a leading space', (value: string) => ` ${value}`],
        ['a changed letter case', (value: string) => value.toUpperCase()],
    ])('⛔ is an EXACT match: %s is a different value', (_, mutate) => {
        const pairs = goodPairs('android').map(([key, value]): [string, string] =>
            key === 'recipeOrigin' ? [key, mutate(value)] : [key, value],
        );

        expect(verify(manifestFile(render(pairs)), 'android', expectEnv('android')).status).not.toBe(0);
    });
});

describe('verify-manifest — a malformed manifest is refused', () => {
    const android = goodPairs('android');

    it('refuses a manifest file that does not exist', () => {
        const outcome = verify(join(scratch, 'absent.manifest'), 'android', expectEnv('android'));

        expect(outcome.status).not.toBe(0);
        expect(outcome.output).toMatch(/::error::/u);
    });

    it('refuses an empty file', () => {
        expect(verify(manifestFile(''), 'android', expectEnv('android')).status).not.toBe(0);
    });

    it.each(android.map(([key]) => key))('refuses a manifest with %s MISSING', (missing) => {
        const pairs = android.filter(([key]) => key !== missing);
        const outcome = verify(manifestFile(render(pairs)), 'android', expectEnv('android'));

        expect(outcome.status, `a manifest without ${missing} was accepted`).not.toBe(0);
        expect(outcome.output).toContain(missing);
    });

    it('⛔ refuses an UNKNOWN key — a field this verifier does not know is a field it did not compare', () => {
        const pairs: [string, string][] = [...android, ['sneaky', 'value']];
        const outcome = verify(manifestFile(render(pairs)), 'android', expectEnv('android'));

        expect(outcome.status).not.toBe(0);
        expect(outcome.output).toContain('sneaky');
    });

    it('⛔ refuses the OTHER platform’s key: an iOS field in an Android manifest', () => {
        const pairs: [string, string][] = [...android, ['xcodeVersion', EXPECTED.xcodeVersion]];

        expect(verify(manifestFile(render(pairs)), 'android', expectEnv('android')).status).not.toBe(0);
    });

    it('⛔ refuses a DUPLICATE key, even when both copies are right — the second could be the one read', () => {
        const pairs: [string, string][] = [...android, ['recipeOrigin', EXPECTED.recipeOrigin]];

        expect(verify(manifestFile(render(pairs)), 'android', expectEnv('android')).status).not.toBe(0);
    });

    it.each(['builtFromSha', 'builtInRun'])(
        'refuses a BLANK %s: provenance may differ, it may not be absent',
        (blank) => {
            const pairs = android.map(([key, value]): [string, string] => (key === blank ? [key, ''] : [key, value]));

            expect(verify(manifestFile(render(pairs)), 'android', expectEnv('android')).status).not.toBe(0);
        },
    );

    it('refuses a line that is not key=value', () => {
        expect(verify(manifestFile(`${render(android)}not a pair\n`), 'android', expectEnv('android')).status).not.toBe(
            0,
        );
    });

    it('refuses CRLF line endings: a carriage return is part of the value, and an exact match must not forgive it', () => {
        expect(
            verify(manifestFile(render(android).replace(/\n/gu, '\r\n')), 'android', expectEnv('android')).status,
        ).not.toBe(0);
    });

    it('refuses the iOS manifest when asked about Android, and the reverse', () => {
        expect(verify(manifestFile(render(goodPairs('ios'))), 'android', expectEnv('android')).status).not.toBe(0);
        expect(verify(manifestFile(render(goodPairs('android'))), 'ios', expectEnv('ios')).status).not.toBe(0);
    });

    it('refuses a platform it does not know', () => {
        expect(verify(manifestFile(render(android)), 'windows', expectEnv('android')).status).not.toBe(0);
    });
});

/**
 * ⛔ AN ABSENT EXPECTATION IS A REFUSAL, NEVER A SKIP. If `EXPECT_RECIPE_ORIGIN` were unset and the verifier treated that
 * as "nothing to compare", a workflow that lost the variable would accept any binary — the failure the whole check exists to
 * prevent, hidden behind a green job.
 */
describe('verify-manifest — an expectation that is not stated is refused', () => {
    const base = expectEnv('ios');

    it.each(Object.keys(base))('refuses when %s is unset', (name) => {
        const env = { ...base };

        delete env[name];

        const outcome = verify(manifestFile(render(goodPairs('ios'))), 'ios', env);

        expect(outcome.status, `accepted with ${name} unset`).not.toBe(0);
        expect(outcome.output).toContain(name);
    });

    it.each(Object.keys(base))('refuses when %s is EMPTY', (name) => {
        expect(verify(manifestFile(render(goodPairs('ios'))), 'ios', { ...base, [name]: '' }).status).not.toBe(0);
    });

    /**
     * The row that gives the guard its own reason to exist: with the expectation EMPTY and the manifest's field BLANK the
     * two are equal, so a verifier that only compared (and leaned on `set -u` for the unset case) would call a blank
     * origin a match. Blank is not a statement of anything.
     */
    it.each([
        ['EXPECT_RECIPE_ORIGIN', 'recipeOrigin'],
        ['EXPECT_FOOD_ORIGIN', 'foodOrigin'],
        ['EXPECT_IDENTITY_ORIGIN', 'identityOrigin'],
        ['EXPECT_CONTENT_KEY', 'contentKey'],
    ])('⛔ refuses a BLANK manifest field matched by an EMPTY %s', (name, field) => {
        const pairs = goodPairs('android').map(([key, value]): [string, string] =>
            key === field ? [key, ''] : [key, value],
        );

        expect(verify(manifestFile(render(pairs)), 'android', { ...expectEnv('android'), [name]: '' }).status).not.toBe(
            0,
        );
    });

    it('does not require the Xcode expectation for Android', () => {
        expect(verify(manifestFile(render(goodPairs('android'))), 'android', expectEnv('android')).status).toBe(0);
    });
});

/**
 * THE PRODUCER AND THE VERIFIER AGREE. `write-manifest` is the only thing that writes a manifest and `verify-manifest` is
 * the only thing that reads one, in two jobs on two operating systems. The round trip is what stops a field being renamed
 * on one side only.
 */
describe('write-manifest — what the build records is what the shard checks', () => {
    /** A stub `xcodebuild` so the iOS arm needs no Xcode. */
    const stubBin = join(scratch, 'bin');

    mkdirSync(stubBin, { recursive: true });
    writeFileSync(join(stubBin, 'xcodebuild'), `#!/usr/bin/env bash\nprintf 'Xcode 26.5\\nBuild version 17F42\\n'\n`);
    chmodSync(join(stubBin, 'xcodebuild'), 0o755);

    const writeEnv = (): Record<string, string> => ({
        PATH: `${stubBin}:${process.env['PATH'] ?? ''}`,
        HOME: scratch,
        TEST_APP_CONTENT_KEY: EXPECTED.contentKey,
        EXPO_PUBLIC_RECIPE_API_URL: EXPECTED.recipeOrigin,
        EXPO_PUBLIC_FOOD_API_URL: EXPECTED.foodOrigin,
        EXPO_PUBLIC_IDENTITY_API_URL: EXPECTED.identityOrigin,
        EXPO_PUBLIC_IDP_PUBLISHABLE_KEY: EXPECTED.publishableKey,
        GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
        GITHUB_RUN_ID: '38322183404',
    });

    it.each(['android', 'ios'] as const)('a %s manifest it writes is accepted by verify-manifest', (platform) => {
        const file = join(scratch, `written-${platform}.manifest`);
        const written = spawnSync('bash', [SCRIPT, 'write-manifest', platform, file], {
            encoding: 'utf8',
            env: writeEnv(),
        });

        expect(written.status, `${written.stdout}${written.stderr}`).toBe(0);

        const outcome = verify(file, platform, expectEnv(platform));

        expect(outcome.status, outcome.output).toBe(0);
    });

    it('⛔ records a digest of the publishable key, never the key itself', () => {
        const file = join(scratch, 'written-digest.manifest');

        spawnSync('bash', [SCRIPT, 'write-manifest', 'android', file], { encoding: 'utf8', env: writeEnv() });

        const text = readFileSync(file, 'utf8');

        expect(text).not.toContain(EXPECTED.publishableKey);
        expect(text).toContain(`publishableKeySha256=${KEY_SHA256}`);
    });

    it('refuses to write when a value it records is not stated', () => {
        const env = writeEnv();

        delete env['EXPO_PUBLIC_FOOD_API_URL'];

        const written = spawnSync('bash', [SCRIPT, 'write-manifest', 'android', join(scratch, 'never.manifest')], {
            encoding: 'utf8',
            env,
        });

        expect(written.status).not.toBe(0);
    });
});

describe('buildTestApp.sh — the front door', () => {
    const run = (...args: readonly string[]): Outcome => {
        const result = spawnSync('bash', [SCRIPT, ...args], {
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', HOME: scratch },
        });

        return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    };

    it('refuses a missing subcommand, an unknown one, and an unknown platform', () => {
        expect(run().status).not.toBe(0);
        expect(run('nonsense').status).not.toBe(0);
        expect(run('content-key', 'windows').status).not.toBe(0);
        expect(run('verify-manifest', '/nonexistent').status).not.toBe(0);
    });
});

/**
 * THE NAME IS THE LOOKUP KEY, so its two halves must be exact inverses and live in ONE place. The build workflow names an
 * artifact with `artifact-name`; a shard recovers the content key it must hold the manifest to with
 * `key-from-artifact-name`. Two copies of the convention (a `printf` in one workflow, a regex in another) is how a
 * rename on one side silently makes every reuse a miss, or worse, every shard verify against the wrong key.
 */
describe('artifact-name and key-from-artifact-name — one convention, two inverse halves', () => {
    const run = (...args: readonly string[]): Outcome => {
        const result = spawnSync('bash', [SCRIPT, ...args], {
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', HOME: scratch },
        });

        return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    };

    it.each(['android', 'ios'] as const)('names a %s artifact commise-test-app-<platform>-<key>', (platform) => {
        const outcome = run('artifact-name', platform, EXPECTED.contentKey);

        expect(outcome.status, outcome.output).toBe(0);
        expect(outcome.output).toBe(`commise-test-app-${platform}-${EXPECTED.contentKey}\n`);
    });

    it.each(['android', 'ios'] as const)('recovers the key from the %s name it just made', (platform) => {
        const name = run('artifact-name', platform, EXPECTED.contentKey).output.trim();
        const outcome = run('key-from-artifact-name', platform, name);

        expect(outcome.status, outcome.output).toBe(0);
        expect(outcome.output).toBe(`${EXPECTED.contentKey}\n`);
    });

    it.each([
        ['an empty key', 'artifact-name', 'android', ''],
        ['a key that is not hex', 'artifact-name', 'android', 'not-a-key'],
        ['an upper-case key', 'artifact-name', 'android', 'DEADBEEFDEADBEEF'],
        ['a key with a path separator', 'artifact-name', 'android', '../4f684c1e9bbb30ad'],
        ['an unknown platform', 'artifact-name', 'windows', EXPECTED.contentKey],
    ])('⛔ refuses to NAME an artifact from %s', (_, command, platform, key) => {
        expect(run(command, platform, key).status).not.toBe(0);
    });

    it.each([
        ['the other platform’s name', 'android', `commise-test-app-ios-${EXPECTED.contentKey}`],
        ['an empty name', 'android', ''],
        ['a name with no key', 'android', 'commise-test-app-android-'],
        ['a name with another prefix', 'android', `other-android-${EXPECTED.contentKey}`],
        ['a name with a trailing suffix', 'android', `commise-test-app-android-${EXPECTED.contentKey}-extra`],
        ['a name with a non-hex key', 'android', 'commise-test-app-android-zzzz'],
        ['a name with a newline in it', 'android', `commise-test-app-android-${EXPECTED.contentKey}\nsneaky`],
    ])('⛔ refuses to read a key out of %s', (_, platform, name) => {
        expect(run('key-from-artifact-name', platform, name).status).not.toBe(0);
    });
});

describe('xcode-version — the one normalisation of `xcodebuild -version`', () => {
    it('prints the two lines as one, with no trailing space — exactly what write-manifest records', () => {
        const bin = join(scratch, 'xbin');

        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'xcodebuild'), `#!/usr/bin/env bash\nprintf 'Xcode 26.5\\nBuild version 17F42\\n'\n`);
        chmodSync(join(bin, 'xcodebuild'), 0o755);

        const result = spawnSync('bash', [SCRIPT, 'xcode-version'], {
            encoding: 'utf8',
            env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, HOME: scratch },
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe(`${EXPECTED.xcodeVersion}\n`);
    });
});

/**
 * `select-reusable` — which earlier run's artifact may stand in for a build. Fed the GitHub API's own response shape on
 * stdin, so the SELECTION (not the transport) is what is under test.
 *
 * ## The rule, and the two ways it can be wrong
 *
 * An artifact may be reused if it is NAMED for this content key (the API's `name` filter is already exact; the script
 * checks it again), is not expired, and was produced by a run of THIS repository — `workflow_run.repository_id` AND
 * `workflow_run.head_repository_id` both equal the current repository's id. The second is the one that matters: a run of
 * a FORK's pull request has a different head repository, and an artifact it uploaded is code from outside the
 * repository. Accepting it would let a fork choose the binary every shard installs. Wrong in the other direction — too
 * strict — only costs a rebuild, which is why every doubtful row below is a REFUSAL.
 */
describe('select-reusable — which earlier build may be reused', () => {
    const NAME = `commise-test-app-android-${EXPECTED.contentKey}`;
    const REPO = 1_234_567;

    interface FakeArtifact {
        name?: string;
        expired?: boolean;
        created_at?: string;
        workflow_run?: { id?: number; repository_id?: number; head_repository_id?: number } | null;
    }

    const artifact = (overrides: FakeArtifact = {}): FakeArtifact => ({
        name: NAME,
        expired: false,
        created_at: '2026-10-13T10:00:00Z',
        workflow_run: { id: 111, repository_id: REPO, head_repository_id: REPO },
        ...overrides,
    });

    const select = (response: unknown, repoId: string = String(REPO), name: string = NAME): Outcome => {
        const result = spawnSync('bash', [SCRIPT, 'select-reusable', repoId, name], {
            encoding: 'utf8',
            input: typeof response === 'string' ? response : JSON.stringify(response),
            env: { PATH: process.env['PATH'] ?? '', HOME: scratch },
        });

        return {
            status: result.status ?? -1,
            output: result.status === 0 ? (result.stdout ?? '') : `${result.stdout}${result.stderr}`,
        };
    };

    it('chooses the NEWEST unexpired artifact of this repository and prints its run id', () => {
        const outcome = select({
            artifacts: [
                artifact({
                    created_at: '2026-10-10T10:00:00Z',
                    workflow_run: { id: 100, repository_id: REPO, head_repository_id: REPO },
                }),
                artifact({
                    created_at: '2026-10-12T10:00:00Z',
                    workflow_run: { id: 300, repository_id: REPO, head_repository_id: REPO },
                }),
                artifact({
                    created_at: '2026-10-11T10:00:00Z',
                    workflow_run: { id: 200, repository_id: REPO, head_repository_id: REPO },
                }),
            ],
        });

        expect(outcome.status, outcome.output).toBe(0);
        expect(outcome.output).toBe('300\n');
    });

    it.each([
        ['an empty list', { artifacts: [] }],
        ['no artifacts key at all', {}],
        ['an expired artifact', { artifacts: [artifact({ expired: true })] }],
        [
            '⛔ a FORK’s artifact: head repository differs',
            { artifacts: [artifact({ workflow_run: { id: 9, repository_id: REPO, head_repository_id: 999 } })] },
        ],
        [
            'an artifact of a different repository',
            { artifacts: [artifact({ workflow_run: { id: 9, repository_id: 999, head_repository_id: REPO } })] },
        ],
        ['an artifact with another name', { artifacts: [artifact({ name: 'commise-test-app-android-deadbeef' })] }],
        ['an artifact with no workflow_run', { artifacts: [artifact({ workflow_run: null })] }],
        [
            'an artifact whose workflow_run lacks the head repository',
            { artifacts: [artifact({ workflow_run: { id: 9, repository_id: REPO } })] },
        ],
        [
            'an artifact with no expired field (unknown is not fresh)',
            {
                artifacts: [
                    {
                        name: NAME,
                        created_at: '2026-10-13T10:00:00Z',
                        workflow_run: { id: 9, repository_id: REPO, head_repository_id: REPO },
                    },
                ],
            },
        ],
    ])('finds nothing in %s — a miss, never a guess', (_, response) => {
        const outcome = select(response);

        expect(outcome.status, outcome.output).toBe(0);
        expect(outcome.output).toBe('');
    });

    it('⛔ skips the fork’s newer artifact and takes the repository’s own older one', () => {
        const outcome = select({
            artifacts: [
                artifact({
                    created_at: '2026-10-13T12:00:00Z',
                    workflow_run: { id: 777, repository_id: REPO, head_repository_id: 999 },
                }),
                artifact({
                    created_at: '2026-10-01T12:00:00Z',
                    workflow_run: { id: 5, repository_id: REPO, head_repository_id: REPO },
                }),
            ],
        });

        expect(outcome.output).toBe('5\n');
    });

    it.each([
        ['a repository id that is not a number', 'abc'],
        ['an empty repository id', ''],
        ['a repository id with a sign', '-1'],
        ['a repository id carrying jq syntax', '1 | .'],
    ])('⛔ refuses %s — it is spliced into a jq program', (_, repoId) => {
        expect(select({ artifacts: [artifact()] }, repoId).status).not.toBe(0);
    });

    it('refuses input that is not JSON rather than reading it as "nothing found"', () => {
        expect(select('<html>rate limited</html>').status).not.toBe(0);
    });
});
