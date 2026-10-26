/**
 * Component tests for the native `PasteMatchNotice`: offline (the check waits; choices are kept where the draft is) and
 * the daily limit (004 FR-022; matching starts again at the reset time, in the cook's locale)
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, RecipeEditorPasteChooseStates).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { recipeFormMessages } from '../messages.js';
import { pasteMatchNoticeOf } from '../pasteMatchView.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PasteMatchNotice } from '../PasteMatchNotice.native.js';

const m = recipeFormMessages.en;

afterEach(cleanup);

describe('PasteMatchNotice (native)', () => {
    it('offline on a device: says choices are saved on this device', () => {
        render(<PasteMatchNotice notice={{ kind: 'offline', keep: 'disk' }} />);

        expect(screen.getByText(pasteMatchNoticeOf({ kind: 'offline', keep: 'disk' }, m, 'en'))).toBeTruthy();
        expect(screen.getByText(/saved on this device/)).toBeTruthy();
    });

    it('offline in a browser tab: says choices are kept in this tab', () => {
        render(<PasteMatchNotice notice={{ kind: 'offline', keep: 'tabSession' }} />);

        expect(screen.getByText(/kept in this tab/)).toBeTruthy();
        expect(screen.queryByText(/on this device/)).toBeNull();
    });

    it('the daily limit: says when matching starts again', () => {
        const notice = { kind: 'quota', resetsAt: '2026-10-26T04:00:00.000Z', timeZone: 'America/New_York' } as const;
        render(<PasteMatchNotice notice={notice} />);

        expect(screen.getByText(pasteMatchNoticeOf(notice, m, 'en'))).toBeTruthy();
        expect(screen.getByText(/Matching starts again at 12:00 AM/)).toBeTruthy();
    });

    // U9 (staff-ux, WCAG 4.1.3): the notice is a polite status, so a change to it is spoken; it was not live.
    it('is a polite status region holding its sentence', () => {
        render(<PasteMatchNotice notice={{ kind: 'offline', keep: 'disk' }} />);

        const region = screen.getByRole('status');

        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(region.textContent).toContain('saved on this device');
    });
});
