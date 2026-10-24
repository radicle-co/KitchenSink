/**
 * The library's list/grid view: the cook's choice (an account setting, ADR-0059, read by the host) wins; with no choice
 * the container's width picks (`docs/design/uiOverhaul/buildSpec.md` §4.3). Rewritten 2026-10-17: the cookie, the shared
 * device-store key and the stored-value parser went with the device stores; the setting is parsed by the wire schema.
 */
import { describe, expect, it } from 'vitest';

import { viewModeOf } from '../viewModePreference.js';

describe('the view-mode preference', () => {
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
