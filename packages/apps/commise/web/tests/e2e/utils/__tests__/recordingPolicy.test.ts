// @vitest-environment node
/**
 * Traces, videos and screenshots cost CPU and disk on every test that records them, and a green test never needs one.
 * The suite records them only for a test that failed or was retried. Playwright's own defaults already leave video and
 * screenshots off, but a default is not a policy: this pins the three values, the config that applies them, and the
 * absence of a spec that turns one back on.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RECORDING } from '../recordingPolicy';

const WEB_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

describe('RECORDING', () => {
    it('records a trace and a video only on the retry of a failed test', () => {
        expect(RECORDING.trace).toBe('on-first-retry');
        expect(RECORDING.video).toBe('on-first-retry');
    });

    it('takes a screenshot only of a test that failed', () => {
        expect(RECORDING.screenshot).toBe('only-on-failure');
    });
});

describe('where the policy applies', () => {
    it('is spread into the config’s `use`, so every project records the same way', () => {
        const config = readFileSync(`${WEB_ROOT}playwright.config.ts`, 'utf8');

        expect(config).toMatch(/use:\s*\{[^}]*\.\.\.RECORDING/u);
    });

    it('is not undone by a spec that turns recording back on', () => {
        const offenders = globSync('tests/e2e/**/*.spec.ts', { cwd: WEB_ROOT }).filter((file) =>
            /\b(video|trace|screenshot)\s*:/u.test(readFileSync(`${WEB_ROOT}${file}`, 'utf8')),
        );

        expect(offenders).toEqual([]);
    });
});
