/**
 * What Tamagui 3 does under this package's native test lane, pinned so a Tamagui upgrade that changes it fails here
 * instead of silently changing what our component tests can prove.
 *
 * The lane runs Tamagui's WEB build. Its native build cannot load under react-native-web: it requires
 * `react-native/Libraries/Renderer/shims/ReactFabric` and React Native's own `usePressability`, which only a device
 * has (measured 2026-10-31 on 3.1.9 by resolving the `react-native` condition: the suite fails to import). So a
 * native component test proves structure, accessibility and behaviour, and a device (Maestro) is the evidence for
 * styling. Two consequences are pinned below:
 *
 * - Line height. A bare number is a ratio of the font size, in the JSX prop AND inside the `style` prop: both reach
 *   the DOM unitless, which CSS reads as a multiplier. Tamagui's native build reads them the same way
 *   (`nativeTextMetrics.ts`). Only a `px` string is pixels, which is why the design system writes every line height
 *   as one, and why the guard refuses a number in either place.
 * - Theme colours. A theme token reaches the DOM as a CSS variable, which jsdom does not resolve. A test cannot read
 *   a theme colour off a rendered element in this lane; the theme VALUES are asserted on the built config instead.
 *
 * The config is a minimal stand-in, not the design system's: these probes test Tamagui, not our tokens.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createFont, createTamagui, createTokens, styled, TamaguiProvider, Text, View, XStack } from 'tamagui';
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

const font = createFont({ family: 'System', size: { 1: 16 }, lineHeight: { 1: 24 }, weight: { 1: '400' } });

const config = createTamagui({
    tokens: createTokens({ space: { 0: 0 }, size: { 0: 0 }, radius: { 0: 0 }, zIndex: { 0: 0 }, color: {} }),
    themes: { light: { paper: 'rgb(255, 255, 255)' }, dark: { paper: 'rgb(0, 0, 0)' } },
    fonts: { body: font, heading: font },
    settings: { styleCompat: 'react-native' },
});

function Probe({ children }: { readonly children: ReactNode }) {
    return (
        <TamaguiProvider config={config} defaultTheme="light">
            {children}
        </TamaguiProvider>
    );
}

function styleOf(label: string): CSSStyleDeclaration {
    return getComputedStyle(screen.getByLabelText(label));
}

const PxLine = styled(Text, { fontSize: 16, lineHeight: '24px' });

const Paper = styled(View, { backgroundColor: '$paper' });

const Frame = styled(View, { padding: 12, flexDirection: 'row' });

const Busy = styled(View, { variants: { busy: { true: { opacity: 0.4 } } } as const });

afterEach(() => {
    cleanup();
});

describe('Tamagui 3 under the native test lane (web build)', () => {
    it('keeps a px-string line height as pixels', () => {
        render(
            <Probe>
                <PxLine aria-label="px">x</PxLine>
            </Probe>,
        );

        expect(styleOf('px').lineHeight).toBe('24px');
    });

    it('passes a bare-number line height through unitless, so it is a ratio of the font size', () => {
        render(
            <Probe>
                <Text aria-label="ratio" fontSize={16} lineHeight={1.5}>
                    x
                </Text>
            </Probe>,
        );

        expect(styleOf('ratio').lineHeight).toBe('1.5');
    });

    it('reads a number line height inside the style prop as a ratio too, not as pixels', () => {
        render(
            <Probe>
                <Text aria-label="style" fontSize={16} style={{ lineHeight: 24 }}>
                    x
                </Text>
            </Probe>,
        );

        expect(styleOf('style').lineHeight).toBe('24');
    });

    it('emits a theme token as a CSS variable, which this lane cannot resolve to a colour', () => {
        render(
            <Probe>
                <Paper aria-label="paper" />
            </Probe>,
        );

        expect(styleOf('paper').backgroundColor).toBe('var(--paper)');
    });

    it('applies a variant style', () => {
        render(
            <Probe>
                <Busy aria-label="busy" busy />
            </Probe>,
        );

        expect(styleOf('busy').opacity).toBe('0.4');
    });

    it('gives flex={1} a flexShrink of 0 under styleCompat react-native (Yoga, not CSS)', () => {
        render(
            <Probe>
                <XStack aria-label="flex" flex={1} />
            </Probe>,
        );

        expect(styleOf('flex').flexShrink).toBe('0');
    });
    // PressScale's port (BLUEPRINT 2026-11-01, option a): a design-system frame lends its layout to React Native's Pressable
    // through `asChild`, and on native Tamagui's Slot clones the Pressable with the merged style. THIS lane cannot show
    // that: the web build wraps the Pressable in a `display: contents` span and react-native-web's Pressable ignores the
    // class, so the frame's style never reaches it. A device is the evidence for the merge; if an upgrade changes this
    // row, the merge can be asserted here instead.
    it('does not merge an asChild frame’s style onto a react-native-web Pressable', () => {
        render(
            <Probe>
                <Frame asChild>
                    <Pressable aria-label="press" role="button">
                        <Text>Go</Text>
                    </Pressable>
                </Frame>
            </Probe>,
        );

        expect(styleOf('press').paddingTop).toBe('0px');
        expect(screen.getByLabelText('press').parentElement?.className ?? '').toContain('_dsp_contents');
    });

    // And nothing of the frame's own props reaches that span: Tamagui writes their rules (`._as-…`, `._tsx-…`) to the
    // stylesheet but puts none of the classes on the span or the Pressable. So this lane cannot see a scale or a
    // stretch an asChild frame lends its child; only a device can.
    it('puts none of an asChild frame’s own classes on the wrapper span', () => {
        render(
            <Probe>
                <View alignSelf="stretch" asChild scale={0.98}>
                    <Pressable aria-label="press" role="button">
                        <Text>Go</Text>
                    </Pressable>
                </View>
            </Probe>,
        );

        const press = screen.getByLabelText('press');
        const span = press.parentElement as HTMLElement;

        expect(span.className.trim()).toBe('_dsp_contents');
        expect(getComputedStyle(span).transform).toBe('none');
        expect(getComputedStyle(press).alignSelf).not.toBe('stretch');
    });
});
