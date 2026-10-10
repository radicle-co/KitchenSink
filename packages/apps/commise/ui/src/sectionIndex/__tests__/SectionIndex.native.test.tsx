/**
 * The native `SectionIndex` (build spec §7.2, §7.10, §7.12): the same data model, its presentation chosen by the
 * window's container class — a rail at `wide`, a strip at `regular`, a bar that opens the native sheet at `narrow`.
 *
 * ⚠️ React Native has no `aria-describedby`; a row's reason reaches a screen reader as its `accessibilityHint` (the
 * house precedent, `IngredientCheckRow.native.tsx`). react-native-web drops that prop from the DOM, so `Pressable` is
 * wrapped to record it. `useContainerClass` is replaced so a test chooses the width, and `useColorScheme` so it chooses
 * the theme. The jump goes through the screen's `ScrollHost`, injected through its context with a spy.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { formatRgb } from 'culori';
import { createElement, createRef, type ComponentProps } from 'react';
import type { Pressable as PressableType } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContainerClass } from '../../layout/containerClass.js';
import type { ScrollHostApi, ScrollTarget } from '../../scrollHost/props.js';
import { ScrollHostContext } from '../../scrollHost/scrollHostContext.js';
import { role, roleDark } from '../../tokens/colors.js';
import type { SectionIndexItem, SectionIndexProps } from '../props.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native` leaf.
import { SectionIndex } from '../SectionIndex.native.js';

const state = vi.hoisted(() => ({
    containerClass: 'wide' as ContainerClass,
    scheme: null as 'light' | 'dark' | null,
    /** Each pressable's `accessibilityHint`, by its `aria-label`. */
    hints: new Map<string, string | undefined>(),
    /** Each pressable's `aria-selected`, by its `aria-label`: React Native has no `aria-current`, so this is what a
     * device's screen reader hears (react-native-web writes `aria-current` to the DOM; a device ignores it). */
    selected: new Map<string, boolean | undefined>(),
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useColorScheme: () => state.scheme,
        Pressable: (props: ComponentProps<typeof PressableType>) => {
            if (typeof props['aria-label'] === 'string') {
                state.hints.set(props['aria-label'], props.accessibilityHint);
                state.selected.set(props['aria-label'], props['aria-selected']);
            }

            return createElement(actual.Pressable, props);
        },
    };
});
vi.mock('../../layout/useContainerClass.native.js', () => ({ useContainerClass: () => state.containerClass }));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => true }));

afterEach(() => {
    cleanup();
    state.containerClass = 'wide';
    state.scheme = null;
    state.hints.clear();
    state.selected.clear();
});

const ITEMS: readonly SectionIndexItem[] = [
    { id: 'details', label: 'Details', tone: 'complete' },
    {
        id: 'ingredients',
        label: 'Ingredients',
        tone: 'attention',
        reason: '2 need a match',
        count: 2,
        hint: 'Add what goes in',
    },
    { id: 'steps', label: 'Steps', tone: 'muted', reason: 'Not started' },
    { id: 'photos', label: 'Photos & publish', shortLabel: 'Photos', tone: 'fix', reason: 'Fix 1 thing', count: 1 },
];

const NAV = 'Recipe sections';
const BAR_NAME = 'Sections. Current: Ingredients. 3 need attention.';

function fakeHost(scrollToSection: (id: string) => void): ScrollHostApi {
    return {
        condensed: false,
        scrollingDown: false,
        atTop: true,
        current: undefined,
        onCurrentChange: () => () => undefined,
        viewportsDown: 0,
        pageViewports: 1,
        scrollToTop: () => undefined,
        scrollToSection,
        headingLayout: () => undefined,
        sectionLayout: () => () => undefined,
        handle: createRef<ScrollTarget | null>(),
    };
}

function renderIndex(overrides: Partial<SectionIndexProps> = {}, scrollToSection = vi.fn()) {
    const onJump = vi.fn();
    const utils = render(
        <ScrollHostContext.Provider value={fakeHost(scrollToSection)}>
            <SectionIndex
                label={NAV}
                sheetTitle="Sections"
                sheetCloseLabel="Close sections"
                items={ITEMS}
                currentId="ingredients"
                barName={BAR_NAME}
                barCount="⚠ 3"
                onJump={onJump}
                {...overrides}
            />
        </ScrollHostContext.Provider>,
    );

    return { ...utils, onJump, scrollToSection };
}

/** The stand-in glyph names drawn inside an element (`lucideNativeStub`). */
function glyphsIn(element: HTMLElement): (string | undefined)[] {
    return [...element.querySelectorAll<HTMLElement>('[data-commise-stub="icon"]')].map(
        (glyph) => glyph.dataset['iconName'],
    );
}

function glyphColour(element: HTMLElement): string | undefined {
    return element.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconColor'];
}

describe('SectionIndex (native)', () => {
    describe('rail (wide)', () => {
        it('is a navigation of links, each named by its label alone, the current one marked', () => {
            renderIndex();
            const nav = screen.getByRole('navigation', { name: NAV });
            const links = within(nav).getAllByRole('link');

            expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
                'Details',
                'Ingredients',
                'Steps',
                'Photos & publish',
            ]);
            expect(within(nav).getByRole('link', { name: 'Ingredients' }).getAttribute('aria-current')).toBe(
                'location',
            );
            expect(within(nav).getByRole('link', { name: 'Steps' }).getAttribute('aria-current')).toBeNull();
            expect(state.selected.get('Ingredients')).toBe(true);
            expect(state.selected.get('Steps')).toBe(false);
            expect(screen.queryByRole('button', { name: BAR_NAME })).toBeNull();
        });

        it('shows each reason and hint, and gives them to a screen reader as the row’s hint', () => {
            renderIndex();
            const nav = screen.getByRole('navigation', { name: NAV });

            expect(within(nav).getByText('2 need a match')).toBeDefined();
            expect(within(nav).getByText('Add what goes in')).toBeDefined();
            expect(state.hints.get('Ingredients')).toBe('2 need a match, Add what goes in');
            expect(state.hints.get('Steps')).toBe('Not started');
            expect(state.hints.get('Details')).toBeUndefined();
        });

        it('draws each tone’s glyph: ✓ complete, ⚠ attention and fix, none for muted', () => {
            renderIndex();
            const nav = screen.getByRole('navigation', { name: NAV });

            expect(glyphsIn(within(nav).getByRole('link', { name: 'Details' }))).toEqual(['check']);
            expect(glyphsIn(within(nav).getByRole('link', { name: 'Ingredients' }))).toEqual(['triangle-alert']);
            expect(glyphsIn(within(nav).getByRole('link', { name: 'Steps' }))).toEqual([]);
            expect(glyphsIn(within(nav).getByRole('link', { name: 'Photos & publish' }))).toEqual(['triangle-alert']);
        });

        it.each([
            ['light', role],
            ['dark', roleDark],
        ] as const)('paints its %s roles', (scheme, colors) => {
            state.scheme = scheme;
            renderIndex();
            const nav = screen.getByRole('navigation', { name: NAV });

            expect(getComputedStyle(within(nav).getByText('2 need a match')).color).toBe(formatRgb(colors.attention));
            expect(getComputedStyle(within(nav).getByText('Fix 1 thing')).color).toBe(formatRgb(colors.dangerText));
            expect(getComputedStyle(within(nav).getByText('Not started')).color).toBe(formatRgb(colors.inkMuted));
            expect(getComputedStyle(within(nav).getByText('Ingredients')).color).toBe(formatRgb(colors.ink));
            expect(glyphColour(within(nav).getByRole('link', { name: 'Ingredients' }))).toBe(colors.attention);
            expect(glyphColour(within(nav).getByRole('link', { name: 'Photos & publish' }))).toBe(colors.dangerText);
        });

        it('holds the footer, and a press jumps through the scroll host, then reports', () => {
            const { scrollToSection, onJump } = renderIndex({ railFooter: null });
            fireEvent.click(screen.getByRole('link', { name: 'Steps' }));

            expect(scrollToSection).toHaveBeenCalledWith('steps');
            expect(onJump).toHaveBeenCalledWith('steps');
            expect(scrollToSection.mock.invocationCallOrder[0]).toBeLessThan(onJump.mock.invocationCallOrder[0] ?? 0);
        });
    });

    describe('strip (regular)', () => {
        it('shows the short labels with glyph and count, named by the full label, without the hint', () => {
            state.containerClass = 'regular';
            renderIndex();
            const nav = screen.getByRole('navigation', { name: NAV });
            const photos = within(nav).getByRole('link', { name: 'Photos & publish' });

            expect(within(photos).getByText('Photos')).toBeDefined();
            expect(within(photos).getByText('1')).toBeDefined();
            expect(glyphsIn(photos)).toEqual(['triangle-alert']);
            expect(within(within(nav).getByRole('link', { name: 'Ingredients' })).getByText('2')).toBeDefined();
            expect(glyphsIn(within(nav).getByRole('link', { name: 'Steps' }))).toEqual([]);
            expect(within(nav).queryByText('Add what goes in')).toBeNull();
            expect(within(nav).queryByText('2 need a match')).toBeNull();
            expect(state.hints.get('Ingredients')).toBe('2 need a match');
            expect(within(nav).getByRole('link', { name: 'Ingredients' }).getAttribute('aria-current')).toBe(
                'location',
            );
        });
    });

    describe('bar and sheet (narrow)', () => {
        it('is one button naming the index, collapsed, showing the current label and count', () => {
            state.containerClass = 'narrow';
            renderIndex({ barSuffix: ' · 1 of 4 done' });
            const bar = screen.getByRole('button', { name: BAR_NAME });

            expect(bar.getAttribute('aria-expanded')).toBe('false');
            expect(within(bar).getByText('Ingredients', { exact: false })).toBeDefined();
            expect(within(bar).getByText('· 1 of 4 done', { exact: false })).toBeDefined();
            expect(within(bar).getByText('⚠ 3')).toBeDefined();
            expect(screen.queryByRole('navigation', { name: NAV })).toBeNull();
        });

        it('opens the sheet, closes it BEFORE the jump, then reports', async () => {
            state.containerClass = 'narrow';
            const seen: string[] = [];
            // The sheet has closed when its host has committed the close: the bar reads collapsed. (react-native-web's
            // Modal unmounts its content a beat later than Android's, so the title is checked after the jump instead.)
            const scrollToSection = vi.fn((id: string) => {
                const expanded = screen.getByRole('button', { name: BAR_NAME }).getAttribute('aria-expanded');
                seen.push(`jump ${id}, sheet ${expanded === 'false' ? 'closed' : 'open'}`);
            });
            const { onJump } = renderIndex({}, scrollToSection);
            onJump.mockImplementation((id: string) => seen.push(`onJump ${id}`));

            fireEvent.click(screen.getByRole('button', { name: BAR_NAME }));
            expect(screen.getByText('Sections')).toBeDefined();
            expect(screen.getByRole('button', { name: BAR_NAME }).getAttribute('aria-expanded')).toBe('true');
            const steps = screen.getAllByRole('link', { name: 'Steps' });
            expect(steps).toHaveLength(1);
            expect(screen.getByRole('link', { name: 'Ingredients' }).getAttribute('aria-current')).toBe('location');

            await act(async () => {
                fireEvent.click(steps[0] as HTMLElement);
                await Promise.resolve();
            });

            expect(seen).toEqual(['jump steps, sheet closed', 'onJump steps']);
            expect(screen.queryByText('Sections')).toBeNull();
        });
    });
});
