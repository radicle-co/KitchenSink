/**
 * The native read-only Profile row: a label and a value the cook cannot change here. It is one accessibility element,
 * so a screen reader reads "Email, eliza@example.com" in a single swipe instead of two stops. A long unbroken value
 * shrinks and wraps rather than running off a 320 pt screen. This restores the "unbroken email wraps at 320" case that
 * lived in the ProfileHeader suite until the email moved into this row.
 *
 * The value sits at the END of the line, and at large text it stacks under its label (designer ruling 2026-11-01,
 * `nativeBoards/designAnswers.md`). The window's width and font scale are mocked, so each case names the room it is in.
 *
 * REWRITTEN for the row's move to a Tamagui `View` (ADR-0080). The "one accessibility element" case used to wrap React
 * Native's `View`; the row is no longer one, and Tamagui's web build, which this lane runs, drops `accessible`. So
 * Tamagui's `View` is wrapped to put the prop it receives on the node as `data-accessible`. What is proven is the prop
 * Tamagui gets, which its native build hands to React Native's view, not that a screen reader honours it.
 *
 * ⚠️ jsdom cannot show the right-to-left flip. React Native swaps `textAlign` 'right' and 'left' when the text's layout
 * direction is right to left, but Tamagui's web build writes CSS `text-align: right`, which is physical. Only a device
 * in a right-to-left layout proves it.
 *
 * The label and the value are the design system's Tamagui `Text`, so they render in its provider, and the shrink is
 * read from what each text's own class rules DECLARE. A browser's (and jsdom's) initial `flex-shrink` is 1 where React
 * Native's is 0, so the computed value cannot tell the two texts apart; the declared one is what Tamagui hands React
 * Native.
 */
import { cleanup, screen } from '@testing-library/react';
import { createElement, forwardRef, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { render, renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

const env = vi.hoisted(() => ({ width: 390, fontScale: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: env.width, fontScale: env.fontScale }),
    };
});

vi.mock('tamagui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('tamagui')>();
    const View = forwardRef<unknown, ComponentProps<typeof actual.View>>((props, ref) =>
        createElement(actual.View, {
            ...props,
            ref,
            ...(props.accessible === true ? { 'data-accessible': 'true' } : {}),
        } as never),
    );

    return { ...actual, View };
});

import { ProfileFactRow } from '../ProfileFactRow.native.js';

beforeEach(() => {
    env.width = 390;
    env.fontScale = 1;
});

afterEach(cleanup);

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

describe('ProfileFactRow (native)', () => {
    it('shows the label and the value', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('eliza@example.com')).toBeTruthy();
    });

    it('is plain text: no button', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('is ONE accessibility element holding both the label and the value', () => {
        const { container } = render(<ProfileFactRow label="Email" value="eliza@example.com" />);
        const unit = container.querySelector('[data-accessible="true"]');

        expect(unit).not.toBeNull();
        expect(unit?.textContent).toBe('Emaileliza@example.com');
    });

    it('lets a long unbroken value shrink and wrap instead of running off a 320 pt screen', () => {
        const email = `${'a'.repeat(60)}@example.com`;
        render(<ProfileFactRow label="Email" value={email} />);

        // The value takes the room the label leaves; the label keeps its width.
        expect(declaredFlexShrink(screen.getByText(email))).toBe('1');
        expect(declaredFlexShrink(screen.getByText('Email'))).toBeUndefined();
    });
});

// ADR-0080: the label and the value draw through the design system's `Text`, both in the `body` role like the web row's
// `text-body`, the label in `ink` and the value in `inkMuted`, so they follow the device's dark scheme and the 2x cap.
describe('ProfileFactRow (native) — type and colour', () => {
    it('sets the label and the value in the body role, the value set against the end', () => {
        const spec = nativeTokens.type.body;
        renderWithTamagui(<ProfileFactRow label="Email" value="eliza@example.com" />, 'light');

        for (const text of ['Email', 'eliza@example.com']) {
            const style = getComputedStyle(screen.getByText(text));

            expect(style.fontFamily, text).toContain(spec.fontFamily);
            expect(style.fontSize, text).toBe(`${String(spec.fontSize)}px`);
            expect(style.lineHeight, text).toBe(`${String(spec.lineHeight)}px`);
        }

        expect(resolvedStyle(screen.getByText('eliza@example.com'), 'textAlign')).toBe('right');
    });

    it.each(['light', 'dark'] as const)(
        'paints the label in ink and the value in inkMuted in the %s scheme',
        (scheme) => {
            renderWithTamagui(<ProfileFactRow label="Email" value="eliza@example.com" />, scheme);
            const roles = rolesFor(scheme);

            expect(resolvedColour(screen.getByText('Email'), 'color')).toBe(rgb(roles.ink));
            expect(resolvedColour(screen.getByText('eliza@example.com'), 'color')).toBe(rgb(roles.inkMuted));
        },
    );
});

// Designer rulings 2026-11-01 (`nativeBoards/designAnswers.md`, `reviews/androidShots1.md`): the value sits at the END
// of the line beside its label, and the row stacks by ROOM: when the content width over the capped font scale is below
// 280. REWRITTEN from the first ruling's scale-only rule (stack above 1.3x), which stacked a wide tablet that had room.
// A 390 pt phone's content is 358 pt wide (16 pt gutters), so it stacks a little above 1.25x; a 1024 pt tablet's is 960.
describe('ProfileFactRow (native) — layout at each text size', () => {
    /** The row: the element that holds both texts. */
    function rowOf(): Element {
        return screen.getByText('Email').parentElement as Element;
    }

    it.each([
        [390, 1],
        [390, 1.25],
        [1024, 3.1],
    ])('sets the value beside its label, at the end of the line, in a %s pt window at %sx', (width, fontScale) => {
        env.width = width;
        env.fontScale = fontScale;
        renderWithTamagui(<ProfileFactRow label="Email" value="eliza@example.com" />, 'light');

        expect(rowOf().contains(screen.getByText('eliza@example.com'))).toBe(true);
        expect(resolvedStyle(rowOf(), 'flexDirection')).toBe('row');
        expect(resolvedStyle(rowOf(), 'justifyContent')).toBe('space-between');
        expect(resolvedStyle(screen.getByText('eliza@example.com'), 'textAlign')).toBe('right');
    });

    it.each([
        [390, 1.3],
        [390, 2],
        [320, 1.1],
    ])('stacks the value under its label, at the start, in a %s pt window at %sx', (width, fontScale) => {
        env.width = width;
        env.fontScale = fontScale;
        renderWithTamagui(<ProfileFactRow label="Email" value="eliza@example.com" />, 'light');

        expect(rowOf().contains(screen.getByText('eliza@example.com'))).toBe(true);
        expect(resolvedStyle(rowOf(), 'flexDirection')).toBe('column');
        expect(resolvedStyle(rowOf(), 'alignItems')).toBe('flex-start');
        expect(resolvedStyle(screen.getByText('eliza@example.com'), 'textAlign')).toBe('left');
    });

    it.each([1, 2])(
        'keeps the 56 pt row, space-3 between the parts and the space-4 and space-2 insets at %s',
        (scale) => {
            env.fontScale = scale;
            renderWithTamagui(<ProfileFactRow label="Email" value="eliza@example.com" />, 'light');
            const px = (n: number): string => `${String(n)}px`;

            expect(resolvedStyle(rowOf(), 'minHeight')).toBe('56px');
            expect(resolvedStyle(rowOf(), 'gap')).toBe(px(nativeTokens.spacing[3]));
            expect(resolvedStyle(rowOf(), 'paddingLeft')).toBe(px(nativeTokens.spacing[4]));
            expect(resolvedStyle(rowOf(), 'paddingRight')).toBe(px(nativeTokens.spacing[4]));
            expect(resolvedStyle(rowOf(), 'paddingTop')).toBe(px(nativeTokens.spacing[2]));
            expect(resolvedStyle(rowOf(), 'paddingBottom')).toBe(px(nativeTokens.spacing[2]));
        },
    );

    it('stays one accessibility element, with no button, when it stacks', () => {
        env.fontScale = 2;
        const { container } = render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(container.querySelector('[data-accessible="true"]')?.textContent).toBe('Emaileliza@example.com');
        expect(screen.queryByRole('button')).toBeNull();
    });
});
