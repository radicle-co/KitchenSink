/**
 * Component tests for the native `MatchLineText` (through react-native-web): the line as the cook wrote it, measure
 * first. Renamed from the editor builder's `PastedLine` when both flows came to draw it; the list-role case is new.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { nativeTokens } from '@commise/ui/native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { MatchLineText } from '../MatchLineText.native.js';

afterEach(cleanup);

describe('MatchLineText (native)', () => {
    it('reads as the whole line, measure first', () => {
        const { container } = render(<MatchLineText line={{ measure: '2 cups', words: 'milk' }} />);

        expect(container.textContent).toBe('2 cups milk');
        expect(screen.getByText('2 cups')).toBeTruthy();
    });

    it('a line with no measure is its words alone, with no leading space', () => {
        const { container } = render(<MatchLineText line={{ measure: '', words: 'eggs' }} />);

        expect(container.textContent).toBe('eggs');
    });

    // REWRITTEN for the owner's type-scale ruling (2026-10-25): the cook's line is 16 px body, the same as the reading
    // phase's `PastedReadingRow`, and everything under it is 14; it was the 13 px list role.
    it('is set in the 16 px body role, as the reading phase sets the same line', () => {
        const { container } = render(<MatchLineText line={{ measure: '2 cups', words: 'milk' }} />);
        const line = container.firstElementChild;

        expect(line === null ? undefined : getComputedStyle(line).fontSize).toBe(
            `${String(nativeTokens.type.body.fontSize)}px`,
        );
        expect(nativeTokens.type.body.fontSize).toBe(16);
    });
});
