/**
 * A pressed native `MatchClosedRow` takes the press fill of the surface it sits on (`componentFixes.md` §10a).

 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so once the row is on screen `Pressable`
 * is stood in for by one that renders its `pressed` branch; everything above it is the real code.
 */
import { themeFor } from '@commise/ui/theme';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createElement } from 'react';
import type { Pressable as PressableType } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Surface } from '@commise/ui/surface-tone';

import { makeNeedsChoiceLine } from '../__fixtures__/matchLines.js';
import { MatchClosedRow } from '../MatchClosedRow.native.js';
import { lineRowOf } from '../matchLineView.js';
import { recipeMessages } from '../../messages.js';
import { matchLineMessages } from '../messages.js';

const press = vi.hoisted(() => ({ pressed: false }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = withSystemScheme(await importOriginal<typeof import('react-native')>());

    return {
        ...actual,
        Pressable: (props: ComponentProps<typeof PressableType>) =>
            press.pressed
                ? createElement(
                      actual.View,
                      {
                          role: (props.role ?? props.accessibilityRole) as never,
                          'aria-label': props['aria-label'] ?? props.accessibilityLabel,
                          style: typeof props.style === 'function' ? props.style({ pressed: true }) : props.style,
                      },
                      props.children as never,
                  )
                : createElement(actual.Pressable, props),
    };
});

afterEach(() => {
    cleanup();
    press.pressed = false;
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('a pressed MatchClosedRow in the %s theme', (scheme) => {
    it.each(['canvas', 'paper'] as const)('on a %s surface presses to that surface’s press fill', (tone) => {
        systemScheme.current = scheme;
        press.pressed = true;
        const row = lineRowOf(
            makeNeedsChoiceLine({}),
            { expanded: false, current: false, online: true, pending: undefined, failed: false },
            { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails },
            'en',
        );

        if (row.kind !== 'closed') {
            throw new Error(`expected a closed row, got ${row.kind}`);
        }

        render(
            <Surface tone={tone}>
                <MatchClosedRow
                    line={row.line}
                    need={row.need}
                    current={false}
                    refusing={false}
                    failure={undefined}
                    onOpen={vi.fn()}
                />
            </Surface>,
        );
        const fill = getComputedStyle(screen.getByRole('button')).backgroundColor;

        expect(fill).toBe(rgb(themeFor(scheme).press[tone]));
        expect(fill).not.toBe(rgb(rolesFor(scheme).surfaceMuted));
    });
});
