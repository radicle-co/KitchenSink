/**
 * The library's list/grid choice, kept per device (`docs/design/uiOverhaul/buildSpec.md` §4.3, blueprint Part C): one
 * key for both platforms, a stored value parsed rather than trusted, and the web cookie the server reads so the first
 * render matches.
 */
import { describe, expect, it } from 'vitest';

import { VIEW_MODE_KEY, viewModeCookieFor, viewModeFrom, viewModeOf } from '../viewModePreference.js';

describe('the view-mode preference', () => {
    it('is stored under one key on both platforms', () => {
        expect(VIEW_MODE_KEY).toBe('recipes.viewMode');
    });

    it.each([
        ['list', 'list'],
        ['grid', 'grid'],
        [undefined, undefined],
        ['', undefined],
        ['tiles', undefined],
        [null, undefined],
    ] as const)('reads %j as %j', (stored, mode) => {
        expect(viewModeFrom(stored)).toBe(mode);
    });

    it('writes a year-long, site-wide, lax cookie', () => {
        expect(viewModeCookieFor('grid')).toBe('recipes.viewMode=grid; path=/; max-age=31536000; samesite=lax');
    });

    it.each([
        ['grid', 'narrow', 'grid'],
        ['list', 'wide', 'list'],
        [undefined, 'narrow', 'list'],
        [undefined, 'regular', 'grid'],
    ] as const)(
        'a stored %j at %s shows %s (the cook’s choice wins; else the width’s default)',
        (stored, container, mode) => {
            expect(viewModeOf(stored, container)).toBe(mode);
        },
    );
});
