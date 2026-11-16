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

    describe('the daily limit (a fixed clock: the notice carries its `now`)', () => {
        /** 9:15 AM on Monday 26 October 2026 in New York (EDT). */
        const resetsAt = '2026-10-26T13:15:00.000Z';
        const quota = (now: string) => ({ kind: 'quota', resetsAt, now, timeZone: 'America/New_York' }) as const;

        it('reset later today: says matching starts again at the time alone', () => {
            const notice = quota('2026-10-26T05:00:00.000Z');
            render(<PasteMatchNotice notice={notice} />);

            expect(screen.getByText(pasteMatchNoticeOf(notice, m, 'en'))).toBeTruthy();
            expect(screen.getByText(/Matching starts again at 9:15\sAM\./)).toBeTruthy();
        });

        it('⛔ reset tomorrow: says "tomorrow at <time>", not the time alone', () => {
            render(<PasteMatchNotice notice={quota('2026-10-25T14:00:00.000Z')} />);

            expect(screen.getByText(/Matching starts again tomorrow at 9:15\sAM\./)).toBeTruthy();
        });

        it('⛔ reset more than a day off (a device clock that is behind): still says tomorrow and the time', () => {
            render(<PasteMatchNotice notice={quota('2026-10-22T14:00:00.000Z')} />);

            expect(screen.getByText(/Matching starts again tomorrow at 9:15\sAM\./)).toBeTruthy();
        });
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
