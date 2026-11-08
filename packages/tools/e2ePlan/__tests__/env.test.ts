import { describe, expect, it } from 'vitest';

import { processEnv } from '../src/env.js';

describe('processEnv', () => {
    it('hands a child process the same variables, as a copy', () => {
        const env = { PATH: '/bin', GONE: undefined };
        const copy = processEnv(env);

        expect(copy).toEqual(env);
        expect(copy).not.toBe(env);
    });

    it('is a copy a caller cannot use to change the original', () => {
        const env: Record<string, string | undefined> = { A: '1' };

        processEnv(env)['A'] = '2';

        expect(env['A']).toBe('1');
    });
});
