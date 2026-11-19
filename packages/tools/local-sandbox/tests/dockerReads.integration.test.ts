/**
 * The Docker and `ss` reads that `local:up`, `local:down` and the stack door make. A stub `docker` and `ss` on PATH
 * answer each read, so the test crosses the real spawn and the real parse. The point it proves: a failed read throws
 * `DockerReadError` and is never an empty answer.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    dockerContainers,
    dockerPublishedBy,
    dockerPublishedPort,
    dockerVolumeExists,
    listeningPorts,
} from '../bin/adapters.js';
import { isDockerReadError } from '../src/stackPorts.js';

let dir = '';
let savedPath: string | undefined;

/** Installs a stub program that prints `stdout` and `stderr` and exits with `status`, whatever its arguments. */
function stub(name: string, stdout: string, status: number, stderr = ''): void {
    const file = path.join(dir, name);

    writeFileSync(
        file,
        `#!/bin/sh\necho "$@" >> "${dir}/${name}.args"\nprintf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${String(status)}\n`,
    );
    chmodSync(file, 0o755);
}

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dockerReads-'));
    savedPath = process.env['PATH'];
    process.env['PATH'] = `${dir}:${savedPath ?? ''}`;
});

afterEach(() => {
    process.env['PATH'] = savedPath;
    rmSync(dir, { recursive: true, force: true });
});

describe('a failed read is an error, never an empty answer', () => {
    it('docker ps -a failing throws a DockerReadError that carries what Docker said', () => {
        stub('docker', '', 1, 'Cannot connect to the Docker daemon');

        expect(() => dockerContainers()).toThrow('docker ps -a failed (Cannot connect to the Docker daemon)');

        try {
            dockerContainers();
        } catch (error) {
            expect(isDockerReadError(error)).toBe(true);
        }
    });

    it('a missing docker program is the same error, not an empty list', () => {
        process.env['PATH'] = dir;

        expect(() => dockerContainers()).toThrow(/docker ps -a failed/u);
    });

    it('docker volume ls failing throws, so a failed read is not "no volume"', () => {
        stub('docker', '', 1, 'daemon down');

        expect(() => dockerVolumeExists('local-sandbox_local-sandbox-pgdata')).toThrow('docker volume ls failed');
    });

    it('docker port failing throws', () => {
        stub('docker', '', 1, 'No such container: x');

        expect(() => dockerPublishedPort('x', 5432)).toThrow('docker port failed (No such container: x)');
    });

    it('docker ps for the published ports and ss failing throw', () => {
        stub('docker', '', 1, 'daemon down');
        stub('ss', '', 1, 'ss broke');

        expect(() => dockerPublishedBy('p')).toThrow('docker ps failed');
        expect(() => listeningPorts()).toThrow('ss -lnt failed (ss broke)');
    });
});

describe('a successful read is parsed', () => {
    it('lists every compose container, stopped ones included', () => {
        stub('docker', 'local-sandbox\t/work/A/.local-sandbox\nlocal-sandbox-3100\t/work/B/.local-sandbox\n', 0);

        expect(dockerContainers()).toEqual([
            { project: 'local-sandbox', workingDir: '/work/A/.local-sandbox' },
            { project: 'local-sandbox-3100', workingDir: '/work/B/.local-sandbox' },
        ]);
    });

    it('tells an absent volume from a failed read', () => {
        stub('docker', '', 0);

        expect(dockerVolumeExists('local-sandbox_local-sandbox-pgdata')).toBe(false);

        stub('docker', 'local-sandbox_local-sandbox-pgdata\n', 0);

        expect(dockerVolumeExists('local-sandbox_local-sandbox-pgdata')).toBe(true);
    });

    it('asks docker port for the container port and returns the host port', () => {
        stub('docker', '0.0.0.0:5532\n[::]:5532\n', 0);

        expect(dockerPublishedPort('local-sandbox-3100-postgres', 5432)).toBe(5532);
    });

    it('reads the host ports a project publishes, and the ports something listens on', () => {
        stub('docker', '0.0.0.0:3100->3000/tcp, [::]:3100->3000/tcp\n0.0.0.0:3101->3001/tcp\n', 0);
        stub('ss', 'LISTEN 0 4096 0.0.0.0:3200 0.0.0.0:*\nLISTEN 0 128 [::]:22 [::]:*\n', 0);

        expect(dockerPublishedBy('p')).toEqual([3100, 3100, 3101]);
        expect(listeningPorts()).toEqual([3200, 22]);
    });
});
