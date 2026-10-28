/**
 * The native read-only Profile row: a label and a value the cook cannot change here. It is one accessibility element,
 * so a screen reader reads "Email, eliza@example.com" in a single swipe instead of two stops. A long unbroken value
 * shrinks and wraps rather than running off a 320 pt screen. This restores the "unbroken email wraps at 320" case that
 * lived in the ProfileHeader suite until the email moved into this row.
 *
 * ⚠️ react-native-web drops RN's `accessible` prop and gives every `Text` a default `flex-shrink: 1` that React Native
 * does not (its default is 0), so `View` and `Text` are wrapped to put what React Native receives on the node:
 * `data-accessible`, and `data-flex-shrink` (react-native-web's `dataSet`) from the flattened style. What is proven is the props React Native gets, not
 * that a screen reader honours them.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement, forwardRef, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const View = forwardRef<unknown, ComponentProps<typeof actual.View>>((props, ref) =>
        createElement(actual.View, {
            ...props,
            ref,
            ...(props.accessible === true ? { dataSet: { accessible: 'true' } } : {}),
        } as never),
    );
    const Text = forwardRef<unknown, ComponentProps<typeof actual.Text>>((props, ref) => {
        const { flexShrink } = actual.StyleSheet.flatten(props.style) ?? {};

        return createElement(actual.Text, {
            ...props,
            ref,
            ...(flexShrink === undefined ? {} : { dataSet: { flexShrink: String(flexShrink) } }),
        } as never);
    });

    return { ...actual, View, Text };
});

import { ProfileFactRow } from '../ProfileFactRow.native.js';

afterEach(cleanup);

describe('ProfileFactRow (native)', () => {
    it('shows the label and the value', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('eliza@example.com')).toBeTruthy();
    });

    it('is plain text: no button', () => {
        render(<ProfileFactRow label="Email" value="eliza@example.com" />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('is ONE accessibility element holding both the label and the value', () => {
        const { container } = render(<ProfileFactRow label="Email" value="eliza@example.com" />);
        const unit = container.querySelector('[data-accessible="true"]');

        expect(unit).not.toBeNull();
        expect(unit?.textContent).toBe('Emaileliza@example.com');
    });

    it('lets a long unbroken value shrink and wrap instead of running off a 320 pt screen', () => {
        const email = `${'a'.repeat(60)}@example.com`;
        render(<ProfileFactRow label="Email" value={email} />);

        // The value takes the room the label leaves; the label keeps its width.
        expect(screen.getByText(email).getAttribute('data-flex-shrink')).toBe('1');
        expect(screen.getByText('Email').getAttribute('data-flex-shrink')).toBeNull();
    });
});
