/**
 * The native read-only Profile row: a label and a value the cook cannot change here. It is one accessibility element,
 * so a screen reader reads "Email, eliza@example.com" in a single swipe instead of two stops. A long unbroken value
 * shrinks and wraps rather than running off a 320 pt screen. This restores the "unbroken email wraps at 320" case that
 * lived in the ProfileHeader suite until the email moved into this row.
 *
 * ⚠️ react-native-web drops RN's `accessible` prop, so `View` is wrapped to put what React Native receives on the node
 * as `data-accessible` (react-native-web's `dataSet`). What is proven is the prop React Native gets, not that a screen
 * reader honours it.
 *
 * REWRITTEN for ADR-0080: the label and the value are the design system's Tamagui `Text`, so they render in its
 * provider, and the shrink is read from what each text's own class rules DECLARE. A browser's (and jsdom's) initial
 * `flex-shrink` is 1 where React Native's is 0, so the computed value cannot tell the two texts apart; the declared one
 * is what Tamagui hands React Native. The old `Text` wrapper read the same fact from a React Native style, which these
 * texts no longer have.
 */
import { cleanup, screen } from '@testing-library/react';
import { createElement, forwardRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { render, renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const View = forwardRef<unknown, ComponentProps<typeof actual.View>>((props, ref) =>
        createElement(actual.View, {
            ...props,
            ref,
            ...(props.accessible === true ? { dataSet: { accessible: 'true' } } : {}),
        } as never),
    );

    return { ...actual, View };
});

import { ProfileFactRow } from '../ProfileFactRow.native.js';

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
