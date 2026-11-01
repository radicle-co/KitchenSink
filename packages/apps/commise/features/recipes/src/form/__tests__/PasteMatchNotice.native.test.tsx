/**
 * Component tests for the native `PasteMatchNotice`: offline (the check waits; choices are kept where the draft is) and
 * the daily limit (004 FR-022; matching starts again at the reset time, in the cook's locale)
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, RecipeEditorPasteChooseStates).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';

const platform = vi.hoisted(() => ({ os: 'web' as string }));

// The iOS announce path: `Platform.OS` is switched per test, and the announcement is read off the spy.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
        AccessibilityInfo: { ...actual.AccessibilityInfo, announceForAccessibilityWithOptions: vi.fn() },
    };
});

import { recipeFormMessages } from '../messages.js';
import { pasteMatchNoticeOf } from '../pasteMatchView.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PasteMatchNotice } from '../PasteMatchNotice.native.js';
import { render } from '@commise/ui/testing/tamagui';

const m = recipeFormMessages.en;

afterEach(() => {
    cleanup();
    platform.os = 'web';
    vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear();
});

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
    it('is a polite live region holding its sentence', () => {
        render(<PasteMatchNotice notice={{ kind: 'offline', keep: 'disk' }} />);

        const sentence = screen.getByText(/saved on this device/);

        expect(sentence.getAttribute('aria-live')).toBe('polite');
    });

    // iOS honours no live region: the house `LiveRegion` announces, so the notice speaks there too (U9).
    it('⛔ on iOS, announces its sentence politely', () => {
        platform.os = 'ios';
        render(<PasteMatchNotice notice={{ kind: 'offline', keep: 'disk' }} />);

        expect(vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls).toEqual([
            [pasteMatchNoticeOf({ kind: 'offline', keep: 'disk' }, m, 'en'), { queue: true }],
        ]);
    });
});
