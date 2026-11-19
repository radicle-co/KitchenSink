import { LARGE_TITLE_CLASS } from '@commise/ui/large-title-header';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CookingDone } from '../CookingDone.js';
import type { CookingDoneProps } from '../cookingViewProps.js';

/**
 * Done's body. Its two actions are pinned in the foot by
 * `CookingDoneActions`, so the body holds no control.
 */
function props(over: Partial<CookingDoneProps> = {}): CookingDoneProps {
    return {
        title: 'All 6 steps done',
        enjoy: 'Roast chicken. Enjoy it.',
        screenOff: 'The screen can turn off again.',
        ...over,
    };
}

describe('CookingDone', () => {
    it('makes the title the page’s h1, focusable by the host', () => {
        render(<CookingDone {...props()} />);

        const heading = screen.getByRole('heading', { level: 1, name: 'All 6 steps done' });

        expect(heading.getAttribute('tabindex')).toBe('-1');
        expect(heading.id).not.toBe('');
    });

    it('sets the title in the largeTitle role', () => {
        render(<CookingDone {...props()} />);

        const heading = screen.getByRole('heading', { level: 1, name: 'All 6 steps done' });

        for (const name of LARGE_TITLE_CLASS.split(' ')) {
            expect(heading.className.split(' ')).toContain(name);
        }
    });

    // D13 and the Done boards: Done reads from the left, like the step it came from. Centring it moves the h1 off the line
    // the "Enjoy it" text starts on.
    it('aligns its content to the start, never the centre', () => {
        render(<CookingDone {...props()} />);

        const section = screen.getByRole('heading', { level: 1 }).closest('section');
        const classes = section?.className.split(' ') ?? [];

        expect(classes).toContain('items-start');
        expect(classes).toContain('text-start');
        expect(classes).not.toContain('items-center');
        expect(classes).not.toContain('text-center');
    });

    it('holds no control: the actions are pinned in the foot', () => {
        render(<CookingDone {...props()} />);

        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('says the screen can turn off only when it was kept on', () => {
        const { rerender } = render(<CookingDone {...props()} />);
        expect(screen.getByText('The screen can turn off again.')).toBeTruthy();

        rerender(<CookingDone {...props({ screenOff: undefined })} />);
        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
        // No empty slot is left where the line was: only the enjoy line remains as body text.
        expect([...document.querySelectorAll('section p')].map((p) => p.textContent)).toEqual([
            'Roast chicken. Enjoy it.',
        ]);
    });
});
