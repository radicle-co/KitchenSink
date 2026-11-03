/**
 * The field label's touch target (Android QA, batch 7, 2026-11-03): pressing a label focuses its field, and the label's
 * `Pressable` drew only the label's own line (uiautomator: Title and Description, 379 x 20.2 dp at 1.0 and 379 x 40 at 2.0).
 * The label carries a vertical `hitSlop` that makes up the difference to the touch floor, with no change to what is drawn.
 * The field itself is the bordered input, so a tap on its padding already lands on the input and needs no slop.
 * react-native-web drops `hitSlop`, so the test reads the prop the label's `Pressable` receives.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { PressableProps } from 'react-native';

import { touchFloor } from '../../layout/touchFloor.native.js';
import { withPlatformOs } from '../../testing/platformOs.native.js';
import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { scaledLeading } from '../../text/scaledType.js';
import { FieldLabel } from '../FieldLabel.native.js';

const pressables = vi.hoisted(() => ({ seen: [] as PressableProps[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Pressable: (props: PressableProps) => {
            pressables.seen.push(props);

            return createElement(actual.Pressable, props);
        },
    };
});

afterEach(() => {
    cleanup();
    pressables.seen.length = 0;
});

describe('FieldLabel (native) — touch target', () => {
    it.each([
        ['ios', 1],
        ['android', 1],
        ['ios', 2],
        ['android', 2],
    ] as const)('reaches the touch floor with the label line and its hit slop on %s at %sx', (os, scale) => {
        withPlatformOs(os, () => {
            renderWithTamagui(<FieldLabel forId="title" label="Title" />, 'light', scale);

            const press = pressables.seen.at(-1);
            const edges = typeof press?.hitSlop === 'object' && press.hitSlop !== null ? press.hitSlop : {};
            const drawn = scaledLeading('label', scale);

            expect(drawn + (edges.top ?? 0) + (edges.bottom ?? 0)).toBeGreaterThanOrEqual(touchFloor());
        });
    });
});
