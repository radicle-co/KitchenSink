/**
 * `runDown` stops the stack the variable names, and only when this checkout runs it. It never reads `compose.yml`, so a
 * stale or foreign file cannot steer it, and it takes the same project lock as `local:up`.
 */
import { describe, expect, it } from 'vitest';

import { HostLockHeldError } from '../maestroLanes/hostLock.js';
import { runDown, type DownPorts } from '../runDown.js';
import { DockerReadError } from '../dockerReadError.js';
import type { ComposeContainer } from '../stackPorts.js';

const C = '/work/C';
const A = '/work/A';
const at = (project: string, dir: string): ComposeContainer => ({ project, workingDir: `${dir}/.local-sandbox` });

function harness(over: Partial<DownPorts> & { readonly held?: Set<string> } = {}) {
    const calls: string[] = [];
    const errors: string[] = [];
    const lines: string[] = [];
    const held = over.held ?? new Set<string>();
    const ports: DownPorts = {
        env: {},
        checkout: C,
        canon: (value) => value,
        stateDir: '/state/localSandbox',
        containers: () => [],
        acquireLock: (file) => {
            if (held.has(file)) {
                throw new HostLockHeldError(file, 7, 'local:down');
            }

            held.add(file);
            calls.push('lock');

            return {
                release: () => {
                    held.delete(file);
                    calls.push('unlock');
                },
            };
        },
        down: (project) => {
            calls.push(`down -p ${project}`);

            return 0;
        },
        out: (line) => {
            lines.push(line);
        },
        err: (line) => {
            errors.push(line);
        },
        ...over,
    };

    return { ports, calls, errors, lines };
}

describe('runDown', () => {
    it("downs this checkout's own default project with -p, under the lock", () => {
        const { ports, calls } = harness({ containers: () => [at('local-sandbox', C)] });

        expect(runDown(ports)).toBe(0);
        expect(calls).toEqual(['lock', 'down -p local-sandbox', 'unlock']);
    });

    it('downs the shifted project the variable names', () => {
        const { ports, calls } = harness({
            env: { LOCAL_SANDBOX_PORT: '3100' },
            containers: () => [at('local-sandbox-3100', C)],
        });

        expect(runDown(ports)).toBe(0);
        expect(calls).toContain('down -p local-sandbox-3100');
    });

    it('AE6: unset in C while A runs local-sandbox refuses, naming A, and runs no down', () => {
        const { ports, calls, errors } = harness({ containers: () => [at('local-sandbox', A)] });

        expect(runDown(ports)).toBe(1);
        expect(errors).toEqual([
            'local:down refused: project local-sandbox runs from /work/A, not this checkout. Run local:down there.',
        ]);
        expect(calls.some((call) => call.startsWith('down'))).toBe(false);
    });

    it('a forgotten variable in B, which runs 3100, refuses and runs no down', () => {
        const { ports, calls, errors } = harness({ containers: () => [at('local-sandbox-3100', C)] });

        expect(runDown(ports)).toBe(1);
        expect(errors[0]).toContain('already runs project local-sandbox-3100');
        expect(calls.some((call) => call.startsWith('down'))).toBe(false);
    });

    it('with no container in the project it stops nothing and says so', () => {
        const { ports, calls, lines } = harness();

        expect(runDown(ports)).toBe(0);
        expect(lines).toEqual(['local:down: project local-sandbox has no containers, so nothing was stopped.']);
        expect(calls.some((call) => call.startsWith('down'))).toBe(false);
    });

    it('a held lock refuses with the holder pid and no down call', () => {
        const { ports, calls, errors } = harness({ held: new Set(['/state/localSandbox/local-sandbox.lock']) });

        expect(runDown(ports)).toBe(1);
        expect(errors).toEqual([
            'local:down refused: project local-sandbox is being started or stopped by pid 7. Wait for it to finish.',
        ]);
        expect(calls).toEqual([]);
    });

    it('a refused value takes no lock', () => {
        const { ports, calls, errors } = harness({ env: { LOCAL_SANDBOX_PORT: '4566' } });

        expect(runDown(ports)).toBe(1);
        expect(errors[0]).toMatch(/^local:down refused: LOCAL_SANDBOX_PORT=4566 /u);
        expect(calls).toEqual([]);
    });

    it('returns the exit code of the down call and still releases the lock', () => {
        const { ports, calls } = harness({
            containers: () => [at('local-sandbox', C)],
            down: () => 5,
        });

        expect(runDown(ports)).toBe(5);
        expect(calls.at(-1)).toBe('unlock');
    });
});

describe('runDown treats a failed Docker read as a refusal', () => {
    it('prints one R9 line, runs no down and frees the lock', () => {
        const { ports, calls, errors } = harness({
            containers: () => {
                throw new DockerReadError('docker ps -a', 'Cannot connect to the Docker daemon');
            },
        });

        expect(runDown(ports)).toBe(1);
        expect(errors).toEqual([
            'local:down refused: docker ps -a failed (Cannot connect to the Docker daemon). ' +
                'Start Docker, or fix it, then run local:down again.',
        ]);
        expect(calls).toEqual(['lock', 'unlock']);
    });
});
