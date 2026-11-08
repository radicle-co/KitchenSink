/**
 * Button (native) — the description a screen reader receives (`componentFixes.md` §1: the failure reason is the Try
 * again control's description, `accessibilityHint` on native).
 *
 * React Native 0.86 has no `aria-describedby`, and react-native-web would map a hint to nothing in the DOM, so a DOM
 * suite passes while a device does nothing. This suite stands in for `Pressable` and reads the props the leaf hands it,
 * as `StepperAccessibility.native.test.tsx` does.
 */
import { cleanup } from '@testing-library/react';
import { render } from '../../testing/tamaguiTesting.native.js';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

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

import { Button } from '../Button.native.js';

afterEach(() => {
    cleanup();
    seen.buttons = [];
});

describe('Button (native) — description', () => {
    it('hands the description to the pressable as its accessibility hint', () => {
        render(
            <Button variant="quiet" icon="refreshCw" description="We couldn’t load this recipe.">
                Try again
            </Button>,
        );

        expect(seen.buttons.at(-1)?.['accessibilityHint']).toBe('We couldn’t load this recipe.');
        expect(seen.buttons.at(-1)?.['accessibilityLabel']).toBe('Try again');
    });

    it('hands over no hint when there is no description', () => {
        render(<Button variant="quiet">Try again</Button>);

        expect(seen.buttons.at(-1)?.['accessibilityHint']).toBeUndefined();
    });
});
