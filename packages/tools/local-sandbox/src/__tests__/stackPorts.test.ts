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
    isInvalidStackPortError,
    onPublishedPorts,
    refusalLine,
    stackFrom,
    stackLine,
    targetOwner,
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

    it('targetOwner names the checkout that runs the project, and nothing for another project or none', () => {
        const a = checkout('A');

        expect(targetOwner([container('local-sandbox', a)], 'local-sandbox', canon)).toBe(canon(a));
        expect(targetOwner([container('local-sandbox-3100', a)], 'local-sandbox', canon)).toBeUndefined();
        expect(targetOwner([], 'local-sandbox', canon)).toBeUndefined();
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

        expect(targetOwner([container('local-sandbox', link)], 'local-sandbox', canon)).toBe(canon(a));
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
