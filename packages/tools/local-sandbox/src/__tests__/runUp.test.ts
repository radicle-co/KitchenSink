/**
 * `runUp` is the ORDER of `local:up`: every refusal runs before the first write, and the lock is held from the
 * ownership read to the last state-changing call. The stages are injected, so a recording stub shows what ran, in what
 * order, and what did not run.
 */
import { describe, expect, it } from 'vitest';

import { HostLockHeldError } from '../maestroLanes/hostLock.js';
import { runUp, type UpPorts } from '../runUp.js';
import { DockerReadError, type ComposeContainer } from '../stackPorts.js';

const C = '/work/C';
const A = '/work/A';
const at = (project: string, dir: string): ComposeContainer => ({ project, workingDir: `${dir}/.local-sandbox` });

interface Harness {
    readonly ports: UpPorts;
    readonly calls: string[];
    readonly errors: string[];
}

function harness(over: Partial<UpPorts> & { readonly held?: Set<string> } = {}): Harness {
    const calls: string[] = [];
    const errors: string[] = [];
    const held = over.held ?? new Set<string>();
    const ports: UpPorts = {
        env: {},
        checkout: C,
        canon: (value) => value,
        stateDir: '/state/localSandbox',
        containers: () => [],
        volumeExists: () => false,
        listening: () => [],
        publishedBy: () => [],
        readRecord: () => undefined,
        writeRecord: (file, checkout) => {
            calls.push(`record ${file} ${checkout}`);
        },
        acquireLock: (file) => {
            if (held.has(file)) {
                throw new HostLockHeldError(file, 7, 'local:up');
            }

            held.add(file);
            calls.push(`lock ${file}`);

            return {
                release: () => {
                    held.delete(file);
                    calls.push(`unlock ${file}`);
                },
            };
        },
        discover: (stack) => {
            calls.push(`discover ${stack.project}`);

            return Promise.resolve([{ name: 'recipes', hostPort: stack.hostPort('recipes', 3000) }]);
        },
        materialize: () => {
            calls.push('materialize');

            return Promise.resolve(0);
        },
        err: (line) => {
            errors.push(line);
        },
        ...over,
    };

    return { ports, calls, errors };
}

describe('runUp refuses before it touches anything', () => {
    it('AE3: a refused value takes no lock, reads nothing and writes nothing', async () => {
        const { ports, calls, errors } = harness({ env: { LOCAL_SANDBOX_PORT: '3001' } });

        expect(await runUp(ports)).toBe(1);
        expect(calls).toEqual([]);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/^local:up refused: LOCAL_SANDBOX_PORT=3001 moves /u);
    });

    it('AE7: another checkout owns the default project, so nothing is discovered, recorded or started', async () => {
        const { ports, calls, errors } = harness({ containers: () => [at('local-sandbox', A)] });

        expect(await runUp(ports)).toBe(1);
        expect(errors).toEqual([
            'local:up refused: project local-sandbox runs from /work/A, not this checkout. ' +
                'Run local:down there, or pick another LOCAL_SANDBOX_PORT.',
        ]);
        expect(calls).toEqual([
            'lock /state/localSandbox/local-sandbox.lock',
            'unlock /state/localSandbox/local-sandbox.lock',
        ]);
    });

    it('AE7: the same holds for a shifted project that B owns', async () => {
        const { ports, calls } = harness({
            env: { LOCAL_SANDBOX_PORT: '3100' },
            containers: () => [at('local-sandbox-3100', A)],
        });

        expect(await runUp(ports)).toBe(1);
        expect(calls.some((call) => call === 'materialize' || call.startsWith('record'))).toBe(false);
    });

    it('H2: this checkout runs local-sandbox-3100 and the variable is unset, so it refuses', async () => {
        const { ports, calls, errors } = harness({ containers: () => [at('local-sandbox-3100', C)] });

        expect(await runUp(ports)).toBe(1);
        expect(errors[0]).toContain('already runs project local-sandbox-3100');
        expect(calls).not.toContain('materialize');
    });

    it('RT3: a volume that no record or container ties to this checkout is refused with no Compose call', async () => {
        const { ports, calls, errors } = harness({ volumeExists: () => true });

        expect(await runUp(ports)).toBe(1);
        expect(errors[0]).toContain('volume local-sandbox_local-sandbox-pgdata');
        expect(calls.some((call) => call.startsWith('discover') || call === 'materialize')).toBe(false);
    });

    it('C3: a busy port refuses before the record is written and before the builds and writes', async () => {
        const { ports, calls, errors } = harness({ listening: () => [3000] });

        expect(await runUp(ports)).toBe(1);
        expect(errors).toEqual([
            'local:up refused: host port(s) already in use: recipes :3000. ' +
                'Free them, or pick another LOCAL_SANDBOX_PORT.',
        ]);
        expect(calls).not.toContain('materialize');
        expect(calls.some((call) => call.startsWith('record'))).toBe(false);
    });

    it('the preflight counts this project own published ports as free, and no other project', async () => {
        const own = harness({
            listening: () => [3000],
            publishedBy: (project) => (project === 'local-sandbox' ? [3000] : []),
        });

        expect(await runUp(own.ports)).toBe(0);
    });

    it('a second run for the project refuses with the holder pid and starts nothing', async () => {
        const held = new Set(['/state/localSandbox/local-sandbox.lock']);
        const { ports, calls, errors } = harness({ held });

        expect(await runUp(ports)).toBe(1);
        expect(errors).toEqual([
            'local:up refused: project local-sandbox is being started or stopped by pid 7. Wait for it to finish.',
        ]);
        expect(calls).toEqual([]);
    });
});

describe('runUp runs the stages in order, under the lock', () => {
    it('lock, discover, record, materialize, unlock', async () => {
        const { ports, calls } = harness({ env: { LOCAL_SANDBOX_PORT: '3100' } });

        expect(await runUp(ports)).toBe(0);
        expect(calls).toEqual([
            'lock /state/localSandbox/local-sandbox-3100.lock',
            'discover local-sandbox-3100',
            `record /state/localSandbox/local-sandbox-3100.owner ${C}`,
            'materialize',
            'unlock /state/localSandbox/local-sandbox-3100.lock',
        ]);
    });

    it('RT1: a second run started while the first builds is refused, and the first starts once', async () => {
        const held = new Set<string>();
        const second: { code?: number; errors?: string[]; calls?: string[] } = {};
        const first = harness({
            held,
            materialize: async () => {
                const other = harness({ held });

                second.code = await runUp(other.ports);
                second.errors = other.errors;
                second.calls = other.calls;

                return 0;
            },
        });

        expect(await runUp(first.ports)).toBe(0);
        expect(second.code).toBe(1);
        expect(second.errors?.[0]).toContain('by pid 7');
        expect(second.calls).toEqual([]);
    });

    it('releases the lock when a stage throws', async () => {
        const { ports, calls } = harness({
            materialize: () => Promise.reject(new Error('boom')),
        });

        await expect(runUp(ports)).rejects.toThrow('boom');
        expect(calls.at(-1)).toBe('unlock /state/localSandbox/local-sandbox.lock');
    });

    it('returns the exit code of materialize, and writes the record only when it got that far', async () => {
        const { ports } = harness({ materialize: () => Promise.resolve(3) });

        expect(await runUp(ports)).toBe(3);
    });

    it('stops when discover found a problem it already printed', async () => {
        const { ports, calls } = harness({ discover: () => Promise.resolve(undefined) });

        expect(await runUp(ports)).toBe(1);
        expect(calls).not.toContain('materialize');
    });
});

describe('runUp treats a failed Docker read as a refusal, never as "nothing there"', () => {
    const reads = {
        containers: 'docker ps -a',
        volumeExists: 'docker volume ls',
        listening: 'ss -lnt',
        publishedBy: 'docker ps',
    } as const;

    for (const [name, command] of Object.entries(reads)) {
        it(`${name} failing prints one R9 line, writes no record, starts nothing and frees the lock`, async () => {
            const failing = {
                [name]: () => {
                    throw new DockerReadError(command, 'Cannot connect to the Docker daemon');
                },
            };
            const { ports, calls, errors } = harness(failing);

            expect(await runUp(ports)).toBe(1);
            expect(errors).toEqual([
                `local:up refused: ${command} failed (Cannot connect to the Docker daemon). ` +
                    'Start Docker, or fix it, then run local:up again.',
            ]);
            expect(calls.filter((call) => call.startsWith('record') || call === 'materialize')).toEqual([]);
            expect(calls.at(-1)).toBe('unlock /state/localSandbox/local-sandbox.lock');
        });
    }

    it('a failure that is not a Docker read is not swallowed', async () => {
        const { ports } = harness({
            containers: () => {
                throw new Error('boom');
            },
        });

        await expect(runUp(ports)).rejects.toThrow('boom');
    });
});
