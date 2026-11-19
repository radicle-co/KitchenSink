/**
 * `local:dev` and `dev:local` start host processes that read each service's `.env.development`, which names the DEFAULT
 * stack's ports. Against another stack they would write into the other session's data, so those two doors refuse it.
 */
import { describe, expect, it } from 'vitest';

import { defaultStackOnlyRefusal } from '../defaultStackOnly.js';

describe('defaultStackOnlyRefusal', () => {
    it('AE8: a shifted stack is refused with the whole R9 line', () => {
        expect(defaultStackOnlyRefusal('local:dev', { LOCAL_SANDBOX_PORT: '3100' })).toBe(
            'local:dev refused: LOCAL_SANDBOX_PORT=3100 moves the stack, and the host dev servers read ' +
                ".env.development, which names the default stack's ports. " +
                'Unset LOCAL_SANDBOX_PORT and LOCAL_SANDBOX_HOST_PORTS, then run local:dev again.',
        );
    });

    it('names its own door, so dev:local speaks for itself', () => {
        expect(defaultStackOnlyRefusal('dev:local', { LOCAL_SANDBOX_PORT: '3100' })).toMatch(/^dev:local refused: /u);
    });

    it('unset, empty and 3000 pass', () => {
        expect(defaultStackOnlyRefusal('local:dev', {})).toBeUndefined();
        expect(defaultStackOnlyRefusal('local:dev', { LOCAL_SANDBOX_PORT: '' })).toBeUndefined();
        expect(defaultStackOnlyRefusal('local:dev', { LOCAL_SANDBOX_PORT: '3000' })).toBeUndefined();
    });

    it('a host port moved on the default stack is refused too, because the dev servers still read the old port', () => {
        expect(defaultStackOnlyRefusal('local:dev', { LOCAL_SANDBOX_HOST_PORTS: 'recipes=3010' })).toBe(
            'local:dev refused: LOCAL_SANDBOX_HOST_PORTS=recipes=3010 moves the stack, and the host dev servers read ' +
                ".env.development, which names the default stack's ports. " +
                'Unset LOCAL_SANDBOX_PORT and LOCAL_SANDBOX_HOST_PORTS, then run local:dev again.',
        );
    });

    it('a port value the stack refuses is refused by the door as the stack states it', () => {
        expect(defaultStackOnlyRefusal('local:dev', { LOCAL_SANDBOX_PORT: '3001' })).toMatch(
            /^local:dev refused: LOCAL_SANDBOX_PORT=3001 /u,
        );
    });
});
