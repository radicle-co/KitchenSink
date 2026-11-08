/** The plan bin's command line: a value it cannot honour is refused, not ignored. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const BIN = resolve(import.meta.dirname, '../bin/plan.ts');

const run = (...args: string[]) =>
    spawnSync('npx', ['tsx', BIN, ...args], { encoding: 'utf8', env: { ...process.env, CI: '' } });

describe('bin/plan.ts --platform', () => {
    it('refuses a platform nobody runs, with exit code 2 and a message that names the choices', () => {
        const result = run('--platform', 'tv');

        expect(result.status).toBe(2);
        expect(result.stderr).toMatch(/web, android, ios/u);
        expect(result.stdout).toBe('');
    });

    it('refuses an empty platform too', () => {
        expect(run('--platform', '').status).toBe(2);
    });
});
