/**
 * `AmountText` (web): a text that shows amounts, with the fraction characters hidden from a screen reader and the
 * words beside them (UI Designer ruling Q5). Text with no fraction and no range renders exactly as it was.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AmountText } from '../AmountText.js';

afterEach(cleanup);

describe('AmountText', () => {
    it('shows the fraction to the eye and says it in words', () => {
        const { container } = render(<AmountText text={'1½\u00A0cups whole milk'} />);
        const hidden = container.querySelector('[aria-hidden="true"]');
        const spoken = container.querySelector('.sr-only');

        expect(hidden?.textContent).toBe('1½\u00A0cups whole milk');
        expect(spoken?.textContent).toBe('1 and a half cups whole milk');
    });

    it('says a range with the range words', () => {
        const { container } = render(<AmountText text={'¾–1\u00A0tsp salt'} />);

        expect(container.querySelector('.sr-only')?.textContent).toBe('three quarters to 1 tsp salt');
    });

    it('renders a text with nothing to say differently as plain text, a no-break space included', () => {
        const { container } = render(<AmountText text={'2\u00A0tbsp olive oil'} />);

        expect(container.innerHTML).toBe('2&nbsp;tbsp olive oil');
    });
});
