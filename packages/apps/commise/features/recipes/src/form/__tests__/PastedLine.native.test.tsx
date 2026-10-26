/**
 * Component tests for the native `PastedLine` (through react-native-web): the line as the cook wrote it, measure first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PastedLine } from '../PastedLine.native.js';

afterEach(cleanup);

describe('PastedLine (native)', () => {
    it('reads as the whole line, measure first', () => {
        const { container } = render(<PastedLine line={{ measure: '2 cups', words: 'milk' }} />);

        expect(container.textContent).toBe('2 cups milk');
        expect(screen.getByText('2 cups')).toBeTruthy();
    });

    it('a line with no measure is its words alone, with no leading space', () => {
        const { container } = render(<PastedLine line={{ measure: '', words: 'eggs' }} />);

        expect(container.textContent).toBe('eggs');
    });
});
