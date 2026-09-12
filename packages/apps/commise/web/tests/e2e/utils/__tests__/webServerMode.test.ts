// @vitest-environment node
/**
 * Guard for WHICH server the Playwright suite drives — `next dev` or the production `next start`.
 *
 * ## The failure this pins
 *
 * The suite used to run `npm run dev` everywhere, so CI compiled routes ON DEMAND, inside the tests. The
 * cost landed as latency in the assertions themselves: on commit 6e40d66a a spec that only clicks a link
 * and reads a heading took 18.3s, and all three attempts of `recipeSourceTabs.spec.ts` failed with
 * `expect(page).toHaveURL(/\/discover/)` still seeing `/en/recipes` — the href, the locale and the link
 * were all correct, the navigation simply had not committed inside the 5s budget. That failure mode is
 * indistinguishable from a real product bug in the report, and it was routinely rescued by a retry, which
 * is what let it live.
 *
 * Reverting this selection is therefore a SILENT regression: the suite still passes, just slowly and
 * flakily again. Nothing else in the tree would notice, so this file is the thing that notices.
 *
 * Every case below fails if the resolution logic is broken in the obvious ways — an inverted CI check, an
 * override that does not override, a blank value treated as a choice, or a typo accepted as a mode.
 */
import { describe, expect, it } from 'vitest';

import {
    isInvalidWebServerModeError,
    resolveWebServerMode,
    webServerCommand,
    type WebServerMode,
} from '../webServerMode';

describe('resolveWebServerMode', () => {
    it('drives the dev server on a developer machine, where no build has been made', () => {
        expect(resolveWebServerMode({})).toBe('dev');
    });

    it('drives the production build under CI, where a build artifact is always present', () => {
        expect(resolveWebServerMode({ CI: 'true' })).toBe('start');
    });

    it('treats a blank CI value as absent rather than as a signal', () => {
        // GitHub sets `CI=true`; an empty string is what an unset-but-declared variable looks like, and
        // reading it as truthy would silently demand a production build on a developer machine.
        expect(resolveWebServerMode({ CI: '' })).toBe('dev');
    });

    it('lets an explicit override win over CI, so a CI job can still drive the dev server', () => {
        expect(resolveWebServerMode({ CI: 'true', E2E_WEB_SERVER: 'dev' })).toBe('dev');
    });

    it('lets an explicit override win off CI, so the production path is reproducible locally', () => {
        expect(resolveWebServerMode({ E2E_WEB_SERVER: 'start' })).toBe('start');
    });

    it('treats a blank override as absent rather than as an invalid mode', () => {
        expect(resolveWebServerMode({ CI: 'true', E2E_WEB_SERVER: '' })).toBe('start');
    });

    it('rejects an unrecognised mode instead of silently falling back to the dev server', () => {
        // The near-miss that matters: someone writes the COMMAND where the MODE goes. Falling back would
        // hand them the dev server and the flake it causes, under a config that looks deliberate.
        expect(() => resolveWebServerMode({ E2E_WEB_SERVER: 'next start' })).toThrow(/E2E_WEB_SERVER/);
    });

    it('names both accepted modes in the rejection, so the message is the fix', () => {
        try {
            resolveWebServerMode({ E2E_WEB_SERVER: 'production' });
            expect.unreachable('an unrecognised mode must throw');
        } catch (error) {
            expect(isInvalidWebServerModeError(error)).toBe(true);
            expect((error as Error).message).toContain("'dev'");
            expect((error as Error).message).toContain("'start'");
            expect((error as Error).message).toContain('production');
        }
    });
});

describe('isInvalidWebServerModeError', () => {
    it('does not claim an ordinary Error', () => {
        expect(isInvalidWebServerModeError(new Error('E2E_WEB_SERVER'))).toBe(false);
    });

    it('does not claim a non-error value', () => {
        expect(isInvalidWebServerModeError('E2E_WEB_SERVER')).toBe(false);
        expect(isInvalidWebServerModeError(undefined)).toBe(false);
    });
});

describe('webServerCommand', () => {
    it('runs the app through its OWN package scripts, not a bare binary', () => {
        // `npm run …` is what keeps the local invocation and the CI invocation the same command, and what
        // routes the production run through `next start` rather than a second, drifting spelling of it.
        expect(webServerCommand('dev')).toBe('npm run dev');
        expect(webServerCommand('start')).toBe('npm run start');
    });

    it('maps every mode, so a new mode cannot be added without a command', () => {
        const modes: readonly WebServerMode[] = ['dev', 'start'];

        for (const mode of modes) {
            expect(webServerCommand(mode)).toMatch(/^npm run \S+$/);
        }
    });
});
