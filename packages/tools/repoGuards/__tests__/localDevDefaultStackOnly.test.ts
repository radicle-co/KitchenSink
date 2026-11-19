// @vitest-environment node
/**
 * Repo-wide guard: `local:dev` and `dev:local` run the default-stack check BEFORE anything that starts or uses a stack.
 *
 * Their host dev servers read each service's `.env.development`, which names the default stack's ports. Started against
 * a stack that `LOCAL_SANDBOX_PORT` moved, they would write into another session's data. The check refuses that, but only
 * if it runs first: after `local:up` the second stack is already up, and after `turbo run dev` the servers already run.
 *
 * The rule is a pure analyzer over a script string, run over the real `package.json` and over fixtures that break it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const GUARDED = ['local:dev', 'dev:local'] as const;
const CHECK = 'defaultStackOnly';

/** The reason a script does not run the check first with its own door name, or `undefined` when it does. */
function orderProblem(name: string, script: string | undefined): string | undefined {
    if (script === undefined) {
        return `${name} is missing`;
    }

    const steps = script.split('&&').map((step) => step.trim());
    const first = steps[0] ?? '';

    if (!first.includes(CHECK)) {
        return `${name} does not run ${CHECK} first`;
    }

    if (!first.endsWith(` ${name}`)) {
        return `${name} runs ${CHECK} without naming its own door`;
    }

    return steps.slice(1).some((step) => step.includes(CHECK)) ? `${name} runs ${CHECK} twice` : undefined;
}

describe('local:dev and dev:local check the stack before they start anything', () => {
    const scripts = (
        JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
            scripts: Record<string, string | undefined>;
        }
    ).scripts;

    for (const name of GUARDED) {
        it(`${name} runs ${CHECK} as its first step, naming itself, ahead of local:up and turbo run dev`, () => {
            expect(orderProblem(name, scripts[name])).toBeUndefined();
        });
    }

    it('the real scripts still start what the check protects, so the guard cannot pass on an emptied script', () => {
        expect(scripts['local:dev']).toContain('npm run local:up && turbo run dev');
        expect(scripts['dev:local']).toContain('&& turbo run dev');
    });

    it('catches a check that runs after local:up', () => {
        expect(orderProblem('local:dev', `npm run local:up && npm run ${CHECK} -- local:dev && turbo run dev`)).toBe(
            'local:dev does not run defaultStackOnly first',
        );
    });

    it('catches a check that names the wrong door, and a script with no check', () => {
        expect(orderProblem('dev:local', `npm run ${CHECK} -- local:dev && turbo run dev`)).toBe(
            'dev:local runs defaultStackOnly without naming its own door',
        );
        expect(orderProblem('dev:local', 'turbo run dev')).toBe('dev:local does not run defaultStackOnly first');
    });
});
