// @vitest-environment jsdom
/**
 * The web paste row draws the line exactly as the cook pasted it (designer ruling 2026-11-06): a separator after the
 * measure is part of what they wrote ("2 cups, sifted" is not "2 cups sifted"), so it stays, attached to the measure.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { MatchLineText } from '../../ingredientMatching/MatchLineText.js';
import { JOINED_SESSION, makePasteJob, PASTED_LINES } from '../__fixtures__/pasteJob.js';
import { pasteMatchLinesOf } from '../pasteMatchLines.js';

afterEach(cleanup);

const lineOf = (raw: string, measure: string) =>
    (
        pasteMatchLinesOf({
            job: makePasteJob(raw, measure),
            session: JOINED_SESSION,
            optionsFailed: new Set(),
            reviewReasonOf: (reason) => reason,
        })[0] as { line: Parameters<typeof MatchLineText>[0]['line'] }
    ).line;

describe('a paste row (web) shows the pasted line', () => {
    it.each(PASTED_LINES)('%s: the visible text is the pasted line', (raw, measure) => {
        const { container } = render(<MatchLineText line={lineOf(raw, measure)} />);

        expect(container.textContent).toBe(raw);
    });

    it('keeps the separator in the bold measure', () => {
        render(<MatchLineText line={lineOf('2 cups, sifted flour', '2 cups')} />);

        expect(screen.getByText('2 cups,').className).toContain('font-semibold');
    });
});
