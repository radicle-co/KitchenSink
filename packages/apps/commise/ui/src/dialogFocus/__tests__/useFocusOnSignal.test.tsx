import { cleanup, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFocusOnSignal } from '../useFocusOnSignal.js';

afterEach(cleanup);

const Surface: FC<{ readonly signal: number }> = ({ signal }) => {
    const ref = useFocusOnSignal<HTMLHeadingElement>(signal);

    return (
        <>
            <h1 ref={ref} tabIndex={-1}>
                Your recipes
            </h1>
            <input aria-label="Search" />
        </>
    );
};

describe('useFocusOnSignal (web)', () => {
    it('does not move focus on mount, whatever the signal already is', () => {
        render(<Surface signal={3} />);

        expect(document.activeElement).toBe(document.body);
    });

    it('⛔ moves focus onto the attached node when the signal CHANGES and focus was lost', () => {
        const { rerender } = render(<Surface signal={0} />);

        rerender(<Surface signal={1} />);

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your recipes' }));
    });

    it('does not move it again on a re-render with the same signal', () => {
        const { rerender } = render(<Surface signal={0} />);
        rerender(<Surface signal={1} />);
        const search = screen.getByRole('textbox', { name: 'Search' });
        search.focus();

        rerender(<Surface signal={1} />);

        expect(document.activeElement).toBe(search);
    });

    it('⛔ never takes focus from where the person put it', () => {
        const { rerender } = render(<Surface signal={0} />);
        const search = screen.getByRole('textbox', { name: 'Search' });
        search.focus();

        rerender(<Surface signal={1} />);

        expect(document.activeElement).toBe(search);
    });
});
