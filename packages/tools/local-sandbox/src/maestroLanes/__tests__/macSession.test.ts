import { describe, expect, it } from 'vitest';

import { MacSession, type MacShell } from '../macSession.js';

interface Call {
    readonly command: string;
    readonly args: readonly string[];
}

function recorder(answers: Record<string, string> = {}) {
    const calls: Call[] = [];
    const files = new Map<string, string>();
    const links: [string, string][] = [];
    const tunnels: string[][] = [];
    let stopped = 0;
    const shell: MacShell = {
        run: (command, args) => {
            calls.push({ command, args });
            const line = [command, ...args].join(' ');
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

    return { shell, calls, files, links, tunnels, stopped: () => stopped };
}

const make = (shell: MacShell, env: Record<string, string | undefined> = { LOCAL_MAESTRO_IOS_HOST: 'me@mac' }) =>
    new MacSession({ shell, env, repoRoot: '/repo' });

const run = { runId: 'r', stateDir: '/s', repoRoot: '/repo' };

describe('MacSession', () => {
    it('refuses to be built without a Mac host', () => {
        expect(() => make(recorder().shell, {})).toThrow(/LOCAL_MAESTRO_IOS_HOST/);
    });

    it('reads host facts over a plain one-off ssh, after putting the lane script on the Mac', async () => {
        const rec = recorder({ 'laneHost.sh facts': 'ncpu 14\nmemsize 100\nloadavg { 1 1 1 }\nSystem-wide memory free percentage: 50%\n' });
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
        session.openTunnel([
            { macPort: 3000, localPort: 3000 },
            { macPort: 3001, localPort: 3001 },
        ]);
        const tunnel = rec.tunnels[0]?.join(' ') ?? '';

        expect(tunnel).toContain('-R 3000:localhost:3000');
        expect(tunnel).toContain('-R 3001:localhost:3001');
        expect(tunnel).toContain('ExitOnForwardFailure=yes');
        await session.close();
        expect(rec.stopped()).toBe(1);
    });

    it('links a shim by name into the run shim folder', async () => {
        const rec = recorder();
        const session = make(rec.shell);
        await session.open(run);
        await session.linkShim('adb', 'adbShim.sh');

        expect(rec.links).toEqual([['/repo/packages/tools/local-sandbox/bin/mac/adbShim.sh', '/s/shims/adb']]);
    });
});
