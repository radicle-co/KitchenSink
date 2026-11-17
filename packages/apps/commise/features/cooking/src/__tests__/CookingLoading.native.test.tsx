/**
 * The native loading body: nothing for the first 300 ms, then three line-shaped blocks that
 * hold the step's space, hidden from assistive tech, then the "Opening the recipe…" notice as well. The timing lives in
 * the screen (`loadingPhase`); this leaf draws the phase it is handed.
 *
 * Props are the shared contract's (`cookingViewProps.ts`). Both old cases are kept, rewritten from an
 * optional `label` to the `phase`; the blank phase is new.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CookingLoading } from '../CookingLoading.native.js';

afterEach(cleanup);

const LABEL = 'Opening the recipe…';

describe('CookingLoading (native)', () => {
    it('draws nothing at all in the blank phase, so a quick read never flashes a skeleton', () => {
        render(<CookingLoading phase="blank" label={LABEL} />);

        expect(screen.queryByTestId('cooking-loading-skeleton')).toBeNull();
        expect(screen.queryByText(LABEL)).toBeNull();
    });

    it('holds the step’s space with three blocks hidden from assistive tech', () => {
        render(<CookingLoading phase="skeleton" label={LABEL} />);

        const skeleton = screen.getByTestId('cooking-loading-skeleton');

        expect(skeleton.getAttribute('aria-hidden')).toBe('true');
        expect(skeleton.children).toHaveLength(3);
        expect(screen.queryByText(LABEL)).toBeNull();
    });

    it('says what is loading in the label phase, keeping the blocks', () => {
        render(<CookingLoading phase="label" label={LABEL} />);

        expect(screen.getByText(LABEL)).toBeTruthy();
        expect(screen.getByTestId('cooking-loading-skeleton').children).toHaveLength(3);
    });
});
