/**
 * Every AWS pin holds against the developer environments that used to defeat it: the default credential chain,
 * resolved as a pinned tier's worker resolves it, finds only the dummy key.
 *
 * Each case runs in a fresh Node process with a temporary `HOME`, so the real `~/.aws` is never read and the SDK's
 * file cache cannot carry one case into the next. The child's environment is the outer environment overlaid by the
 * pin, which is how vitest hands `test.env` to a worker.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { INTEGRATION_AWS_PIN } from '../integrationAwsPin.js';
import { localE2eAwsPin } from '../localAwsPin.js';

/** The harness package, from which the child resolves `@aws-sdk/credential-provider-node`. */
const HARNESS_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** Resolves the default chain and prints the key and the session token, one per line. */
const RESOLVE = [
    "import { defaultProvider } from '@aws-sdk/credential-provider-node';",
    'const found = await defaultProvider()();',
    "process.stdout.write(`${found.accessKeyId}\\n${found.sessionToken ?? ''}`);",
].join('\n');

/** A static-key profile, as `~/.aws/config` spells it. */
const CONFIG_PROFILE = '[profile fake]\naws_access_key_id = FAKE_PROFILE_KEY\naws_secret_access_key = fake-secret\n';

/** The same profile, as `~/.aws/credentials` spells it. */
const CREDENTIALS_PROFILE = '[fake]\naws_access_key_id = FAKE_PROFILE_KEY\naws_secret_access_key = fake-secret\n';

/** One developer environment: files under the temporary home, and the variables exported beside them. */
interface Outer {
    readonly files: Readonly<Record<string, string>>;
    readonly env: (home: string) => Readonly<Record<string, string>>;
}

const OUTERS: readonly (readonly [string, Outer])[] = [
    [
        'a profile exported, its keys in ~/.aws/config',
        { files: { '.aws/config': CONFIG_PROFILE }, env: () => ({ AWS_PROFILE: 'fake' }) },
    ],
    [
        'a profile exported, its keys in ~/.aws/credentials',
        { files: { '.aws/credentials': CREDENTIALS_PROFILE }, env: () => ({ AWS_PROFILE: 'fake' }) },
    ],
    [
        'a profile exported, its files named by AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE',
        {
            files: { 'elsewhere/config': CONFIG_PROFILE, 'elsewhere/credentials': CREDENTIALS_PROFILE },
            env: (home) => ({
                AWS_PROFILE: 'fake',
                AWS_CONFIG_FILE: join(home, 'elsewhere/config'),
                AWS_SHARED_CREDENTIALS_FILE: join(home, 'elsewhere/credentials'),
            }),
        },
    ],
    [
        'a session token exported',
        {
            files: { '.aws/credentials': CREDENTIALS_PROFILE.replace('[fake]', '[default]') },
            env: () => ({ AWS_SESSION_TOKEN: 'fake-session' }),
        },
    ],
];

const PINS: readonly (readonly [string, Readonly<Record<string, string>>])[] = [
    ['the LOCAL e2e pin', localE2eAwsPin({}).env],
    ['the integration pin', INTEGRATION_AWS_PIN.env],
];

const homes: string[] = [];

afterAll(() => {
    for (const home of homes) {
        rmSync(home, { recursive: true, force: true });
    }
});

/**
 * Resolve the default chain in a child whose environment is `outer` overlaid by `pin`.
 *
 * @sideEffect Creates a temporary home and spawns a Node process.
 */
function resolveUnder(
    outer: Outer,
    pin: Readonly<Record<string, string>>,
): { accessKeyId: string; sessionToken: string } {
    const home = mkdtempSync(join(tmpdir(), 'awsPinIsolation-'));

    homes.push(home);

    for (const [path, text] of Object.entries(outer.files)) {
        mkdirSync(join(home, path, '..'), { recursive: true });
        writeFileSync(join(home, path), text);
    }

    const [accessKeyId = '', sessionToken = ''] = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', RESOLVE],
        {
            cwd: HARNESS_DIR,
            encoding: 'utf8',
            env: { PATH: process.env['PATH'] ?? '', HOME: home, ...outer.env(home), ...pin },
        },
    ).split('\n');

    return { accessKeyId, sessionToken };
}

describe.each(PINS)('%s', (_pin, pin) => {
    it.each(OUTERS)('resolves only the dummy key under %s', (_outer, outer) => {
        expect(resolveUnder(outer, pin)).toEqual({ accessKeyId: 'test', sessionToken: '' });
    });
});
