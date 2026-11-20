import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { spawnRunner, type LaneChild } from '../laneProcess.js';

const dirs: string[] = [];
const children: LaneChild[] = [];

afterEach(() => {
    // A failed assertion must not leave a `sleep 30` behind.
    for (const child of children.splice(0)) {
        child.stop('SIGKILL');
    }

    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function runnerWith(body: string): { readonly script: string; readonly dir: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'laneProcess-'));
    dirs.push(dir);
    const script = path.join(dir, 'runner.sh');
    writeFileSync(script, body);

    return { script, dir };
}

describe('spawnRunner', () => {
    it('reports the group as running while a child stays after the runner exits, until SIGKILL ends it', async () => {
        const { script, dir } = runnerWith('sleep 30 &\nexit 0\n');
        const child = spawnRunner({
            script,
            cwd: dir,
            env: { PATH: process.env['PATH'] ?? '' },
            log: path.join(dir, 'log'),
        });
        children.push(child);

        await expect(child.exit).resolves.toBe(0);
        expect(child.running()).toBe(true);

        child.stop('SIGKILL');

        for (let tries = 0; tries < 100 && child.running(); tries += 1) {
            await delay(20);
        }

        expect(child.running()).toBe(false);
    });

    it('reports no group for a runner that could not start', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'laneProcess-'));
        dirs.push(dir);
        const child = spawnRunner({
            script: '/no/such/script.sh',
            cwd: '/no/such/dir',
            env: {},
            log: path.join(dir, 'log'),
        });
        children.push(child);

        await expect(child.exit).resolves.toBe(1);
        expect(child.running()).toBe(false);
    });
});
