/**
 * The baked content key: the iOS test app carries the content key it was built for, in
 * its own `Info.plist`, sealed by the app's code signature. `buildIosApp.sh check` compares THAT key, so a manifest
 * rewritten to say "key A" over an app built for key B is refused.
 *
 * The REAL scripts run under real `bash` in a temp HOME. Only the Mac is stood in for: a fake `ssh` drops `-F <cfg>
 * <host>` and runs the remote command in a local `bash` inside a fake Mac HOME, and fake `plutil`, `codesign` and
 * `xcodebuild` sit on the fake Mac's PATH. Each fake reads its answer from a fixture file in the fake `.app`, so a
 * case changes the world, never the stub. Nothing here touches a Mac or a network.
 *
 * The limit, stated once: anyone can re-sign an app ad hoc, so this stops a careless copy or edit, not a deliberate
 * forgery. Real `plutil` and `codesign` get one proof on the Mac, recorded in the PR body.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const CHECK_SCRIPT = fileURLToPath(new URL('../mac/buildIosApp.sh', import.meta.url));
const BUILD_SCRIPT = fileURLToPath(new URL('../../../../apps/commise/mobile/scripts/buildTestApp.sh', import.meta.url));
const BASH = '/bin/bash';
const SYSTEM_PATH = '/usr/bin:/bin';

const KEY_A = 'aaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbb';
const PUBLISHABLE_KEY = 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk';
const XCODE_VERSION = 'Xcode 26.5 Build version 17F42';
const APP_FOLDER = 'ksIos/apps/aaaaaaaaaaaaaaaa';
const BAKED_KEY_NAME = 'KSTestAppContentKey';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function writeExecutable(file: string, body: string): void {
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
}

interface MacWorld {
    readonly root: string;
    readonly macHome: string;
    /** Folder the fake `ssh` sits in; first on the local PATH. */
    readonly localBin: string;
    /** Folder the fake Mac tools sit in; first on the Mac PATH. */
    readonly macBin: string;
    readonly appDir: string;
}

/**
 * A fake Mac: the app folder holds a `testApp.manifest` for `manifestKey`; `plutil` answers from `<app>/Info.plist`
 * (a `name=value` line per key), and `codesign` fails when `<app>/.badSeal` exists.
 *
 * @sideEffect Creates files under the OS temp directory.
 */
function makeMac(manifestKey: string): MacWorld {
    const root = mkdtempSync(path.join(tmpdir(), 'buildIosAppCheck-'));
    roots.push(root);
    const macHome = path.join(root, 'macHome');
    const localBin = path.join(root, 'localBin');
    const macBin = path.join(root, 'macBin');
    const appDir = path.join(macHome, APP_FOLDER);

    for (const dir of [macHome, localBin, macBin, appDir]) {
        mkdirSync(dir, { recursive: true });
    }

    // ssh [-F cfg] host command: the command is the last argument, run in the fake Mac's HOME.
    writeExecutable(
        path.join(localBin, 'ssh'),
        // A `garble` file in the fake Mac's HOME makes the key probe (the command that names codesign) answer nonsense.
        `cd "${macHome}"\ncmd="\${@: -1}"\n` +
            `case "$cmd" in *codesign*) [ ! -e garble ] || { echo hello; exit 0; } ;; esac\n` +
            `HOME="${macHome}" PATH="${macBin}:${SYSTEM_PATH}" exec ${BASH} -c "$cmd"`,
    );
    writeExecutable(path.join(macBin, 'xcodebuild'), `printf 'Xcode 26.5\\nBuild version 17F42\\n'`);
    // plutil -extract <key> raw -o - <plist>: print the value, or fail when the plist or the key is absent.
    writeExecutable(
        path.join(macBin, 'plutil'),
        [
            'key="$2"; plist="$6"',
            '[ -f "$plist" ] || exit 1',
            'value="$(grep "^$key=" "$plist" | head -1 | cut -d= -f2-)" || true',
            '[ -n "$value" ] || exit 1',
            'printf %s "$value"',
        ].join('\n'),
    );
    // codesign --verify --strict <app>: the seal is good unless the fixture says otherwise.
    writeExecutable(path.join(macBin, 'codesign'), '[ ! -e "$3/.badSeal" ] || exit 1');

    const manifest = [
        'platform=ios',
        `contentKey=${manifestKey}`,
        'recipeOrigin=http://localhost:13000',
        'foodOrigin=http://localhost:13002',
        'identityOrigin=http://localhost:13001',
        `publishableKeySha256=${createHash('sha256').update(PUBLISHABLE_KEY).digest('hex')}`,
        `xcodeVersion=${XCODE_VERSION}`,
        'builtFromSha=0123456789abcdef0123456789abcdef01234567',
        'builtInRun=local',
    ];
    writeFileSync(path.join(appDir, 'testApp.manifest'), `${manifest.join('\n')}\n`);

    return { root, macHome, localBin, macBin, appDir };
}

/** Adds a `<name>.app` bundle to the app folder, baked with `bakedKey` (or with no key when it is null). */
function addApp(world: MacWorld, name: string, bakedKey: string | null): string {
    const bundle = path.join(world.appDir, `${name}.app`);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(
        path.join(bundle, 'Info.plist'),
        bakedKey === null ? 'CFBundleName=Commise\n' : `${BAKED_KEY_NAME}=${bakedKey}\n`,
    );

    return bundle;
}

function check(world: MacWorld, key: string) {
    return spawnSync(BASH, [CHECK_SCRIPT, 'check', key, APP_FOLDER], {
        encoding: 'utf8',
        env: {
            PATH: `${world.localBin}:${SYSTEM_PATH}`,
            HOME: world.root,
            KS_MAC_HOST: 'mac',
            KS_MAC_SSH_CONFIG: path.join(world.root, 'sshConfig'),
            KS_MAC_PATH: `${world.macBin}:${SYSTEM_PATH}`,
            CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
        },
    });
}

describe('buildIosApp.sh check: the baked content key', () => {
    it('accepts an app whose manifest and baked key both say the requested key', () => {
        const world = makeMac(KEY_A);
        addApp(world, 'Commise', KEY_A);

        const result = check(world, KEY_A);

        // Kills: a check that refuses everything, so the red cases below prove nothing.
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('is current');
    });

    it('refuses a manifest rewritten to key A over an app that baked key B', () => {
        const world = makeMac(KEY_A);
        addApp(world, 'Commise', KEY_B);

        const result = check(world, KEY_A);

        // Kills: comparing the manifest's key instead of the baked one (the reason this row exists).
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`baked for key ${KEY_B}`);
        expect(result.stderr).toContain(`Rebuild: buildIosApp.sh build ${KEY_A} ${APP_FOLDER}`);
    });

    it('refuses an app folder that holds no .app', () => {
        const world = makeMac(KEY_A);

        const result = check(world, KEY_A);

        // Kills: treating "nothing to compare" as a pass.
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('no .app');
        expect(result.stderr).toContain('Rebuild: buildIosApp.sh build');
    });

    it('refuses an app folder that holds two .app bundles', () => {
        const world = makeMac(KEY_A);
        addApp(world, 'Commise', KEY_A);
        addApp(world, 'Older', KEY_A);

        const result = check(world, KEY_A);

        // Kills: checking only the first bundle the glob returns.
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('more than one .app');
    });

    it('refuses an app whose Info.plist holds no baked key', () => {
        const world = makeMac(KEY_A);
        addApp(world, 'Commise', null);

        const result = check(world, KEY_A);

        // Kills: an app built before the bake existing passing on its manifest alone.
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`no ${BAKED_KEY_NAME}`);
    });

    it('refuses an app whose code signature does not verify', () => {
        const world = makeMac(KEY_A);
        const bundle = addApp(world, 'Commise', KEY_A);
        writeFileSync(path.join(bundle, '.badSeal'), '');

        const result = check(world, KEY_A);

        // Kills: reading the plist without checking the seal, so an edited plist passes.
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('signature');
    });

    it('refuses an answer from the Mac that the check does not know', () => {
        const world = makeMac(KEY_A);
        addApp(world, 'Commise', KEY_A);
        writeFileSync(path.join(world.macHome, 'garble'), '');

        const result = check(world, KEY_A);

        // Kills: dropping the catch-all arm, so a garbled answer (a login banner, a shell error) passes the check.
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('unexpected answer');
        expect(result.stderr).not.toContain('is current');
    });
});

describe('buildTestApp.sh test_app_bake_content_key', () => {
    interface Bake {
        readonly status: number | null;
        readonly stderr: string;
        readonly plutilCalls: string[];
    }

    /** Sources the real script and calls the bake function over a fake ios folder holding `plists`. */
    function bake(plists: readonly string[]): Bake {
        const root = mkdtempSync(path.join(tmpdir(), 'bakeContentKey-'));
        roots.push(root);
        const ios = path.join(root, 'ios');

        for (const plist of plists) {
            mkdirSync(path.join(ios, path.dirname(plist)), { recursive: true });
            writeFileSync(path.join(ios, plist), '');
        }

        const bin = path.join(root, 'bin');
        mkdirSync(bin);
        const log = path.join(root, 'plutil.log');
        writeExecutable(path.join(bin, 'plutil'), `printf '%s\\n' "$*" >> "${log}"\nexit 0`);
        const result = spawnSync(BASH, ['-c', `source "${BUILD_SCRIPT}" && test_app_bake_content_key "${ios}"`], {
            encoding: 'utf8',
            env: { PATH: `${bin}:${SYSTEM_PATH}`, HOME: root, TEST_APP_CONTENT_KEY: KEY_A },
        });
        const calls = existsSync(log)
            ? readFileSync(log, 'utf8')
                  .split('\n')
                  .filter((line) => line !== '')
            : [];

        return { status: result.status, stderr: result.stderr, plutilCalls: calls };
    }

    it('writes the content key into the one app Info.plist, once', () => {
        const result = bake(['Commise/Info.plist']);

        // Kills: baking the wrong key, the wrong plist name, or twice.
        expect(result.status).toBe(0);
        const replaces = result.plutilCalls.filter((call) => call.startsWith('-replace '));
        expect(replaces).toHaveLength(1);
        expect(replaces[0]).toMatch(
            new RegExp(`^-replace ${BAKED_KEY_NAME} -string ${KEY_A} .*/ios/Commise/Info\\.plist$`),
        );
    });

    it('ignores an Info.plist under Pods', () => {
        const result = bake(['Commise/Info.plist', 'Pods/Info.plist']);

        // Kills: counting a Pods plist as a second app, or baking into it.
        expect(result.status).toBe(0);
        expect(result.plutilCalls.filter((call) => call.startsWith('-replace '))).toHaveLength(1);
    });

    it('refuses when there is no Info.plist', () => {
        const result = bake([]);

        // Kills: baking nothing and reporting success.
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Info.plist');
        expect(result.plutilCalls).toEqual([]);
    });

    it('refuses when there are two Info.plist files', () => {
        const result = bake(['Commise/Info.plist', 'Other/Info.plist']);

        // Kills: baking the first plist the glob returns.
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Info.plist');
        expect(result.plutilCalls.filter((call) => call.startsWith('-replace '))).toEqual([]);
    });

    /**
     * REWRITTEN: this case used to refuse a plist that already held the key. The Mac keeps
     * `mobile/ios/` between builds (the job's rsync excludes it) and `expo prebuild` without `--clean` merges into the
     * old plist, so every build after the first would have died on that refusal. The build now always writes ITS key,
     * and the call must be `-replace`, which also inserts when the key is absent.
     */
    it('replaces a key a previous build left, so a rebuild on the kept ios folder works', () => {
        const result = bake(['Commise/Info.plist']);

        // Kills: keeping a stale key from an earlier build, or an `-insert` that fails when the key is already there.
        expect(result.status).toBe(0);
        expect(result.plutilCalls.some((call) => call.startsWith('-insert '))).toBe(false);
        expect(result.plutilCalls.filter((call) => call.startsWith('-replace '))).toHaveLength(1);
    });
});
