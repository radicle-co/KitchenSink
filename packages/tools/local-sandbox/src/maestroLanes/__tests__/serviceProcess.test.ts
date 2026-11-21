import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startService } from '../serviceProcess.js';
import { processGroup } from '../stopGroups.js';

const dirs: string[] = [];
const pids: number[] = [];

afterEach(() => {
    for (const pid of pids.splice(0)) {
        processGroup(pid).stop('SIGKILL');
    }

    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** A service whose leader (sh) exits on SIGTERM at once while its child traps SIGTERM and needs time to finish. */
function serviceWith(
    childBody: string,
    announce = true,
): { readonly dir: string; readonly spawn: () => { pid: number }; log: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'serviceProcess-'));
    dirs.push(dir);
    const child = path.join(dir, 'child.sh');
    const leader = path.join(dir, 'leader.sh');
    writeFileSync(child, childBody);
    writeFileSync(leader, `/bin/sh ${child} &\n${announce ? 'echo draining\n' : ''}wait\n`);
    const log = path.join(dir, 'service.log');

    return {
        dir,
        log,
        spawn: () => {
            const fd = openSync(log, 'w');
            const started = spawn('/bin/sh', [leader], { stdio: ['ignore', fd, fd], detached: true });
            closeSync(fd);
            started.unref();
            const pid = started.pid ?? -1;
            pids.push(pid);

            return { pid };
        },
    };
}

const spec = { name: 'consumer', pattern: /x/u, command: 'x', args: [] };

describe('startService stop', () => {
    it('gives the whole group its grace after the leader exits, so a child that needs time to finish is not killed', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'serviceProcessMark-'));
        dirs.push(dir);
        const finished = path.join(dir, 'finished');
        // The child traps SIGTERM, takes 300 ms to finish its work, writes the marker and exits.
        const service = serviceWith(
            `trap 'sleep 0.3; echo done > ${finished}; exit 0' TERM\nwhile :; do sleep 0.05; done\n`,
        );
        const running = await startService(spec, { ...service, pollMs: 20 });
        // The leader exits when the group gets SIGTERM, but its child must be allowed to finish.

        await running.stop();

        expect(existsSync(finished)).toBe(true);
    });

    it('kills a child that ignores SIGTERM and returns only once the group is gone', async () => {
        const service = serviceWith(`trap '' TERM\nwhile :; do sleep 0.05; done\n`);
        const running = await startService(spec, { ...service, pollMs: 20, stop: { graceMs: 200, killWaitMs: 2_000 } });

        await running.stop();

        expect(processGroup(running.pid).running()).toBe(false);
    });

    it('stops a service that ignores SIGTERM and never gets ready before it rejects', async () => {
        const service = serviceWith(`trap '' TERM\nwhile :; do sleep 0.05; done\n`, false);
        const started = startService(spec, { ...service, pollMs: 1, stop: { graceMs: 100, killWaitMs: 2_000 } });

        await expect(started).rejects.toThrow(/was not ready in 60 s/u);

        // The service's group id is the last pid spawned; the child must be gone, not left behind by a SIGTERM-only stop.
        expect(pids.every((pid) => !processGroup(pid).running())).toBe(true);
    });
});
