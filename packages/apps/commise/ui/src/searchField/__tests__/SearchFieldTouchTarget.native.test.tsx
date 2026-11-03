/**
 * The field's touch target (Android QA, 2026-11-03: the input measured 45 dp tall in a 48 dp pill). The pill's 1 pt border
 * sits outside the input, so a tap on it focuses nothing; the input carries a `hitSlop` of the border so its target is the
 * whole pill. react-native-web drops `hitSlop`, so the test reads the prop the input receives.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { TextInputProps } from 'react-native';

import { render } from '../../testing/tamaguiTesting.native.js';
import { touchFloor } from '../../layout/touchFloor.native.js';
import { withPlatformOs } from '../../testing/platformOs.native.js';
import { SearchField } from '../SearchField.native.js';

const inputs = vi.hoisted(() => ({ seen: [] as TextInputProps[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        TextInput: (props: TextInputProps) => {
            inputs.seen.push(props);

            return createElement(actual.TextInput, props);
        },
    };
});

afterEach(() => {
    cleanup();
    inputs.seen.length = 0;
});

describe('SearchField (native) — touch target', () => {
    it('reaches the touch floor with the input, its hit slop and the pill border', () => {
        withPlatformOs('android', () => {
            render(
                <SearchField
                    id="s"
                    label="Search recipes"
                    labelVisibility="hidden"
                    clearLabel="Clear"
                    value=""
                    onChangeText={vi.fn()}
                    placeholder="Search"
                />,
            );

            const input = inputs.seen[0];
            const edges = typeof input?.hitSlop === 'object' && input.hitSlop !== null ? input.hitSlop : {};
            const flat = Object.assign({}, ...[input?.style].flat(2)) as { minHeight?: number };

            expect((flat.minHeight ?? 0) + (edges.top ?? 0) + (edges.bottom ?? 0)).toBeGreaterThanOrEqual(touchFloor());
        });
    });
});
