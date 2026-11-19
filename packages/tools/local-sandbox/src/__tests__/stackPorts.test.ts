/**
 * `stackPorts` — the one home of the local stack's port, project and image rules. Every expectation about the default
 * stack is a LITERAL (`3000`, `local-sandbox-postgres`, `:local`), never a constant imported from the module, so a
 * change of the default cannot pass by changing both sides.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    checkoutProject,
    composeContainersFrom,
    isInvalidStackPortError,
    DockerReadError,
    dockerReadRefusal,
    isDockerReadError,
    labelRefusal,
    volumeRefusal,
    publishedHostPort,
    onPublishedPorts,
    refusalLine,
    stackFrom,
    stackLine,
    targetOwners,
    volumeOwnerVerdict,
    type ComposeContainer,
} from '../stackPorts.js';

/** Calls `stackFrom` and returns the R9 line of the refusal it throws, or fails the test if it does not throw. */
function refusalOf(value: string): string {
    try {
        stackFrom({ LOCAL_SANDBOX_PORT: value });
    } catch (error) {
        if (isInvalidStackPortError(error)) {
            return refusalLine('local:up', error.refused, error.why, error.fix);
        }

        throw error;
    }

    throw new Error(`LOCAL_SANDBOX_PORT=${value} was accepted`);
}

describe('the default stack (AE1): unset, empty and 3000 are exactly today', () => {
    it.each([[{}], [{ LOCAL_SANDBOX_PORT: '' }], [{ LOCAL_SANDBOX_PORT: '3000' }]])('%j', (env) => {
        const stack = stackFrom(env);

        expect(stack.project).toBe('local-sandbox');
        expect(stack.containerName('postgres')).toBe('local-sandbox-postgres');
        expect(stack.imageTag('kitchensink-recipe-service')).toBe('local-sandbox/kitchensink-recipe-service:local');
        expect(stack.isDefault).toBe(true);
        expect(stack.hostPort('recipes', 3000)).toBe(3000);
        expect(stack.hostPort('identity', 3001)).toBe(3001);
        expect(stack.hostPort('food', 3002)).toBe(3002);
        expect(stack.hostPort('localstack', 4566)).toBe(4566);
        expect(stack.hostPort('postgres', 5432)).toBe(5432);
    });
});

describe('a shifted stack (AE2)', () => {
    const stack = stackFrom({ LOCAL_SANDBOX_PORT: '3100' });

    it('moves every default host port by the same offset', () => {
        expect(stack.hostPort('recipes', 3000)).toBe(3100);
        expect(stack.hostPort('identity', 3001)).toBe(3101);
        expect(stack.hostPort('food', 3002)).toBe(3102);
        expect(stack.hostPort('localstack', 4566)).toBe(4666);
        expect(stack.hostPort('postgres', 5432)).toBe(5532);
    });

    it('moves a service that is not one of the five by the same offset, from its own default', () => {
        expect(stack.hostPort('newservice', 3005)).toBe(3105);
    });

    it('names the project, the containers and the image tag after the value', () => {
        expect(stack.project).toBe('local-sandbox-3100');
        expect(stack.containerName('recipes')).toBe('local-sandbox-3100-recipes');
        expect(stack.imageTag('kitchensink-recipe-service')).toBe(
            'local-sandbox/kitchensink-recipe-service:local-3100',
        );
        expect(stack.isDefault).toBe(false);
    });
});

describe('the value is refused unless it is a whole port (AE3)', () => {
    it.each([['abc'], ['3100.5'], ['-1'], [' 3100'], ['03100'], ['3100 '], ['0x1f40']])(
        '%j is not all digits without a leading zero or a space',
        (value) => {
            expect(refusalOf(value)).toContain('is not a whole number');
        },
    );

    it('names every clash of one value in one line (3001: recipes on identity, identity on food)', () => {
        expect(refusalOf('3001')).toBe(
            "local:up refused: LOCAL_SANDBOX_PORT=3001 moves recipes to 3001, which the default stack's identity " +
                "uses, and identity to 3002, which the default stack's food uses. Pick another value (3100 works).",
        );
    });

    it.each([
        ['2999', "identity to 3000, which the default stack's recipes uses"],
        ['4566', "recipes to 4566, which the default stack's localstack uses"],
        ['5649', 'postgres to 8081, which Metro uses'],
        ['6515', 'localstack to 8081, which Metro uses'],
        ['3122', 'postgres to 5554, which the Android emulators use'],
        ['3153', 'postgres to 5585, which the Android emulators use'],
        ['1023', 'recipes to 1023, a port below 1024'],
        ['63104', 'postgres to 65536, a port above 65535'],
        ['0', 'recipes to 0, a port below 1024'],
    ])('%s is refused: %s', (value, fragment) => {
        const line = refusalOf(value);

        expect(line).toContain(fragment);
        expect(line.startsWith(`local:up refused: LOCAL_SANDBOX_PORT=${value} moves `)).toBe(true);
        expect(line.endsWith('Pick another value (3100 works).')).toBe(true);
        expect(line).not.toContain('\n');
    });

    it('refuses a port that lands on adb', () => {
        // recipes on 5037 (k = 2037) is not in the plan's list, so name it: adb's server port.
        expect(refusalOf('5037')).toContain('which adb uses');
    });

    it.each([['3121'], ['3154'], ['1024'], ['63103'], ['3100']])('%s is accepted', (value) => {
        expect(() => stackFrom({ LOCAL_SANDBOX_PORT: value })).not.toThrow();
    });
});

describe('an explicit host port beats the shift, and the shift beats the default (AE4)', () => {
    const stack = stackFrom({ LOCAL_SANDBOX_PORT: '3100', LOCAL_SANDBOX_HOST_PORTS: 'recipes=3010' });

    it('uses the entry for its service and the shift for the others', () => {
        expect(stack.hostPort('recipes', 3000)).toBe(3010);
        expect(stack.hostPort('identity', 3001)).toBe(3101);
    });

    it('is not checked against the reserved set', () => {
        expect(stackFrom({ LOCAL_SANDBOX_HOST_PORTS: 'recipes=3001' }).hostPort('recipes', 3000)).toBe(3001);
    });
});

describe('onPublishedPorts moves a host-side address, and only that', () => {
    const published = { 4566: 4666, 5432: 5532 };

    it('moves localhost and 127.0.0.1', () => {
        expect(onPublishedPorts('http://localhost:4566/000000000000/q', published)).toBe(
            'http://localhost:4666/000000000000/q',
        );
        expect(onPublishedPorts('postgres://u:p@127.0.0.1:5432/db', published)).toBe(
            'postgres://u:p@127.0.0.1:5532/db',
        );
    });

    it('leaves an in-network address alone', () => {
        expect(onPublishedPorts('http://localstack:4566', published)).toBe('http://localstack:4566');
        expect(onPublishedPorts('postgres://u:p@postgres:5432/db', published)).toBe('postgres://u:p@postgres:5432/db');
    });

    it('leaves a port that was not published alone', () => {
        expect(onPublishedPorts('http://localhost:9999', published)).toBe('http://localhost:9999');
    });
});

describe('the two ownership predicates read the compose working-dir label', () => {
    const roots: string[] = [];
    const canon = (value: string): string => realpathSync(value);

    afterEach(() => {
        for (const root of roots.splice(0)) {
            rmSync(root, { recursive: true, force: true });
        }
    });

    /** A real checkout folder (with its generated folder) in a temp dir. */
    function checkout(name: string): string {
        const root = mkdtempSync(path.join(tmpdir(), 'stackports-'));
        roots.push(root);
        const dir = path.join(root, name);
        mkdirSync(path.join(dir, '.local-sandbox'), { recursive: true });

        return dir;
    }

    const container = (project: string, dir: string): ComposeContainer => ({
        project,
        workingDir: `${dir}/.local-sandbox`,
    });

    it('targetOwners names the checkouts that run the project, and none for another project or no container', () => {
        const a = checkout('A');

        expect(targetOwners([container('local-sandbox', a)], 'local-sandbox', canon)).toEqual([canon(a)]);
        expect(targetOwners([container('local-sandbox-3100', a)], 'local-sandbox', canon)).toEqual([]);
        expect(targetOwners([], 'local-sandbox', canon)).toEqual([]);
    });

    it('checkoutProject names a project this checkout runs other than the target, and nothing otherwise', () => {
        const a = checkout('A');
        const b = checkout('B');

        expect(checkoutProject([container('local-sandbox-3100', a)], a, 'local-sandbox', canon)).toBe(
            'local-sandbox-3100',
        );
        expect(checkoutProject([container('local-sandbox', a)], a, 'local-sandbox', canon)).toBeUndefined();
        expect(checkoutProject([container('local-sandbox-3100', b)], a, 'local-sandbox', canon)).toBeUndefined();
        expect(checkoutProject([], a, 'local-sandbox', canon)).toBeUndefined();
    });

    it('finds a second project in one checkout even when the first one is the target', () => {
        const a = checkout('A');
        const both = [container('local-sandbox', a), container('local-sandbox-3100', a)];

        expect(checkoutProject(both, a, 'local-sandbox', canon)).toBe('local-sandbox-3100');
    });

    it('a label that holds a symlinked path to this checkout is the same checkout, in both predicates', () => {
        const a = checkout('A');
        const link = path.join(path.dirname(a), 'link');
        symlinkSync(a, link);

        expect(targetOwners([container('local-sandbox', link)], 'local-sandbox', canon)).toEqual([canon(a)]);
        expect(checkoutProject([container('local-sandbox-3100', link)], a, 'local-sandbox', canon)).toBe(
            'local-sandbox-3100',
        );
    });
});

describe('volumeOwnerVerdict (RT3)', () => {
    const identity = (value: string): string => value;
    const here = '/work/C';
    const other = '/work/A';
    const label = (dir: string): ComposeContainer => ({
        project: 'local-sandbox',
        workingDir: `${dir}/.local-sandbox`,
    });

    it('passes when the project has no volume', () => {
        expect(
            volumeOwnerVerdict({
                volumeExists: false,
                record: undefined,
                containers: [],
                checkout: here,
                canon: identity,
            }),
        ).toEqual({
            ok: true,
        });
    });

    it('refuses when the record names another checkout, and names it', () => {
        expect(
            volumeOwnerVerdict({ volumeExists: true, record: other, containers: [], checkout: here, canon: identity }),
        ).toEqual({
            ok: false,
            owner: other,
        });
    });

    it('refuses when there is no record and no container, with no owner to name', () => {
        expect(
            volumeOwnerVerdict({
                volumeExists: true,
                record: undefined,
                containers: [],
                checkout: here,
                canon: identity,
            }),
        ).toEqual({
            ok: false,
            owner: undefined,
        });
    });

    it('passes when the record names this checkout', () => {
        expect(
            volumeOwnerVerdict({ volumeExists: true, record: here, containers: [], checkout: here, canon: identity }),
        ).toEqual({
            ok: true,
        });
    });

    it('passes on a live label for this checkout, even when the record names another checkout', () => {
        expect(
            volumeOwnerVerdict({
                volumeExists: true,
                record: other,
                containers: [label(here)],
                checkout: here,
                canon: identity,
            }),
        ).toEqual({ ok: true });
    });

    it('refuses on a live label for another checkout, even when the record names this checkout', () => {
        expect(
            volumeOwnerVerdict({
                volumeExists: true,
                record: here,
                containers: [label(other)],
                checkout: here,
                canon: identity,
            }),
        ).toEqual({ ok: false, owner: other });
    });
});

describe('the refusal line and the status line', () => {
    it('refusalLine has the door, what it refused, why and the fix, in that order, on one line', () => {
        expect(
            refusalLine(
                'local:down',
                'project local-sandbox',
                'runs from /path/A, not this checkout',
                'Run local:down there.',
            ),
        ).toBe('local:down refused: project local-sandbox runs from /path/A, not this checkout. Run local:down there.');
    });

    it('stackLine prints the project, the three published ports and the checkout (AE10)', () => {
        expect(stackLine('local-sandbox-3100', { recipes: 3100, identity: 3101, food: 3102 }, '/work/B')).toBe(
            'stack: local-sandbox-3100 (recipes 3100, identity 3101, food 3102) from /work/B',
        );
    });

    it('stackLine shows an explicit recipes port (AE4)', () => {
        expect(stackLine('local-sandbox-3100', { recipes: 3010, identity: 3101, food: 3102 }, '/work/B')).toBe(
            'stack: local-sandbox-3100 (recipes 3010, identity 3101, food 3102) from /work/B',
        );
    });
});

describe('publishedHostPort reads `docker port` output', () => {
    it('takes the host port of the first mapping', () => {
        expect(publishedHostPort('0.0.0.0:5532\n[::]:5532\n')).toBe(5532);
        expect(publishedHostPort('127.0.0.1:4666\n')).toBe(4666);
    });

    it('answers undefined for empty or unrecognised output', () => {
        expect(publishedHostPort('')).toBeUndefined();
        expect(publishedHostPort('Error: no public port')).toBeUndefined();
    });
});

describe('labelRefusal: one R9 line when another checkout, or another project of this one, holds the stack', () => {
    const canon = (value: string): string => value;
    const A = '/work/A';
    const B = '/work/B';
    const C = '/work/C';
    const at = (project: string, dir: string): ComposeContainer => ({ project, workingDir: `${dir}/.local-sandbox` });
    const base = {
        door: 'local:up',
        project: 'local-sandbox',
        checkout: C,
        canon,
        fixes: {
            foreign: 'Run local:down there, or pick another LOCAL_SANDBOX_PORT.',
            sibling: 'Run local:down for that project first.',
        },
    };

    it('passes when nothing is running', () => {
        expect(labelRefusal({ ...base, containers: [] })).toBeUndefined();
    });

    it('passes when this checkout runs the project', () => {
        expect(labelRefusal({ ...base, containers: [at('local-sandbox', C)] })).toBeUndefined();
    });

    it('AE7: refuses when another checkout runs the target project, and names it, with the fix the caller gave', () => {
        expect(labelRefusal({ ...base, containers: [at('local-sandbox', A)] })).toBe(
            'local:up refused: project local-sandbox runs from /work/A, not this checkout. ' +
                'Run local:down there, or pick another LOCAL_SANDBOX_PORT.',
        );
    });

    it('a project whose containers come from two checkouts refuses from every checkout, in either list order', () => {
        const line =
            'local:up refused: project local-sandbox runs from more than one checkout: /work/A, /work/B. ' +
            'Run `docker compose -p local-sandbox down` by hand once the owners agree.';

        for (const checkout of [A, B, C]) {
            for (const containers of [
                [at('local-sandbox', A), at('local-sandbox', B)],
                [at('local-sandbox', B), at('local-sandbox', A)],
            ]) {
                expect(labelRefusal({ ...base, checkout, containers })).toBe(line);
            }
        }
    });

    it('many containers of one checkout are one owner and pass for it', () => {
        const containers = [at('local-sandbox', C), at('local-sandbox', C), at('local-sandbox', C)];

        expect(labelRefusal({ ...base, containers })).toBeUndefined();
        expect(labelRefusal({ ...base, checkout: A, containers })).toContain('runs from /work/C, not this checkout');
    });

    it('RT2: a stopped container counts, because the caller passes every container (ps -a)', () => {
        expect(labelRefusal({ ...base, containers: [at('local-sandbox', A)] })).toContain('runs from /work/A');
    });

    it('H2: refuses when this checkout already runs another project, though the target has no container', () => {
        expect(labelRefusal({ ...base, containers: [at('local-sandbox-3100', C)] })).toBe(
            'local:up refused: this checkout already runs project local-sandbox-3100, and its generated folder holds ' +
                'one stack. Run local:down for that project first.',
        );
    });

    it('takes the door and the fixes from the caller, so local:down speaks for itself', () => {
        expect(
            labelRefusal({
                ...base,
                door: 'local:down',
                fixes: {
                    foreign: 'Run local:down there.',
                    sibling: 'Set LOCAL_SANDBOX_PORT to the port that project uses.',
                },
                containers: [at('local-sandbox-3100', C)],
            }),
        ).toBe(
            'local:down refused: this checkout already runs project local-sandbox-3100, and its generated folder ' +
                'holds one stack. Set LOCAL_SANDBOX_PORT to the port that project uses.',
        );
    });
});

describe('volumeRefusal (RT3): the data volume must belong to this checkout', () => {
    const canon = (value: string): string => value;
    const A = '/work/A';
    const C = '/work/C';
    const at = (project: string, dir: string): ComposeContainer => ({ project, workingDir: `${dir}/.local-sandbox` });
    const base = {
        door: 'local:up',
        project: 'local-sandbox',
        checkout: C,
        canon,
        volumeExists: true,
        record: undefined,
        recordFile: '/state/localSandbox/local-sandbox.owner',
        containers: [] as readonly ComposeContainer[],
    };

    it('passes when the project has no volume', () => {
        expect(volumeRefusal({ ...base, volumeExists: false })).toBeUndefined();
    });

    it('refuses a volume whose record names another checkout, and names both', () => {
        expect(volumeRefusal({ ...base, record: A })).toBe(
            'local:up refused: volume local-sandbox_local-sandbox-pgdata holds Postgres data owned by /work/A, not ' +
                'this checkout. Start the project there, or remove the volume.',
        );
    });

    it('refuses a volume with no record and no container, and says how to claim it', () => {
        expect(volumeRefusal(base)).toBe(
            'local:up refused: volume local-sandbox_local-sandbox-pgdata holds Postgres data and nothing names its ' +
                "owner. If it is this checkout's, write this checkout's path into " +
                '/state/localSandbox/local-sandbox.owner, or remove the volume.',
        );
    });

    it('passes a volume this checkout owns by record, and one a live label of this checkout names', () => {
        expect(volumeRefusal({ ...base, record: C })).toBeUndefined();
        expect(volumeRefusal({ ...base, containers: [at('local-sandbox', C)], record: A })).toBeUndefined();
    });

    it("another project's container at this checkout does not stand in for this project's volume", () => {
        const refusal = volumeRefusal({ ...base, containers: [at('local-sandbox-3100', C)], record: A });

        expect(refusal).toContain('owned by /work/A');
    });

    it('a mixed project is no volume owner, whichever container is listed first', () => {
        for (const containers of [
            [at('local-sandbox', C), at('local-sandbox', A)],
            [at('local-sandbox', A), at('local-sandbox', C)],
        ]) {
            expect(volumeRefusal({ ...base, containers, record: C })).toContain('owned by /work/A, /work/C');
        }
    });

    it('a live label of another checkout beats a record naming this one', () => {
        expect(volumeRefusal({ ...base, containers: [at('local-sandbox', A)], record: C })).toContain(
            'owned by /work/A',
        );
    });
});

describe('a Docker read that fails is a refusal, never an empty answer', () => {
    it('dockerReadRefusal is one R9 line naming the read and the detail', () => {
        const error = new DockerReadError('docker ps -a', 'Cannot connect to the Docker daemon');

        expect(isDockerReadError(error)).toBe(true);
        expect(dockerReadRefusal('local:up', error)).toBe(
            'local:up refused: docker ps -a failed (Cannot connect to the Docker daemon). ' +
                'Start Docker, or fix it, then run local:up again.',
        );
    });

    it('is not any other error', () => {
        expect(isDockerReadError(new Error('x'))).toBe(false);
    });
});

describe('composeContainersFrom reads `docker ps -a` label output', () => {
    it('gives one entry per container with its project and working dir', () => {
        expect(
            composeContainersFrom(
                'local-sandbox\t/work/A/.local-sandbox\nlocal-sandbox-3100\t/work/B/.local-sandbox\n',
            ),
        ).toEqual([
            { project: 'local-sandbox', workingDir: '/work/A/.local-sandbox' },
            { project: 'local-sandbox-3100', workingDir: '/work/B/.local-sandbox' },
        ]);
    });

    it('skips blank lines and containers with no project label', () => {
        expect(composeContainersFrom('\n\t\nlocal-sandbox\t/work/A/.local-sandbox\n')).toEqual([
            { project: 'local-sandbox', workingDir: '/work/A/.local-sandbox' },
        ]);
    });

    it('skips a container with no working dir, because it names no checkout', () => {
        expect(composeContainersFrom('local-sandbox\t\n')).toEqual([]);
    });
});

describe('a malformed LOCAL_SANDBOX_HOST_PORTS is a refusal, not a stack trace', () => {
    it.each([['recipes=abc'], ['recipes=80'], ['recipes=3010,recipes=3011'], ['nonsense']])('refuses %s', (value) => {
        let caught: unknown;

        try {
            stackFrom({ LOCAL_SANDBOX_HOST_PORTS: value });
        } catch (error) {
            caught = error;
        }

        expect(isInvalidStackPortError(caught)).toBe(true);
        expect(caught).toMatchObject({
            refused: `LOCAL_SANDBOX_HOST_PORTS=${value}`,
            why: 'is not a list of unique name=port entries with a port from 1024 to 65535',
            fix: 'Pass entries like recipes=3010, or unset the variable.',
        });
    });
});
