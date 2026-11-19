/**
 * RadioList (native) — what VoiceOver and TalkBack receive, and how a row answers a press (review finding m3).
 *
 * react-native-web drops `accessibilityHint` from the DOM, so the sibling suite cannot see it. This suite stands in for
 * `Pressable` and reads the props each row hands it, the way `FieldAccessibility.native.test.tsx` reads a text input's.
 *
 * - A row's name is its label and its hint is the platform's `accessibilityHint`, read after the name, as the web leaf's
 *   `aria-describedby` is. A hint drawn inside the row and left to be read as part of its name would be said as the
 *   name.
 * - A pressed row takes the theme's press wash, as `ChipRow` does, so a touch is seen to land.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import type {
    Pressable as PressableType,
    PressableStateCallbackType,
    StyleProp,
    ViewProps,
    ViewStyle,
} from 'react-native';
import { StyleSheet } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { themeFor } from '../../theme/themeFor.js';
import type { RadioListOption } from '../props.js';

type PressableProps = ComponentProps<typeof PressableType>;

const seen = vi.hoisted(() => ({ rows: [] as PressableProps[], groups: [] as ViewProps[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        // The group is the only `View` drawn: a row is a stand-in that draws nothing.
        View: (props: ViewProps & { readonly children?: ReactNode }) => {
            seen.groups.push(props);

            return props.children;
        },
        Pressable: (props: PressableProps & { readonly children?: ReactNode }) => {
            seen.rows.push(props);

            return null;
        },
    };
});

// Imported after the mock, so its `Pressable` is the stand-in.
const { RadioList } = await import('../RadioList.native.js');

afterEach(() => {
    cleanup();
    seen.rows = [];
    seen.groups = [];
});

const OPTIONS: readonly RadioListOption[] = [
    { id: 'best', label: 'Pick the best match for me' },
    { id: 'saveAsWritten', label: 'Save lines as written', hint: 'Every other line is saved as written.' },
];

/** The style a row draws in a given press state. */
function styleOf(row: PressableProps | undefined, pressed: boolean): ViewStyle {
    const style = row?.style;
    const resolved: StyleProp<ViewStyle> =
        typeof style === 'function' ? style({ pressed, hovered: false } as PressableStateCallbackType) : style;

    return StyleSheet.flatten(resolved);
}

// REWRITTEN (U13, 2026-10-25): no longer run per look; the `rows` look was deleted, and the card list is the only one.
describe('RadioList (native) — what the screen reader receives', () => {
    it('names each row by its label, and hands its hint to the platform as the accessibility hint', () => {
        render(<RadioList label="How to match" options={OPTIONS} value={undefined} onChange={vi.fn()} />);

        expect(seen.rows.map((row) => [row.accessibilityLabel, row.accessibilityHint])).toEqual([
            ['Pick the best match for me', undefined],
            ['Save lines as written', 'Every other line is saved as written.'],
        ]);
    });

    // The platform's own role and state, as React Native maps them: Android names the container "radio group"
    // (`ReactAccessibilityDelegate`) and every row reads "radio button" with its checked state on both platforms. React Native has
    // no API that makes a container that is not itself an element a VoiceOver group, so iOS gets the rows' role and state and
    // the group's label for the platforms that read it (review item 11).
    it('is one radio group of radios, each stating whether it is checked and whether it is disabled', () => {
        render(<RadioList label="How to match" options={OPTIONS} value="saveAsWritten" onChange={vi.fn()} disabled />);

        expect(seen.groups[0]).toMatchObject({ role: 'radiogroup', 'aria-label': 'How to match' });
        expect(seen.rows.map((row) => [row.role, row['aria-checked'], row['aria-disabled']])).toEqual([
            ['radio', false, true],
            ['radio', true, true],
        ]);
    });

    it('a pressed row takes its surface’s press fill (the canvas row here); a row at rest does not', () => {
        render(<RadioList label="How to match" options={OPTIONS} value={undefined} onChange={vi.fn()} />);

        const wash = themeFor('light').press.canvas;

        expect(styleOf(seen.rows[0], true).backgroundColor).toBe(wash);
        expect(styleOf(seen.rows[0], false).backgroundColor).not.toBe(wash);
    });
});
