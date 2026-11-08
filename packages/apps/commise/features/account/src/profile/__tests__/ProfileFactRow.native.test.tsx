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

        // The value takes the room the label leaves; the label's wrapper keeps its width.
        expect(declaredFlexShrink(screen.getByText(email))).toBe('1');
        expect(declaredFlexShrink(screen.getByText('Email').parentElement as Element)).toBe('0');
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
// of the line beside its label, and stacks under it when the content width over the capped font scale is below 280.
// The row draws its label and value through `LabelValuePair`, whose suite pins every window, scale, gap and alignment;
// these cases MOVED there when ProfileRow came to share the pair. What stays is the row's own frame, and that it lays
// out through the pair: beside on a 390 pt phone at 1x, stacked at 1.3x.
describe('ProfileFactRow (native) — frame and layout', () => {
    const px = (n: number): string => `${String(n)}px`;

    /** The row's frame: the one accessibility element. */
    function frameOf(container: Element): Element {
        return container.querySelector('[data-accessible="true"]') as Element;
    }

    it.each([
        [390, 1],
        [390, 2],
    ])('keeps the 56 pt row and the space-4 and space-2 insets in a %s pt window at %sx', (width, fontScale) => {
        env.width = width;
        env.fontScale = fontScale;
        const { container } = renderWithTamagui(<ProfileFactRow label="Email" value="eliza@example.com" />, 'light');
        const frame = frameOf(container);

        expect(resolvedStyle(frame, 'minHeight')).toBe('56px');
        expect(resolvedStyle(frame, 'paddingLeft')).toBe(px(nativeTokens.spacing[4]));
        expect(resolvedStyle(frame, 'paddingRight')).toBe(px(nativeTokens.spacing[4]));
        expect(resolvedStyle(frame, 'paddingTop')).toBe(px(nativeTokens.spacing[2]));
        expect(resolvedStyle(frame, 'paddingBottom')).toBe(px(nativeTokens.spacing[2]));
    });

    it.each([
        [1, 'row'],
        [1.3, 'column'],
    ])('lays out through the pair: at %sx on a 390 pt phone its direction is %s', (fontScale, direction) => {
        env.fontScale = fontScale;
        renderWithTamagui(<ProfileFactRow label="Email" value="eliza@example.com" />, 'light');
        const pair = screen.getByText('eliza@example.com').parentElement as Element;

        expect(pair.contains(screen.getByText('Email'))).toBe(true);
        expect(resolvedStyle(pair, 'flexDirection')).toBe(direction);
    });

    it('stays one accessibility element, with no button, when it stacks', () => {
        env.fontScale = 2;
        const { container } = render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(frameOf(container).textContent).toBe('Emaileliza@example.com');
        expect(screen.queryByRole('button')).toBeNull();
    });
});
