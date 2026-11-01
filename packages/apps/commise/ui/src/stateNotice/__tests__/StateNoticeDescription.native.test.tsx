/**
 * StateNotice (native) — the body is Try again's description, as the accessibility hint a device receives
 * (`componentFixes.md` §1). Stands in for `Pressable`; react-native-web would project a hint to nothing.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ buttons: [] as Record<string, unknown>[] }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');

    return {
        ...actual,
        Pressable: (props: Record<string, unknown>) => {
            seen.buttons.push(props);

            return createElement(actual.View, null, props['children'] as never);
        },
    };
});

import { render } from '../../testing/tamaguiTesting.native.js';
import { StateNotice } from '../StateNotice.native.js';

afterEach(() => {
    cleanup();
    seen.buttons = [];
});

describe('StateNotice (native) — description', () => {
    it('hints the first action with the body, and the way out with nothing', () => {
        render(
            <StateNotice
                title="Failed."
                body="Check your connection."
                primary={{ label: 'Try again', icon: 'refreshCw', onPress: vi.fn() }}
                secondary={{ label: 'Back to Home', icon: 'house', onPress: vi.fn() }}
            />,
        );
        const byName = (name: string) => seen.buttons.find((props) => props['accessibilityLabel'] === name);

        expect(byName('Try again')?.['accessibilityHint']).toBe('Check your connection.');
        expect(byName('Back to Home')?.['accessibilityHint']).toBeUndefined();
    });
});
