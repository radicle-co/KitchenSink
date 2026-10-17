/**
 * `RouteAction` (specSharedSystem §15): a real link when it has an `href`, a button when it has none, so the props
 * cannot express an `<a>` with no `href` (not focusable, WCAG 2.1.1).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RouteAction } from '../RouteAction.js';

afterEach(cleanup);

describe('RouteAction', () => {
    it('hands a plain click to onPress and cancels the link’s own navigation', () => {
        const onPress = vi.fn();

        render(
            <RouteAction href="/en/x" onPress={onPress} className="c">
                Go
            </RouteAction>,
        );

        const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Go' }));

        expect(onPress).toHaveBeenCalledTimes(1);
        expect(notCancelled).toBe(false);
    });

    it.each([
        { name: 'meta', init: { metaKey: true } },
        { name: 'ctrl', init: { ctrlKey: true } },
        { name: 'shift', init: { shiftKey: true } },
        { name: 'alt', init: { altKey: true } },
        { name: 'middle button', init: { button: 1 } },
    ])('leaves a $name click to the browser: no onPress, navigation not cancelled', ({ init }) => {
        const onPress = vi.fn();

        render(
            <RouteAction href="/en/x" onPress={onPress} className="c">
                Go
            </RouteAction>,
        );

        const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Go' }), init);

        expect(onPress).not.toHaveBeenCalled();
        expect(notCancelled).toBe(true);
    });

    it('renders a button, never an href-less link, when there is no href', () => {
        const onPress = vi.fn();

        render(
            <RouteAction onPress={onPress} className="c">
                Go
            </RouteAction>,
        );

        expect(screen.queryByRole('link')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Go' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it.each([{ href: '/en/x' }, {}])('always renders a focusable element (%o)', (props) => {
        render(
            <RouteAction onPress={() => undefined} className="c" {...props}>
                Go
            </RouteAction>,
        );

        const control = screen.getByText('Go');

        expect(control.tagName === 'BUTTON' || control.getAttribute('href') !== null).toBe(true);
    });

    it('sets no aria-label without a label, and sets it with one', () => {
        const { rerender } = render(
            <RouteAction href="/x" onPress={() => undefined} className="c">
                Go
            </RouteAction>,
        );

        expect(screen.getByRole('link').hasAttribute('aria-label')).toBe(false);

        rerender(
            <RouteAction href="/x" label="Go there" onPress={() => undefined} className="c">
                Go
            </RouteAction>,
        );

        expect(screen.getByRole('link', { name: 'Go there' })).toBeTruthy();

        rerender(
            <RouteAction label="Go there" onPress={() => undefined} className="c">
                Go
            </RouteAction>,
        );

        expect(screen.getByRole('button', { name: 'Go there' })).toBeTruthy();
    });
});
