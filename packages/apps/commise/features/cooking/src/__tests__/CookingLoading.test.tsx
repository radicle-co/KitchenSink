import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CookingLoading } from '../CookingLoading.js';
import { htmlElementOf } from '../__fixtures__/htmlElementOf.js';

/** The loading body: blank, then a skeleton, then its label too. */
describe('CookingLoading', () => {
    it('shows nothing in the first phase', () => {
        const { container } = render(<CookingLoading phase="blank" label="Opening the recipe…" />);

        expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(0);
        expect(screen.queryByText('Opening the recipe…')).toBeNull();
    });

    it('shows a three-line skeleton, hidden from assistive technology, with no label yet', () => {
        const { container } = render(<CookingLoading phase="skeleton" label="Opening the recipe…" />);

        const lines = container.querySelectorAll('[data-skeleton-line]');
        expect(lines).toHaveLength(3);

        for (const element of lines) {
            expect(element.closest('[aria-hidden="true"]')).not.toBeNull();
        }

        expect(screen.queryByText('Opening the recipe…')).toBeNull();
    });

    it('adds the label as a status in the last phase, beside the skeleton', () => {
        const { container } = render(<CookingLoading phase="label" label="Opening the recipe…" />);

        expect(container.querySelectorAll('[data-skeleton-line]')).toHaveLength(3);
        expect(screen.getByRole('status').textContent).toContain('Opening the recipe…');
    });

    it('reserves the same height in every phase, so nothing shifts when the data arrives', () => {
        const blank = render(<CookingLoading phase="blank" label="Opening the recipe…" />);
        const blankClass = htmlElementOf(blank.container.firstElementChild).className;
        blank.unmount();

        const label = render(<CookingLoading phase="label" label="Opening the recipe…" />);

        expect(htmlElementOf(label.container.firstElementChild).className).toBe(blankClass);
    });
});
