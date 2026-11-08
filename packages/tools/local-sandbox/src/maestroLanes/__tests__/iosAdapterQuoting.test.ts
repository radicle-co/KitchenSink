/**
 * Every ssh command string the iOS adapter builds is run by the Mac's shell, so a value in it must reach the Mac as ONE
 * argument whatever it holds. Each case takes the string the adapter handed to `ssh`, runs it in a real `bash` against a
 * fake `laneHost.sh` and a fake `xcrun` that print their arguments one per line, and reads the arguments back.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IosAdapter, type IosShell } from '../iosAdapter.js';
import type { LaneSpec } from '../laneTypes.js';

const HOSTILE = `a b'c;d"e $(touch pwned) \`x\``;

const MANIFEST = [
    'platform=ios',
    'recipeOrigin=http://localhost:13000',
    'foodOrigin=http://localhost:13002',
    'identityOrigin=http://localhost:13001',
].join('\n');

interface Call {
    readonly command: string;
    readonly args: readonly string[];
}

/** A shell that records every call and answers the few that the adapter reads. */
function recordingShell(answers: { ensure?: string; contentKey?: string } = {}): {
    shell: IosShell;
    calls: Call[];
} {
    const calls: Call[] = [];
    const shell: IosShell = {
        run: (command, args) => {
            calls.push({ command, args });
            const line = args.join(' ');

            if (line.includes('content-key')) {
                return Promise.resolve(`${answers.contentKey ?? 'abc'}\n`);
            }

            if (line.includes('printenv HOME')) {
                return Promise.resolve('/Users/x\n');
            }

            if (line.includes('testApp.manifest')) {
                return Promise.resolve(MANIFEST);
            }

            if (line.includes('laneHost.sh ensure')) {
                return Promise.resolve(`${answers.ensure ?? 'UDID-1'}\n`);
            }

            return Promise.resolve('');
        },
        background: () => ({ stop: () => Promise.resolve() }),
        writeFile: () => Promise.resolve(),
        linkFile: () => Promise.resolve(),
    };

    return { shell, calls };
}

const lane: LaneSpec = {
    platform: 'ios',
    index: 1,
    count: 1,
    device: 'ks-maestro-lane-1',
    driverPort: 7001,
    stateDir: '/s/lanes/ios-1',
    fixtureEnvFile: '/s/lanes/ios-1/fixture.env',
};

const adapter = (shell: IosShell): IosAdapter =>
    new IosAdapter({
        shell,
        env: { LOCAL_MAESTRO_IOS_HOST: 'me@mac' },
        repoRoot: '/repo',
        settings: {
            recipeOrigin: 'http://localhost:3000',
            identityOrigin: 'http://localhost:3001',
            foodOrigin: 'http://localhost:3002',
        },
    });

/** The command string the adapter gave `ssh`: the last argument of every ssh call. */
const remoteCommands = (calls: readonly Call[]): string[] =>
    calls.filter((call) => call.command === 'ssh').map((call) => call.args[call.args.length - 1] ?? '');

/** Runs a remote command string the way the Mac would, and returns the arguments the target received. */
function argvReceived(commandString: string): string[] {
    const home = mkdtempSync(path.join(tmpdir(), 'iosQuote-'));
    mkdirSync(path.join(home, 'ksIos/lane'), { recursive: true });
    mkdirSync(path.join(home, 'bin'));
    const printer = '#!/usr/bin/env bash\nfor a in "$@"; do printf "ARG:%s\\n" "$a"; done\n';
    writeFileSync(path.join(home, 'ksIos/lane/laneHost.sh'), printer);

    for (const tool of ['xcrun', 'mkdir', 'cat']) {
        writeFileSync(path.join(home, 'bin', tool), printer);
        chmodSync(path.join(home, 'bin', tool), 0o755);
    }

    const result = spawnSync('bash', ['-c', commandString], {
        cwd: home,
        encoding: 'utf8',
        env: { PATH: `${path.join(home, 'bin')}:/usr/bin:/bin`, HOME: home },
    });
    expect(result.stderr).toBe('');

    return result.stdout
        .split('\n')
        .filter((line) => line.startsWith('ARG:'))
        .map((line) => line.slice(4));
}

describe('IosAdapter ssh commands', () => {
    it('hands a Simulator id with a space, quotes and a semicolon to laneHost.sh and xcrun as one argument', async () => {
        const { shell, calls } = recordingShell({ ensure: HOSTILE });
        const ios = adapter(shell);
        await ios.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        calls.length = 0;
        await ios.startDevice(lane);
        await ios.stopDevice(lane);
        const received = remoteCommands(calls).map(argvReceived);
        // laneHost.sh ensure 1 | erase UDID | boot UDID | install UDID dir | mkdir | xcrun simctl shutdown UDID
        expect(received).toContainEqual(['erase', HOSTILE]);
        expect(received).toContainEqual(['boot', HOSTILE]);
        expect(received).toContainEqual(['install', HOSTILE, 'ksIos/apps/abc']);
        expect(received).toContainEqual(['simctl', 'shutdown', HOSTILE]);
    });

    it('quotes the manifest read and the lane folder the same way', async () => {
        const { shell, calls } = recordingShell();
        const ios = adapter(shell);
        await ios.prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' });
        await ios.startDevice(lane);
        const received = remoteCommands(calls).map(argvReceived);
        expect(received).toContainEqual(['ksIos/apps/abc/testApp.manifest']);
        expect(received).toContainEqual(['-p', 'ksIos/lanes/lane1']);
    });

    it('refuses a content key that is not lowercase hex, so it never reaches a remote path', async () => {
        const { shell } = recordingShell({ contentKey: `abc;touch pwned` });
        await expect(adapter(shell).prepareHost({ runId: 'r', stateDir: '/s', repoRoot: '/repo' })).rejects.toThrow(
            /content key/,
        );
    });

    it('refuses a run id that is not a plain name, because it becomes a remote folder', async () => {
        const { shell } = recordingShell();
        await expect(adapter(shell).prepareHost({ runId: HOSTILE, stateDir: '/s', repoRoot: '/repo' })).rejects.toThrow(
            /run id/,
        );
    });

    it('refuses a state folder whose ssh config path rsync would split, because rsync parses its own -e string', async () => {
        const { shell } = recordingShell();
        await expect(
            adapter(shell).prepareHost({ runId: 'r', stateDir: '/with space/s', repoRoot: '/repo' }),
        ).rejects.toThrow(/ssh config/);
    });
});
