/**
 * The Tamagui test helpers. Tamagui's web build, which the native test lane runs, paints a theme colour as a CSS
 * variable (`var(--paper)`), and jsdom does not resolve variables, so a colour assertion would compare variable names.
 * `resolvedColour` follows the variables the way a browser would: from the element's nearest theme class to the
 * theme's rule, and from there through each further variable to a value. These rows prove it returns the colour the
 * design system holds, in each scheme, so a test built on it asserts real colours.
 */
import { cleanup, render as renderBare, screen } from '@testing-library/react';
import { formatRgb } from 'culori';
import { createContext, useContext, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { styled, Text, View } from 'tamagui';

import { role, roleDark } from '../../tokens/colors.js';
import { radius, spacing } from '../../tokens/scale.js';
import { systemScheme } from '../systemColorScheme.js';
import {
    ARIA_HIDDEN_CONTENT,
    render,
    renderedRoot,
    rendersNothing,
    renderWithTamagui,
    resolvedColour,
    resolvedStyle,
} from '../tamaguiTesting.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../systemColorScheme.js');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

const Swatch = styled(View, { backgroundColor: '$paper', borderColor: '$lineDivider', borderWidth: 1 });

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe('render', () => {
    it.each([
        ['dark', roleDark],
        ['light', role],
    ] as const)('mounts the design system in the scheme the device reports (%s)', (scheme, colors) => {
        systemScheme.current = scheme;

        render(<Swatch aria-label="swatch" />);

        expect(resolvedColour(screen.getByLabelText('swatch'), 'backgroundColor')).toBe(formatRgb(colors.paper));
    });

    it('keeps a wrapper the caller passes, inside the design system', () => {
        const Word = createContext('none');
        const Reader = (): ReactNode => <Text>{useContext(Word)}</Text>;
        const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
            <Word.Provider value="given">{children}</Word.Provider>
        );

        systemScheme.current = 'dark';
        render(
            <>
                <Reader />
                <Swatch aria-label="swatch" />
            </>,
            { wrapper },
        );

        expect(screen.getByText('given')).toBeTruthy();
        expect(resolvedColour(screen.getByLabelText('swatch'), 'backgroundColor')).toBe(formatRgb(roleDark.paper));
    });

    it('keeps the design system on a rerender', () => {
        systemScheme.current = 'dark';
        const { rerender } = render(<Swatch aria-label="before" />);

        rerender(<Swatch aria-label="after" />);

        expect(resolvedColour(screen.getByLabelText('after'), 'backgroundColor')).toBe(formatRgb(roleDark.paper));
    });
});

describe('resolvedColour', () => {
    it.each([
        ['light', role],
        ['dark', roleDark],
    ] as const)('resolves a theme token to the %s role colour', (scheme, colors) => {
        renderWithTamagui(<Swatch aria-label="swatch" />, scheme);

        const swatch = screen.getByLabelText('swatch');

        expect(resolvedColour(swatch, 'backgroundColor')).toBe(formatRgb(colors.paper));
        expect(resolvedColour(swatch, 'borderTopColor')).toBe(formatRgb(colors.lineDivider));
    });

    it('reads a variant’s rule, which repeats its class to win on specificity', () => {
        const Tinted = styled(View, {
            backgroundColor: '$paper',
            variants: { on: { true: { backgroundColor: '$inkMuted' } } } as const,
        });

        renderWithTamagui(<Tinted aria-label="tinted" on />, 'light');

        expect(resolvedColour(screen.getByLabelText('tinted'), 'backgroundColor')).toBe(formatRgb(role.inkMuted));
    });

    it('returns a colour that is not a variable as it is', () => {
        renderWithTamagui(<View aria-label="plain" style={{ backgroundColor: 'rgb(1, 2, 3)' }} />, 'light');

        expect(resolvedColour(screen.getByLabelText('plain'), 'backgroundColor')).toBe('rgb(1, 2, 3)');
    });

    it('throws for a variable no theme defines, so a typo cannot read as a colour', () => {
        renderWithTamagui(<View aria-label="bad" style={{ backgroundColor: 'var(--notARole)' }} />, 'light');

        expect(() => resolvedColour(screen.getByLabelText('bad'), 'backgroundColor')).toThrow(/notARole/u);
    });
});

describe('resolvedStyle', () => {
    it('resolves size, space and radius tokens to the scale, shorthands included', () => {
        const Box = styled(View, { minHeight: '$5', paddingHorizontal: '$2', borderRadius: '$sm' });

        renderWithTamagui(<Box aria-label="box" />, 'light');

        const box = screen.getByLabelText('box');

        expect(resolvedStyle(box, 'minHeight')).toBe(`${String(spacing[5])}px`);
        expect(resolvedStyle(box, 'paddingLeft')).toBe(`${String(spacing[2])}px`);
        expect(resolvedStyle(box, 'borderTopLeftRadius')).toBe(`${String(radius.sm)}px`);
    });

    it('reads an edge no style sets as 0, as React Native draws it, not as the browser default', () => {
        const Plain = styled(View, { paddingVertical: 3 });

        renderWithTamagui(<Plain aria-label="plain" />, 'light');

        expect(resolvedStyle(screen.getByLabelText('plain'), 'borderTopWidth')).toBe('0px');
        expect(resolvedStyle(screen.getByLabelText('plain'), 'borderBottomWidth')).toBe('0px');
    });

    it('reads every edge of a border width and of a vertical padding Tamagui writes as a shorthand', () => {
        const Edged = styled(View, { borderWidth: 1, borderColor: '$lineDivider', paddingVertical: 3 });

        renderWithTamagui(<Edged aria-label="edged" />, 'light');

        const edged = screen.getByLabelText('edged');

        expect(resolvedStyle(edged, 'borderBottomWidth')).toBe('1px');
        expect(resolvedStyle(edged, 'paddingBottom')).toBe('3px');
    });
});

describe('renderedRoot', () => {
    it('steps over the config marker and the theme wrappers Tamagui adds, which draw no box', () => {
        const { container } = render(
            <View aria-label="root">
                <View aria-label="child" />
            </View>,
        );

        expect(renderedRoot(container).getAttribute('aria-label')).toBe('root');
    });

    it('returns the first element as it is when no provider wraps the tree', () => {
        const { container } = renderBare(<div aria-label="plain" />);

        expect(renderedRoot(container).getAttribute('aria-label')).toBe('plain');
    });

    it('throws when the tree rendered no element, so a test cannot measure nothing', () => {
        const { container } = renderBare(<></>);

        expect(() => renderedRoot(container)).toThrow(/no element/u);
    });
});

describe('rendersNothing', () => {
    it('is true when the tree drew no element inside the provider', () => {
        const Empty = (): null => null;
        const { container } = render(<Empty />);

        expect(container.innerHTML).not.toBe('');
        expect(rendersNothing(container)).toBe(true);
    });

    it('is false when the tree drew only text', () => {
        const Bare = (): string => 'loose words';
        const { container } = render(<Bare />);

        expect(rendersNothing(container)).toBe(false);
    });

    it('is false when the tree drew an element', () => {
        const { container } = render(<View aria-label="something" />);

        expect(rendersNothing(container)).toBe(false);
    });
});

describe('ARIA_HIDDEN_CONTENT', () => {
    it('matches what the tree hides from assistive technology, and not the config marker Tamagui adds', () => {
        render(
            <View>
                <View aria-hidden />
                <View aria-label="shown" />
            </View>,
        );

        expect(document.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(1);
        expect(document.querySelectorAll(ARIA_HIDDEN_CONTENT)).toHaveLength(1);
    });
});
