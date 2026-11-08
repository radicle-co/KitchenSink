/**
 * One home for each local-stack fact (lead decision 3, 2026-11-08). `localMaestro.sh` states the AVD, the service
 * origins, the LocalStack address and the service process patterns, and prints them with `local_maestro_settings`.
 * `maestroLanes.ts` reads that output through `parseLocalSettings` and holds none of the values itself. The device's
 * `adb reverse` map lives in ONE runner function, `maestro_local_reverse`, which the one-emulator path and every lane
 * call.
 *
 * Each case runs the REAL scripts in a fresh `bash`, with fake `adb` and `curl` first on `PATH`. Nothing here touches a
 * device or the network.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseLocalSettings } from '../../src/maestroLanes/localSettings.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const SCRIPT = path.join(REPO_ROOT, 'packages/tools/local-sandbox/bin/localMaestro.sh');

interface Sandbox {
    readonly bin: string;
    readonly calls: string;
    readonly state: string;
}

/**
 * A temp directory holding a fake `adb` that logs its argv, and a `curl` that fails at once (no Metro is reached).
 *
 * @sideEffect Creates files under the OS temp directory.
 */
function makeSandbox(): Sandbox {
    const root = mkdtempSync(path.join(tmpdir(), 'localSettings-'));
    const bin = path.join(root, 'bin');
    const calls = path.join(root, 'calls.log');

    mkdirSync(bin);
    writeFileSync(calls, '');
    writeFileSync(path.join(bin, 'adb'), `#!/usr/bin/env bash\necho "adb $*" >> "${calls}"\n`);
    writeFileSync(path.join(bin, 'curl'), '#!/usr/bin/env bash\nexit 7\n');
    chmodSync(path.join(bin, 'adb'), 0o755);
    chmodSync(path.join(bin, 'curl'), 0o755);

    return { bin, calls, state: path.join(root, 'state') };
}

/**
 * Source `localMaestro.sh` (and through it the runner) and run `body`.
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

/** The `adb reverse` pairs a sandbox's fake adb saw, as `device->host`. */
const reverses = (sandbox: Sandbox): readonly string[] =>
    readFileSync(sandbox.calls, 'utf8')
        .split('\n')
        .flatMap((line) => {
            const match = /reverse tcp:(\d+) tcp:(\d+)$/u.exec(line);

            return match === null ? [] : [`${match[1]}->${match[2]}`];
        });

const settingsOf = (env: Readonly<Record<string, string>> = {}) => {
    const result = run(makeSandbox(), 'local_maestro_settings', env);

    expect(result.status, result.stderr).toBe(0);

    return parseLocalSettings(result.stdout);
};

describe('local_maestro_settings — the facts the lanes read', () => {
    it('prints every fact the TypeScript needs, and the TypeScript parses them', () => {
        const settings = settingsOf();

        expect(settings).toMatchObject({
            avd: 'ci_pixel6',
            recipeOrigin: 'http://localhost:3000',
            identityOrigin: 'http://localhost:3001',
            foodOrigin: 'http://localhost:3002',
            localstack: 'http://localhost:4566',
        });
    });

    it('names the processes the same way in pgrep -f (ERE) and in a JS RegExp', () => {
        const settings = settingsOf();
        const lines = [
            'node /repo/node_modules/.bin/tsx packages/services/recipe-workers/src/local/main.ts',
            'npx tsx packages/tools/local-sandbox/bin/queueConsumer.ts accountErasure',
            'npx tsx packages/tools/local-sandbox/bin/queueConsumer.ts accountErasure --verbose',
            'npx tsx packages/tools/local-sandbox/bin/queueConsumer.ts accountErasureRetry',
            'npx tsx packages/tools/local-sandbox/bin/queueConsumerXts accountErasure',
            'vim src/local/mainXts',
        ];

        const ere = (pattern: string): readonly string[] => {
            const result = spawnSync('grep', ['-E', pattern], { input: `${lines.join('\n')}\n`, encoding: 'utf8' });

            return result.stdout.split('\n').filter((line) => line !== '');
        };

        const bash = run(
            makeSandbox(),
            'printf "%s\\n%s\\n" "$LOCAL_MAESTRO_WORKER_PATTERN" "${LOCAL_MAESTRO_CONSUMER_PATTERN//\'{name}\'/accountErasure}"',
        );
        const [workerEre = '', consumerEre = ''] = bash.stdout.split('\n');

        expect(ere(workerEre)).toEqual(lines.filter((line) => settings.workerPattern.test(line)));
        expect(ere(consumerEre)).toEqual(lines.filter((line) => settings.consumerPattern('accountErasure').test(line)));
        // The cases a pattern must get right, so equal-but-wrong patterns fail too.
        expect(ere(workerEre)).toEqual([lines[0]]);
        expect(ere(consumerEre)).toEqual([lines[1], lines[2]]);
    });

    it('is what the one-emulator path itself asks pgrep for', () => {
        const sandbox = makeSandbox();
        writeFileSync(
            path.join(sandbox.bin, 'pgrep'),
            `#!/usr/bin/env bash\necho "pgrep $*" >> "${sandbox.calls}"\nexit 0\n`,
        );
        chmodSync(path.join(sandbox.bin, 'pgrep'), 0o755);
        mkdirSync(sandbox.state, { recursive: true });

        run(sandbox, `local_maestro_start_worker '${sandbox.state}'`);
        const stated = run(makeSandbox(), 'printf %s "$LOCAL_MAESTRO_WORKER_PATTERN"').stdout;

        expect(stated).not.toBe('');
        expect(readFileSync(sandbox.calls, 'utf8').trim()).toBe(`pgrep -f ${stated}`);
    });
});

describe('maestro_local_reverse — the one adb reverse map', () => {
    it('reverses the services, recipe onto its host port, then each extra port onto itself', () => {
        const sandbox = makeSandbox();
        const result = run(sandbox, 'maestro_local_reverse 3010 8081');

        expect(result.status, result.stderr).toBe(0);
        expect(reverses(sandbox)).toEqual(['3000->3010', '3001->3001', '3002->3002', '4000->3001', '8081->8081']);
    });

    it('reverses every origin the lanes build the app with', () => {
        const sandbox = makeSandbox();
        run(sandbox, 'maestro_local_reverse 3000');
        const settings = settingsOf();

        for (const origin of [settings.recipeOrigin, settings.identityOrigin, settings.foodOrigin]) {
            expect(reverses(sandbox)).toContain(`${new URL(origin).port}->${new URL(origin).port}`);
        }
    });

    it('is the map the one-emulator install uses, plus Metro, with the moved recipe host port', () => {
        const sandbox = makeSandbox();
        const apk = path.join(mkdtempSync(path.join(tmpdir(), 'localSettings-apk-')), 'app-debug.apk');
        writeFileSync(apk, '');
        mkdirSync(sandbox.state, { recursive: true });

        // The install fails at the bundle fetch (the fake curl), after the reverses this compares.
        run(sandbox, `LOCAL_MAESTRO_DEBUG_APK='${apk}'\nlocal_maestro_install_app '${sandbox.state}'`, {
            LOCAL_MAESTRO_RECIPE_HOST_PORT: '3010',
        });

        expect(reverses(sandbox)).toEqual(['3000->3010', '3001->3001', '3002->3002', '4000->3001', '8081->8081']);
    });
});

describe('parseLocalSettings — the boundary', () => {
    const valid = [
        'LOCAL_MAESTRO_AVD=ci_pixel6',
        'LOCAL_MAESTRO_RECIPE_ORIGIN=http://localhost:3000',
        'LOCAL_MAESTRO_IDENTITY_ORIGIN=http://localhost:3001',
        'LOCAL_MAESTRO_FOOD_ORIGIN=http://localhost:3002',
        'LOCAL_MAESTRO_LOCALSTACK=http://localhost:4566',
        'LOCAL_MAESTRO_WORKER_PATTERN=src/local/main\\.ts',
        'LOCAL_MAESTRO_CONSUMER_PATTERN=bin/queueConsumer\\.ts {name}( |$)',
    ];

    it('reads a value that holds an equals sign whole', () => {
        const text = valid.map((line) => (line.startsWith('LOCAL_MAESTRO_AVD=') ? 'LOCAL_MAESTRO_AVD=a=b' : line));

        expect(parseLocalSettings(text.join('\n')).avd).toBe('a=b');
    });

    it.each([
        ['a missing fact', valid.slice(1)],
        ['an unknown fact', [...valid, 'LOCAL_MAESTRO_SOMETHING=x']],
        ['a fact stated twice', [...valid, valid[0] ?? '']],
        ['a line that is not KEY=value', [...valid, 'nonsense']],
        ['an origin that is not a URL', valid.map((line) => line.replace('http://localhost:3001', 'localhost:3001'))],
        ['a pattern that does not compile', valid.map((line) => line.replace('src/local/main\\.ts', 'src/(local'))],
        ['a consumer pattern with no {name}', valid.map((line) => line.replace('{name}', 'accountErasure'))],
    ])('refuses %s', (_label, lines) => {
        expect(() => parseLocalSettings(lines.join('\n'))).toThrow(/local_maestro_settings/u);
    });
});

/**
 * The guard that catches a copy coming back: the lane TypeScript reads every one of these facts from the settings, so a
 * literal of any of them in these files is a second home.
 */
describe('the lane TypeScript holds none of the facts', () => {
    const files = [
        'packages/tools/local-sandbox/bin/maestroLanes.ts',
        'packages/tools/local-sandbox/src/maestroLanes/androidAdapter.ts',
    ];

    it.each(files)('%s states no AVD, origin, LocalStack address or process pattern', (file) => {
        const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');

        for (const literal of [
            'ci_pixel6',
            'localhost:3000',
            'localhost:3001',
            'localhost:3002',
            'localhost:4566',
            'queueConsumer\\\\.ts',
            'src\\/local\\/main',
        ]) {
            expect(text, literal).not.toContain(literal);
        }
    });
});
