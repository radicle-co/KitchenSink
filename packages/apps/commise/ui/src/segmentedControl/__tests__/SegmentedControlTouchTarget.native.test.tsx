/**
 * The segments' touch target (Android QA, 2026-11-03): the track is 48 dp tall but pads each segment by `TRACK_INSET`,
 * so a segment drew and hit only 40 dp (uiautomator: 184 x 40). A segment carries a vertical `hitSlop` of the inset, so
 * its target spans the track and reaches the touch floor. The segment is an `Elevated` (a Tamagui `View`), and
 * react-native-web drops `hitSlop`, so the test reads the prop the segment's `Elevated` receives. It cannot see
 * Tamagui hand the prop to the native view: the Android and iOS device pass checks that band.
 */
import { createElement, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

import { withPlatformOs } from '../../testing/platformOs.native.js';
import { render } from '../../testing/tamaguiTesting.native.js';
import type { Elevated } from '../../elevation/Elevated.native.js';
import { touchFloor } from '../../layout/touchFloor.native.js';
import { SegmentedControl } from '../SegmentedControl.native.js';
import { TRACK_INSET } from '../nativeSegmentGeometry.js';

type SegmentProps = ComponentProps<typeof Elevated>;

const pressables = vi.hoisted(() => ({ seen: [] as SegmentProps[] }));

vi.mock('../../elevation/Elevated.native.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../elevation/Elevated.native.js')>();

    return {
        ...actual,
        Elevated: (props: SegmentProps) => {
            pressables.seen.push(props);

            return createElement(actual.Elevated, props);
        },
    };
});

afterEach(() => {
    cleanup();
    pressables.seen.length = 0;
});

const PLACES = [
    { id: 'mine', label: 'My recipes' },
    { id: 'collections', label: 'Collections' },
] as const;

describe('SegmentedControl (native) — touch target', () => {
    it.each(['ios', 'android'] as const)('gives every segment a target of the touch floor on %s', (os) => {
        withPlatformOs(os, () => {
            render(
                <SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />,
            );

            const segments = pressables.seen.filter((props) => props.role === 'tab');

            const slop = (props: SegmentProps): { top: number; bottom: number } => {
                const edges = props.hitSlop;

                return typeof edges === 'object' && edges !== null
                    ? { top: edges.top ?? 0, bottom: edges.bottom ?? 0 }
                    : { top: 0, bottom: 0 };
            };

            expect(segments).toHaveLength(2);

            for (const segment of segments) {
                const drawn = touchFloor() - 2 * TRACK_INSET;

                expect(drawn + slop(segment).top + slop(segment).bottom).toBeGreaterThanOrEqual(touchFloor());
            }
        });
    });
});
