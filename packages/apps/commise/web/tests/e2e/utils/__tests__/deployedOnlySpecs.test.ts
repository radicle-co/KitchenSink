// @vitest-environment node
/**
 * The specs that skip without a target, and the registry that says so.
 *
 * A spec that reads a deployed service, or a live local backend, skips when there is none (owner rulings 2026-09-05 and
 * 2026-10-03). The local door must tell those declared skips from any other skip: the first are OWED and printed every
 * run, the second refuse the green stamp. The declaration is only worth trusting if it cannot go stale, so this derives
 * the set from the files on disk: a spec that names a target switch is listed, and a listed spec names one.
 */
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEPLOYED_ONLY_SPECS } from '../deployedOnlySpecs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SWITCH = /deployedTargetOrigin\(|E2E_LIVE_BACKEND/u;

const specsNamingASwitch = (): readonly string[] =>
    globSync('tests/e2e/*.spec.ts', { cwd: ROOT })
        .filter((file) => SWITCH.test(readFileSync(`${ROOT}${file}`, 'utf8')))
        .map((file) => file.slice('tests/e2e/'.length))
        .sort();

describe('DEPLOYED_ONLY_SPECS', () => {
    it('lists exactly the specs whose source names a target switch', () => {
        expect([...DEPLOYED_ONLY_SPECS].sort()).toEqual(specsNamingASwitch());
    });

    it('lists only specs that can skip', () => {
        for (const spec of DEPLOYED_ONLY_SPECS) {
            expect(readFileSync(`${ROOT}tests/e2e/${spec}`, 'utf8'), spec).toMatch(/test\.skip\(/u);
        }
    });
});
