/**
 * The lane door's first bash step. The stack's facts and the ownership refusals come before the toolchain, the Clerk
 * keys, the seed settings and the service checks, so a run aimed at another checkout's stack refuses before any of them
 * (AE9).
 */
import { describe, expect, it } from 'vitest';

import { BASE_ENVIRONMENT_SCRIPT } from '../maestroLanes/baseEnvironmentScript.js';

describe('BASE_ENVIRONMENT_SCRIPT', () => {
    const at = (needle: string): number => BASE_ENVIRONMENT_SCRIPT.indexOf(needle);

    it('asks the stack for its facts, as the lane door, first', () => {
        expect(at('local_maestro_stack_env maestro:lanes')).toBeGreaterThan(-1);

        for (const later of [
            'local_maestro_toolchain',
            'local_maestro_load_clerk_keys',
            'local_maestro_pin_aws',
            'local_maestro_seed_env',
            'local_maestro_require_services',
        ]) {
            expect(at('local_maestro_stack_env')).toBeLessThan(at(later));
        }
    });

    it('stops at the first failure (every step is joined with &&), and names no port', () => {
        expect(BASE_ENVIRONMENT_SCRIPT).not.toMatch(/;\s*local_maestro/u);
        expect(BASE_ENVIRONMENT_SCRIPT).not.toMatch(/\b(3000|3001|3002|4566|5432)\b/u);
    });
});
