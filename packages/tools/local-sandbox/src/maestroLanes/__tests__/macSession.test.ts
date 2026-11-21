import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MacSession, macPathsOf, type MacShell } from '../macSession.js';

interface Call {
    readonly command: string;
    readonly args: readonly string[];
}

function recorder(answers: Record<string, string> = {}, probes: Record<number, string[]> = {}) {
    const calls: Call[] = [];
    let asked = 0;
    let exitTunnel: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
        exitTunnel = resolve;
    });
    const files = new Map<string, string>();
    const links: [string, string][] = [];
    const tunnels: string[][] = [];
    let stopped = 0;
    const shell: MacShell = {
        run: (command, args) => {
            calls.push({ command, args });
            const line = [command, ...args].join(' ');
            const probed = /127\.0\.0\.1:(\d+)\/health/u.exec(line);

            if (probed !== null) {
                asked += 1;

                // A missing deadline fails here at once, where it would otherwise spin until the suite times out.
                if (asked > 50) {
                    return Promise.reject(new Error('the probe asked more than 50 times: it has no deadline'));
                }

                const queue = probes[Number(probed[1])] ?? ['200'];

                if (queue[0] === 'REJECT') {
                    return Promise.reject(new Error('ssh: connect to host mac port 22: Connection refused'));
                }

                return Promise.resolve(queue.length > 1 ? (queue.shift() ?? '200') : (queue[0] ?? '200'));
            }

            const hit = Object.entries({ 'printenv HOME': '/Users/x\n', ...answers }).find(([needle]) =>
                line.includes(needle),
            );

            return Promise.resolve(hit === undefined ? '' : hit[1]);
        },
        background: (command, args) => {
            tunnels.push([command, ...args]);

            return {
                stop: () => {
                    stopped += 1;

                    return Promise.resolve();
                },
                exited,
            };
        },
        writeFile: (file, content) => {
            files.set(file, content);

            return Promise.resolve();
        },
        linkFile: (target, link) => {
            links.push([target, link]);

            return Promise.resolve();
        },
    };

    return { shell, calls, files, links, tunnels, exitTunnel, asked: () => asked, stopped: () => stopped };
}

/**
 * A session on a fake clock: `sleep` moves the clock by the wait, and every command to the Mac moves it by `replyMs`,
 * as a real ssh round trip would. So no test waits and none reads the wall clock.
 */
const make = (
    shell: MacShell,
    env: Record<string, string | undefined> = { LOCAL_MAESTRO_IOS_HOST: 'me@mac' },
    sleeps: number[] = [],
    replyMs = 0,
) => {
    let clock = 0;
    const timed: MacShell = {
        ...shell,
        run: (command, args, runEnv) => {
            clock += replyMs;

            return shell.run(command, args, runEnv);
        },
    };

    return new MacSession({
        shell: timed,
        env,
        repoRoot: '/repo',
        now: () => clock,
        sleep: (ms) => {
            sleeps.push(ms);
            clock += ms;

            return Promise.resolve();
        },
    });
};

const run = { runId: 'r', stateDir: '/s', repoRoot: '/repo' };

const FORWARDS = [
    { origin: 'recipeOrigin', macPort: 3000, localPort: 3000 },
    { origin: 'identityOrigin', macPort: 3001, localPort: 3001 },
] as const;

describe('MacSession', () => {
    it('refuses to be built without a Mac host', () => {
        expect(() => make(recorder().shell, {})).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
    });

    it('refuses to state the Mac folders before open() has read the Mac HOME, rather than answering paths under /', () => {
        expect(() => make(recorder().shell).paths).toThrow(/open/u);
    });

    it('reads host facts over a plain one-off ssh, after putting the lane script on the Mac', async () => {
        const rec = recorder({
            'laneHost.sh facts': 'ncpu 14\nmemsize 100\nloadavg { 1 1 1 }\nSystem-wide memory free percentage: 50%\n',
        });
        const facts = await make(rec.shell).facts();

        expect(facts.cpus).toBe(14);
        expect(rec.calls.map((c) => c.command)).toEqual(['ssh', 'scp', 'ssh']);
    });

    it('opens once: writes a short-socket ssh config, reads the Mac HOME and puts both lane scripts on the Mac', async () => {
        const rec = recorder();
        const session = make(rec.shell);
        await session.open(run);

        expect(rec.files.get('/s/ssh.conf')).toContain('ControlMaster auto');
        expect(session.macHome).toBe('/Users/x');
        const copied = rec.calls.filter((c) => c.command === 'scp').map((c) => c.args.join(' '));
        expect(copied.some((c) => c.includes('bin/mac/laneHost.sh'))).toBe(true);
        expect(copied.some((c) => c.includes('bin/mac/androidLaneHost.sh'))).toBe(true);
    });

    it('refuses a run id that is not a plain name, and a state folder rsync would split', async () => {
        await expect(make(recorder().shell).open({ ...run, runId: 'a b' })).rejects.toThrow(/run id/);
        await expect(make(recorder().shell).open({ ...run, stateDir: '/with space' })).rejects.toThrow(/ssh config/);
    });

    it('quotes every word of a lane script command', async () => {
        const rec = recorder();
        const session = make(rec.shell);
        await session.open(run);
        rec.calls.length = 0;
        await session.laneHost('erase', "a b'c;d");

        const sent = rec.calls[0]?.args[rec.calls[0].args.length - 1] ?? '';
        expect(sent).toContain('laneHost.sh erase');
        expect(sent).not.toContain("erase a b'c;d");
    });

    it('syncs the flows to the per-run folder with the run ssh config', async () => {
        const rec = recorder();
        const session = make(rec.shell);
        await session.open(run);
        await session.syncFlows();

        const rsync = rec.calls.find((c) => c.command === 'rsync')?.args.join(' ') ?? '';
        expect(rsync).toContain('-e ssh -F /s/ssh.conf');
        expect(rsync).toContain('me@mac:ksIos/run/r/mobile/.maestro/');
    });

    it('opens one reverse tunnel for the forwards it is given, and stops it on close', async () => {
        const rec = recorder();
        const session = make(rec.shell);
        await session.open(run);
        await session.openTunnel(FORWARDS);
        const tunnel = rec.tunnels[0]?.join(' ') ?? '';

        expect(tunnel).toContain('-R 3000:localhost:3000');
        expect(tunnel).toContain('-R 3001:localhost:3001');
        expect(tunnel).toContain('ExitOnForwardFailure=yes');
        await session.close();
        expect(rec.stopped()).toBe(1);
    });

    describe('the tunnel (S81)', () => {
        it('owns its ssh connection, so its forwards die with it and not with the shared master', async () => {
            const rec = recorder();
            const session = make(rec.shell);
            await session.open(run);
            await session.openTunnel(FORWARDS);
            const tunnel = rec.tunnels[0]?.join(' ') ?? '';

            expect(tunnel).toContain('-o ControlMaster=no');
            expect(tunnel).toContain('-o ControlPath=none');
        });

        it('asks every forwarded Mac port for /health before it returns', async () => {
            const rec = recorder();
            const session = make(rec.shell);
            await session.open(run);
            await session.openTunnel(FORWARDS);
            const asked = rec.calls.map((c) => [c.command, ...c.args].join(' ')).filter((l) => l.includes('/health'));

            expect(asked).toHaveLength(2);
            expect(asked[0]).toContain('127.0.0.1:3000/health');
            expect(asked[1]).toContain('127.0.0.1:3001/health');
        });

        it('retries a port that does not answer yet (000) and passes when it answers 200', async () => {
            const rec = recorder({}, { 3000: ['000', '000', '200'] });
            const session = make(rec.shell);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).resolves.toBeUndefined();
        });

        it('refuses, naming the port and the code, when a port never answers before the deadline', async () => {
            const rec = recorder({}, { 3001: ['000'] });
            const session = make(rec.shell);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/Mac port 3001 answered \/health with 000/u);
        });

        it('refuses at once on any other code, naming the port and the code', async () => {
            const rec = recorder({}, { 3000: ['401'] });
            const session = make(rec.shell);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/Mac port 3000 answered \/health with 401/u);
            expect(rec.calls.filter((c) => c.args.join(' ').includes('127.0.0.1:3000/health'))).toHaveLength(1);
        });

        it('probes the second port too: 200 on the first and 401 on the second names the second', async () => {
            const rec = recorder({}, { 3000: ['200'], 3001: ['401'] });
            const session = make(rec.shell);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/Mac port 3001 answered \/health with 401/u);
        });

        it('refuses at once on an empty or non-numeric reply, quoting it, and never retries it as 000', async () => {
            for (const reply of ['', 'bash: curl: command not found']) {
                const rec = recorder({}, { 3000: [reply] });
                const session = make(rec.shell);
                await session.open(run);

                await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/not an HTTP code/u);
                await expect(session.openTunnel(FORWARDS)).rejects.toThrow(
                    new RegExp(`answered ${JSON.stringify(reply)}`, 'u'),
                );
                expect(rec.calls.filter((c) => c.args.join(' ').includes('127.0.0.1:3000/health'))).toHaveLength(2);
            }
        });

        it('rejects with the ssh error when the probe call itself fails, and does not retry it', async () => {
            const rec = recorder({}, { 3000: ['REJECT'] });
            const session = make(rec.shell);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/Connection refused/u);
            expect(rec.calls.filter((c) => c.args.join(' ').includes('127.0.0.1:3000/health'))).toHaveLength(1);
        });

        it('gives up at 10 s of wall time even when each reply is slow, long before 20 attempts', async () => {
            const rec = recorder({}, { 3000: ['000'] });
            const session = make(rec.shell, undefined, [], 4_000);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/answered \/health with 000/u);
            expect(rec.calls.filter((c) => c.args.join(' ').includes('127.0.0.1:3000/health')).length).toBeLessThan(5);
        });

        it('shares one 10 s deadline across the ports, so a slow first port leaves one try', async () => {
            const rec = recorder({}, { 3000: ['200'], 3001: ['000'] });
            const session = make(rec.shell, undefined, [], 6_000);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/Mac port 3001 answered \/health with 000/u);
            expect(rec.calls.filter((c) => c.args.join(' ').includes('127.0.0.1:3001/health'))).toHaveLength(1);
        });

        it('gives up when 10 s of waiting have passed, not before and not long after', async () => {
            const sleeps: number[] = [];
            const rec = recorder({}, { 3000: ['000'] });
            const session = make(rec.shell, undefined, sleeps);
            await session.open(run);

            await expect(session.openTunnel(FORWARDS)).rejects.toThrow(/answered \/health with 000/u);
            expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(10_000);
            expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(10_500);
        });

        it('keeps a loss that happened before anyone asked: lost() asked late still resolves', async () => {
            const rec = recorder();
            const session = make(rec.shell);
            await session.open(run);
            await session.openTunnel(FORWARDS);
            rec.exitTunnel(255);
            await Promise.resolve();
            await Promise.resolve();

            await expect(session.lost()).resolves.toEqual(
                new Error('the tunnel ssh exited with code 255 during the run'),
            );
        });

        it('keeps a loss that happened before close(): lost() asked after close() still resolves with it', async () => {
            const rec = recorder();
            const session = make(rec.shell);
            await session.open(run);
            await session.openTunnel(FORWARDS);
            rec.exitTunnel(255);
            await Promise.resolve();
            await Promise.resolve();
            await session.close();

            await expect(session.lost()).resolves.toEqual(
                new Error('the tunnel ssh exited with code 255 during the run'),
            );
        });

        it('stops asking once the tunnel has exited: no probe command goes out after the refusal', async () => {
            const rec = recorder({}, { 3000: ['000'] });
            const session = make(rec.shell);
            await session.open(run);
            const opening = session.openTunnel(FORWARDS);
            rec.exitTunnel(255);
            await expect(opening).rejects.toThrow(/exited with code 255 before/u);
            const askedAtRefusal = rec.asked();
            await new Promise((resolve) => setTimeout(resolve, 0));

            // One ask may already have been on its way when the tunnel ended. None may follow it.
            expect(rec.asked() - askedAtRefusal).toBeLessThanOrEqual(1);
        });

        it('refuses with the exit code when the tunnel ssh exits before the probe passes', async () => {
            const rec = recorder({}, { 3000: ['000'] });
            const session = make(rec.shell);
            await session.open(run);
            const opening = session.openTunnel(FORWARDS);
            rec.exitTunnel(255);

            await expect(opening).rejects.toThrow(/tunnel ssh exited with code 255 before the run used it/u);
        });

        it('reports a loss, with the exit code, when the tunnel exits after it opened', async () => {
            const rec = recorder();
            const session = make(rec.shell);
            await session.open(run);
            await session.openTunnel(FORWARDS);
            const lost = session.lost();
            rec.exitTunnel(255);

            await expect(lost).resolves.toEqual(new Error('the tunnel ssh exited with code 255 during the run'));
        });

        it('does not report a loss for an exit that close() caused', async () => {
            const rec = recorder();
            const session = make(rec.shell);
            await session.open(run);
            await session.openTunnel(FORWARDS);
            let settled = false;
            void session.lost().then(() => {
                settled = true;
            });
            await session.close();
            rec.exitTunnel(143);
            await Promise.resolve();
            await Promise.resolve();

            expect(settled).toBe(false);
        });
    });

    it('links a shim by name into the run shim folder', async () => {
        const rec = recorder();
        const session = make(rec.shell);
        await session.open(run);
        await session.linkShim('adb', 'adbShim.sh');

        expect(rec.links).toEqual([['/repo/packages/tools/local-sandbox/bin/mac/adbShim.sh', '/s/shims/adb']]);
    });
});

describe('macPathsOf — the one builder of Mac paths', () => {
    it('builds every path under the Mac HOME when it knows it', () => {
        const paths = macPathsOf('/Users/x');

        expect(paths.laneHome(2)).toBe('/Users/x/ksIos/lanes/lane2');
        expect(paths.runTree('r1')).toBe('/Users/x/ksIos/run/r1');
        expect(paths.iosApp('abc')).toBe('/Users/x/ksIos/apps/abc');
        expect(paths.androidApp('abc')).toBe('/Users/x/ksIos/apps/android/abc');
        expect(paths.androidEnv).toBe('/Users/x/ksAndroid/env.sh');
        expect(paths.androidSdk).toBe('/Users/x/ksAndroid/sdk');
    });

    it('builds the same paths relative to HOME for a command that runs there', () => {
        const paths = macPathsOf();

        expect(paths.iosApp('abc')).toBe('ksIos/apps/abc');
        expect(paths.androidApp('abc')).toBe('ksIos/apps/android/abc');
        expect(paths.laneHome(1)).toBe('ksIos/lanes/lane1');
    });

    it('is the only place in the lane code that writes a Mac folder name', () => {
        const root = path.join(import.meta.dirname, '../../..');

        const writesFolder = (file: string): boolean => {
            const source = ts.createSourceFile(
                file,
                readFileSync(path.join(root, file), 'utf8'),
                ts.ScriptTarget.Latest,
            );
            let found = false;

            // Only string and template text counts: the words in a comment are not a path anyone builds.
            const visit = (node: ts.Node): void => {
                if (
                    (ts.isStringLiteralLike(node) ||
                        ts.isTemplateHead(node) ||
                        ts.isTemplateMiddle(node) ||
                        ts.isTemplateTail(node)) &&
                    /ksIos\/|ksAndroid\//u.test(node.text)
                ) {
                    found = true;
                }

                ts.forEachChild(node, visit);
            };

            visit(source);

            return found;
        };

        const offenders = globSync(['src/maestroLanes/*.ts', 'bin/*.ts'], { cwd: root }).filter(
            (file) => file !== 'src/maestroLanes/macSession.ts' && writesFolder(file),
        );

        expect(offenders).toEqual([]);
    });
});
