/**
 * The native Data sources page (design §S16): a full-screen sheet, because the app has no router and a sheet returns
 * the cook to the same place. Its title and both intro sentences show whatever state the read is in, and Close is its
 * one visible way out, through the same callback Android back reaches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ComponentProps } from 'react';
import { AccessibilityInfo, Text, type Modal as ModalType } from 'react-native';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesPage } from '../DataSourcesPage.native.js';
import { dataSourcesMessages } from '../messages.js';

const state = vi.hoisted(() => ({ modal: undefined as ComponentProps<typeof ModalType> | undefined }));

// The real Modal, with its props recorded. `onShow` is held back, so a test fires it itself: a cursor that moved
// without it came from somewhere else.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme({
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onShow: undefined });
        },
    });
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

describe('DataSourcesPage (native)', () => {
    it('moves the reading cursor to the title once the sheet is shown, and not before (§S16 Focus)', () => {
        render(
            <DataSourcesPage onRequestClose={vi.fn()} headingFocusSignal={0}>
                {null}
            </DataSourcesPage>,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
        act(() => state.modal?.onShow?.({} as never));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Data sources' }),
            'focus',
        );
    });

    // A retry that took Try again away advances the signal: the cursor goes to the title, not lost with the control.
    it('moves the reading cursor to the title when the heading signal advances, and not on mount', () => {
        const { rerender } = render(
            <DataSourcesPage onRequestClose={vi.fn()} headingFocusSignal={0}>
                {null}
            </DataSourcesPage>,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
        rerender(
            <DataSourcesPage onRequestClose={vi.fn()} headingFocusSignal={1}>
                {null}
            </DataSourcesPage>,
        );

        expect(vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls).toEqual([
            [screen.getByRole('heading', { name: 'Data sources' }), 'focus'],
        ]);
    });

    it('titles the sheet as a header', () => {
        render(
            <DataSourcesPage onRequestClose={vi.fn()} headingFocusSignal={0}>
                {null}
            </DataSourcesPage>,
        );

        expect(screen.getByRole('heading', { name: 'Data sources' })).toBeTruthy();
    });

    it('states where the numbers come from, and the rule for a food no database lists exactly', () => {
        render(
            <DataSourcesPage onRequestClose={vi.fn()} headingFocusSignal={0}>
                {null}
            </DataSourcesPage>,
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

    it('closes through the one exit when Close is pressed', async () => {
        const onRequestClose = vi.fn();
        render(
            <DataSourcesPage onRequestClose={onRequestClose} headingFocusSignal={0}>
                {null}
            </DataSourcesPage>,
        );

        await userEvent.click(screen.getByRole('button', { name: 'Close data sources' }));

        expect(onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('renders the read’s state below the intro', () => {
        render(
            <DataSourcesPage onRequestClose={vi.fn()} headingFocusSignal={0}>
                <Text>the read’s state</Text>
            </DataSourcesPage>,
        );

        const intro = screen.getByText('The nutrition figures in this app come from these public food databases.');
        const state = screen.getByText('the read’s state');

        expect(intro.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe.each(['light', 'dark'] as const)('DataSourcesPage (native) — the %s scheme', (scheme) => {
    it('titles and introduces the page in ink, and the close-match note in inkMuted (D15)', () => {
        systemScheme.current = scheme;
        const colours = scheme === 'dark' ? roleDark : role;
        render(
            <DataSourcesPage onRequestClose={() => undefined} headingFocusSignal={0}>
                {null}
            </DataSourcesPage>,
        );
        const m = dataSourcesMessages.en;

        expect(getComputedStyle(screen.getByRole('heading', { name: m.title })).color).toBe(rgb(colours.ink));
        expect(getComputedStyle(screen.getByText(m.intro)).color).toBe(rgb(colours.ink));
        expect(getComputedStyle(screen.getByText(m.closeMatchNote)).color).toBe(rgb(colours.inkMuted));
    });
});
