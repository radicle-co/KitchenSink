/**
 * The native label-and-value pair: a label with its value beside it at the end of the line, or under it at the start
 * when the column has too little room for the text size (designer rulings 2026-11-01, `nativeBoards/designAnswers.md`).
 * The room is `labelValueStacksAt(contentWidthOf(width), cappedFontScale(fontScale))`, read from the window, which is
 * mocked so each case names the window it is in. A 390 pt phone's content is 358 pt wide: it stacks a little above
 * 1.25x. A 1024 pt tablet never stacks at the cap.
 *
 * The label never breaks inside a word: beside its value it does not shrink, so the value takes what is left and wraps.
 * The value never truncates. The shrink is read from what each element's own class rules DECLARE, because jsdom's
 * initial `flex-shrink` is 1 where React Native's is 0.
 *
 * ⚠️ jsdom cannot show the right-to-left flip of `textAlign` (React Native swaps 'right' and 'left' under a right-to-left
 * layout; Tamagui's web build writes physical CSS), nor what a device draws at a real font scale.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';
import { Text } from '@commise/ui/text';

const env = vi.hoisted(() => ({ width: 390, fontScale: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: env.width, fontScale: env.fontScale }),
    };
});

import { LabelValuePair } from '../LabelValuePair.native.js';

beforeEach(() => {
    env.width = 390;
    env.fontScale = 1;
});

afterEach(cleanup);

const px = (n: number): string => `${String(n)}px`;

/** The `flex-shrink` an element's own class rules declare, or `undefined` when none does. */
function declaredFlexShrink(element: Element): string | undefined {
    const classes = Array.from(element.classList).map((name) => `.${name}`);

    return Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules))
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        .filter((rule) => classes.some((name) => rule.selectorText.split(/[\s,]+/u).includes(name)))
        .map((rule) => rule.style.getPropertyValue('flex-shrink'))
        .find((value) => value !== '');
}

function renderPair(): { readonly pair: Element; readonly label: Element; readonly value: Element } {
    renderWithTamagui(
        <LabelValuePair
            label={
                <Text typeRole="body" color="$ink">
                    Display name
                </Text>
            }
            value="eliza.moreno.long.address@example.com"
        />,
        'light',
    );
    const value = screen.getByText('eliza.moreno.long.address@example.com');
    const pair = value.parentElement as Element;
    // The label's own wrapper: the pair's other child.
    const label = Array.from(pair.children).find((child) => child !== value) as Element;

    return { pair, label, value };
}

describe('LabelValuePair (native) — beside, with room', () => {
    it.each([
        [390, 1],
        [390, 1.25],
        [1024, 3.1],
    ])('sets the value beside its label, at the end, in a %s pt window at %sx', (width, fontScale) => {
        env.width = width;
        env.fontScale = fontScale;
        const { pair, label, value } = renderPair();

        expect(label.textContent).toBe('Display name');
        expect(resolvedStyle(pair, 'flexDirection')).toBe('row');
        expect(resolvedStyle(pair, 'alignItems')).toBe('center');
        expect(resolvedStyle(pair, 'justifyContent')).toBe('space-between');
        expect(resolvedStyle(pair, 'gap')).toBe(px(nativeTokens.spacing[3]));
        expect(resolvedStyle(value, 'textAlign')).toBe('right');
    });

    it('keeps the label whole and lets the value take what is left and wrap', () => {
        const { label, value } = renderPair();

        expect(declaredFlexShrink(label)).toBe('0');
        expect(declaredFlexShrink(value)).toBe('1');
    });
});

describe('LabelValuePair (native) — stacked, with too little room', () => {
    it.each([
        [390, 1.3],
        [390, 2],
        [320, 1.1],
    ])('stacks the value under its label, at the start, 4 apart, in a %s pt window at %sx', (width, fontScale) => {
        env.width = width;
        env.fontScale = fontScale;
        const { pair, value } = renderPair();

        expect(resolvedStyle(pair, 'flexDirection')).toBe('column');
        expect(resolvedStyle(pair, 'alignItems')).toBe('flex-start');
        expect(resolvedStyle(pair, 'gap')).toBe(px(nativeTokens.spacing[1]));
        expect(resolvedStyle(value, 'textAlign')).toBe('left');
    });
});

describe('LabelValuePair (native) — the value', () => {
    it.each([
        [390, 1],
        [390, 2],
    ])('never truncates the value in a %s pt window at %sx', (width, fontScale) => {
        env.width = width;
        env.fontScale = fontScale;
        const { value } = renderPair();

        expect(resolvedStyle(value, 'whiteSpace')).not.toBe('nowrap');
        expect(resolvedStyle(value, 'textOverflow')).not.toBe('ellipsis');
        expect(resolvedStyle(value, 'maxWidth')).not.toBe('50%');
    });

    it.each(['light', 'dark'] as const)('sets the value in body, in inkMuted, in the %s scheme', (scheme) => {
        const spec = nativeTokens.type.body;
        renderWithTamagui(<LabelValuePair label={null} value="Eliza" />, scheme);
        const value = screen.getByText('Eliza');

        expect(getComputedStyle(value).fontSize).toBe(px(spec.fontSize));
        expect(resolvedColour(value, 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
    });
});
