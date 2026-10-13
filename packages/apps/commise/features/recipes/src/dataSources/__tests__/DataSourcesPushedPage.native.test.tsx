/**
 * The native Data sources PAGE as the Profile stack pushes it (A-026; `buildSpec.md` §9.2): "back to Profile, H1 Data
 * sources". It replaces, on Profile, the full-screen sheet with its Close ×; the sheet itself stays for the recipe
 * detail, which has no stack to push onto (`DataSourcesPage.native.test.tsx` still covers it). The title and both intro
 * sentences show whatever state the read is in, and Back to Profile is the one visible way out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccessibilityInfo, Text } from 'react-native';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesPushedPage } from '../DataSourcesPushedPage.native.js';
import { dataSourcesMessages } from '../messages.js';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme({
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    });
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const BACK = { label: 'Back to Profile', parent: 'Profile', onPress: () => undefined };

describe('DataSourcesPushedPage (native)', () => {
    it('titles the page as the H1', () => {
        render(
            <DataSourcesPushedPage back={BACK} headingFocusSignal={0}>
                {null}
            </DataSourcesPushedPage>,
        );

        expect(screen.getByRole('heading', { name: 'Data sources', level: 1 })).toBeTruthy();
    });

    it('goes back to Profile through its one visible way out, and offers no Close', () => {
        const onPress = vi.fn();
        render(
            <DataSourcesPushedPage back={{ ...BACK, onPress }} headingFocusSignal={0}>
                {null}
            </DataSourcesPushedPage>,
        );

        expect(screen.queryByRole('button', { name: dataSourcesMessages.en.close })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Profile' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('states where the numbers come from, and the rule for a food no database lists exactly', () => {
        render(
            <DataSourcesPushedPage back={BACK} headingFocusSignal={0}>
                {null}
            </DataSourcesPushedPage>,
        );

        expect(
            screen.getByText('The nutrition figures in this app come from these public food databases.'),
        ).toBeTruthy();
        expect(
            screen.getByText(
                'When no database lists a food exactly, we use the figures for a similar or more general food.',
            ),
        ).toBeTruthy();
    });

    it('renders the read’s state below the intro', () => {
        render(
            <DataSourcesPushedPage back={BACK} headingFocusSignal={0}>
                <Text>the read’s state</Text>
            </DataSourcesPushedPage>,
        );

        const intro = screen.getByText('The nutrition figures in this app come from these public food databases.');
        const state = screen.getByText('the read’s state');

        expect(intro.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // The navigator moves focus into a pushed screen itself, so the page does not (the sheet did, on `Modal.onShow`).
    // A retry that took Try again away advances the signal: the cursor goes to the title, not lost with the control.
    it('moves the reading cursor to the title when the heading signal advances, and not on mount', () => {
        const { rerender } = render(
            <DataSourcesPushedPage back={BACK} headingFocusSignal={0}>
                {null}
            </DataSourcesPushedPage>,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
        rerender(
            <DataSourcesPushedPage back={BACK} headingFocusSignal={1}>
                {null}
            </DataSourcesPushedPage>,
        );

        expect(vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls).toEqual([
            [screen.getByRole('heading', { name: 'Data sources' }), 'focus'],
        ]);
    });
});

describe.each(['light', 'dark'] as const)('DataSourcesPushedPage (native) — the %s scheme', (scheme) => {
    it('titles and introduces the page in ink, and the close-match note in inkMuted (D15)', () => {
        systemScheme.current = scheme;
        const colours = scheme === 'dark' ? roleDark : role;
        render(
            <DataSourcesPushedPage back={BACK} headingFocusSignal={0}>
                {null}
            </DataSourcesPushedPage>,
        );
        const m = dataSourcesMessages.en;

        expect(getComputedStyle(screen.getByRole('heading', { name: m.title })).color).toBe(rgb(colours.ink));
        expect(getComputedStyle(screen.getByText(m.intro)).color).toBe(rgb(colours.ink));
        expect(getComputedStyle(screen.getByText(m.closeMatchNote)).color).toBe(rgb(colours.inkMuted));
    });
});
