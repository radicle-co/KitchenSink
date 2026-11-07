/**
 * The native `SectionIndex` at the largest iOS text size (ADR-0080 §8, designer ruling 2026-11-01): every text takes its
 * role's cap, 2× for `label`, `meta` and `caption`. The bar, strip, rail and sheet rows drew their texts with raw React
 * Native `Text`, which iOS scales without a cap (the sticky sections bar drew at about 40 pt). Each case renders at a
 * system text scale of 3.1, above every cap, and reads the size and leading the text is DRAWN at, so it fails for any
 * text that does not take the cap, by whatever mechanism.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContainerClass } from '../../layout/containerClass.js';
import type { ScrollHostApi, ScrollTarget } from '../../scrollHost/props.js';
import { ScrollHostContext } from '../../scrollHost/scrollHostContext.js';
import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { scaledTypeSize } from '../../text/scaledType.js';
import { nativeTokens } from '../../tokens/native.js';
import type { SectionIndexItem } from '../props.js';
import { SectionIndex } from '../SectionIndex.native.js';
import { createRef } from 'react';

const state = vi.hoisted(() => ({ containerClass: 'narrow' as ContainerClass }));

vi.mock('../../layout/useContainerClass.native.js', () => ({ useContainerClass: () => state.containerClass }));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => true }));

afterEach(() => {
    cleanup();
    state.containerClass = 'narrow';
});

const SCALE = 3.1;
const { label, meta, caption } = nativeTokens.type;
const CAPPED = (role: { readonly fontSize: number; readonly lineHeight: number }) => ({
    fontSize: `${String(role.fontSize * 2)}px`,
    lineHeight: `${String(role.lineHeight * 2)}px`,
});

const ITEMS: readonly SectionIndexItem[] = [
    { id: 'details', label: 'Details', tone: 'complete' },
    {
        id: 'ingredients',
        label: 'Ingredients',
        tone: 'attention',
        reason: '2 need a match',
        count: 2,
        hint: 'Add food',
    },
    { id: 'steps', label: 'Steps', tone: 'muted', reason: 'Not started' },
];

const host: ScrollHostApi = {
    condensed: false,
    scrollingDown: false,
    atTop: true,
    current: undefined,
    onCurrentChange: () => () => undefined,
    viewportsDown: 0,
    pageViewports: 1,
    scrollToTop: () => undefined,
    scrollToSection: () => undefined,
    scrollToField: () => false,
    revealSpan: () => false,
    headingLayout: () => undefined,
    sectionLayout: () => () => undefined,
    handle: createRef<ScrollTarget | null>(),
};

/** What a bar text draws at the chrome cap, read from the shared scaling arithmetic. */
function chromeCapped(role: 'label' | 'meta') {
    const { fontSize, lineHeight } = scaledTypeSize(role, SCALE, '1.5');

    return { fontSize: `${String(fontSize)}px`, lineHeight: `${String(lineHeight)}px` };
}

function draw(): void {
    renderWithTamagui(
        <ScrollHostContext.Provider value={host}>
            <SectionIndex
                label="Recipe sections"
                sheetTitle="Sections"
                sheetCloseLabel="Close sections"
                items={ITEMS}
                currentId="ingredients"
                barName="Sections. Current: Ingredients."
                barSuffix=" (2 of 3)"
                barCount="⚠ 3"
            />
        </ScrollHostContext.Provider>,
        'light',
        SCALE,
    );
}

function drawn(text: string | RegExp): { fontSize: string; lineHeight: string } {
    const { fontSize, lineHeight } = getComputedStyle(screen.getByText(text));

    return { fontSize, lineHeight };
}

describe('SectionIndex (native) at a system text scale of 3.1', () => {
    // Designer ruling 2026-11-07 (option A): the sticky bar is chrome, so it grows to 1.5× at most and never draws larger
    // than the page title, `barTitle` at the same chrome cap (EditorHeader).
    it('⛔ draws the bar’s label, suffix and count at the 1.5× chrome cap, not 3.1×', () => {
        draw();

        expect(drawn(/^Ingredients/u)).toEqual(chromeCapped('label'));
        expect(drawn('(2 of 3)')).toEqual(chromeCapped('meta'));
        expect(drawn('⚠ 3')).toEqual(chromeCapped('label'));
    });

    it('⛔ never draws the bar’s label larger than the page title', () => {
        draw();

        const title = scaledTypeSize('barTitle', SCALE, '1.5');

        for (const text of [/^Ingredients/u, '(2 of 3)', '⚠ 3']) {
            const { fontSize } = drawn(text);

            expect(Number.parseFloat(fontSize)).toBeLessThanOrEqual(title.fontSize);
        }
    });

    it('⛔ draws the open list’s rows at 2× their roles: label, status line and hint', () => {
        draw();
        fireEvent.click(screen.getByRole('button', { name: 'Sections. Current: Ingredients.' }));

        expect(drawn('Details')).toEqual(CAPPED(meta));
        expect(drawn('Steps')).toEqual(CAPPED(meta));
        expect(drawn('2 need a match')).toEqual(CAPPED(caption));
        expect(drawn('Add food')).toEqual(CAPPED(caption));
    });

    it('⛔ draws the strip’s labels and counts at 2× their roles', () => {
        state.containerClass = 'regular';
        draw();

        expect(drawn('Details')).toEqual(CAPPED(meta));
        expect(drawn('Ingredients')).toEqual(CAPPED(label));
    });

    it('⛔ draws the rail’s rows at 2× their roles', () => {
        state.containerClass = 'wide';
        draw();

        expect(drawn('Steps')).toEqual(CAPPED(meta));
        expect(drawn('Ingredients')).toEqual(CAPPED(label));
        expect(drawn('Not started')).toEqual(CAPPED(caption));
    });
});
