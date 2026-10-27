/**
 * The resume notice (native): it paints `surfaceMuted` and holds Save changes and Discard, so it states that surface
 * (`componentFixes.md` §10) and its controls press to the MUTED row of the press table, in both themes. Its corner is the
 * 18 pt `lg` step (`componentFixes.md` §10a).
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so `Pressable` is stood in for by one that
 * renders its `pressed` branch; everything above it (the notice, `Button`, `Surface`, the paint) is the real code.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const press = vi.hoisted(() => ({ pressed: false }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const { createElement } = await import('react');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        Pressable: (props: {
            readonly children: unknown;
            readonly style: (state: { pressed: boolean }) => Record<string, unknown>;
            readonly accessibilityRole?: 'button';
            readonly accessibilityLabel?: string;
        }) =>
            createElement(
                actual.View,
                {
                    role: props.accessibilityRole,
                    'aria-label': props.accessibilityLabel,
                    style: typeof props.style === 'function' ? props.style({ pressed: press.pressed }) : props.style,
                },
                typeof props.children === 'function'
                    ? (props.children as (state: { pressed: boolean }) => never)({ pressed: press.pressed })
                    : (props.children as never),
            ),
    };
});

import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { themeFor } from '@commise/ui/theme';

import { ResumeNotice } from '../ResumeNotice.native.js';

afterEach(() => {
    cleanup();
    press.pressed = false;
    systemScheme.current = null;
});

const renderNotice = (): void => {
    render(
        <ResumeNotice
            body="You have changes from 10:42 that aren’t saved to your recipe."
            saveLabel="Save changes"
            discardLabel="Discard"
            onSave={vi.fn()}
            onDiscard={vi.fn()}
        />,
    );
};

/** The painted pill of a button: the first rounded element inside it. */
function pillOf(button: HTMLElement): HTMLElement {
    const pill = [button, ...Array.from(button.querySelectorAll<HTMLElement>('*'))].find(
        (element) => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) > 0,
    );

    if (pill === undefined) {
        throw new Error('The button paints no rounded surface.');
    }

    return pill;
}

describe.each(['light', 'dark'] as const)('ResumeNotice (native) in the %s theme', (scheme) => {
    it('paints the muted fill on the 18 pt notice corner', () => {
        systemScheme.current = scheme;
        renderNotice();
        const card = screen.getByText(/aren’t saved/u).parentElement as HTMLElement;
        const style = getComputedStyle(card);

        expect(style.backgroundColor).toBe(rgb(rolesFor(scheme).surfaceMuted));
        expect(style.borderTopLeftRadius).toBe('18px');
    });

    it('presses Discard (a ghost button) to the muted surface’s press, not the page’s', () => {
        systemScheme.current = scheme;
        press.pressed = true;
        renderNotice();
        const theme = themeFor(scheme);
        const fill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Discard' }))).backgroundColor;

        expect(fill).toBe(rgb(theme.press.muted));
        expect(fill).not.toBe(rgb(theme.press.canvas));
    });
});
