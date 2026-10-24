/**
 * Whether focus is inside a container, read from the bubbling focus events of its descendants (§S8.1: the toolbar
 * collapses only while focus is in it).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { describe, expect, it } from 'vitest';

import { useFocusWithin } from '../useFocusWithin.js';

const Probe: FC = () => {
    const { focusWithin, onFocus, onBlur } = useFocusWithin();

    return (
        <>
            <div onFocus={onFocus} onBlur={onBlur}>
                <input aria-label="inside" />
                <button type="button">also inside</button>
            </div>
            <button type="button">outside</button>
            <output aria-label="state">{String(focusWithin)}</output>
        </>
    );
};

describe('useFocusWithin', () => {
    it('is false until a descendant takes focus, and stays true while focus moves inside', () => {
        render(<Probe />);

        expect(screen.getByLabelText('state').textContent).toBe('false');

        fireEvent.focus(screen.getByLabelText('inside'));
        expect(screen.getByLabelText('state').textContent).toBe('true');

        fireEvent.blur(screen.getByLabelText('inside'), { relatedTarget: screen.getByText('also inside') });
        expect(screen.getByLabelText('state').textContent).toBe('true');
    });

    it('turns false when focus leaves the container', () => {
        render(<Probe />);

        fireEvent.focus(screen.getByLabelText('inside'));
        fireEvent.blur(screen.getByLabelText('inside'), { relatedTarget: screen.getByText('outside') });

        expect(screen.getByLabelText('state').textContent).toBe('false');
    });

    it('turns false when focus goes nowhere', () => {
        render(<Probe />);

        fireEvent.focus(screen.getByLabelText('inside'));
        fireEvent.blur(screen.getByLabelText('inside'));

        expect(screen.getByLabelText('state').textContent).toBe('false');
    });
});
