import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { META_SEPARATOR, metaRunOf } from '../metaRun.js';

/** The text a run reads as, with each nested node's own children folded in. */
const textOf = (run: readonly ReactNode[]): string =>
    run
        .map((part) =>
            isValidElement<{ readonly children?: ReactNode }>(part)
                ? textOf([part.props.children])
                : typeof part === 'string'
                  ? part
                  : '',
        )
        .join('');

// UI Designer ruling (2026-11-03, designAnswers.md): the meta line is ONE run of text, "45 min · Easy · No ratings yet ·
// 370 cal", with a no-break space before each "·" so a dot stays with the word before it and never starts a line.
describe('metaRunOf — the one shared builder of the meta line’s text run', () => {
    it('keeps a no-break space before the dot, and an ordinary space after it', () => {
        expect(META_SEPARATOR).toBe(' · ');
    });

    it('joins the parts that exist with the separator, and no separator at either end', () => {
        expect(textOf(metaRunOf(['45 min', 'Easy', 'No ratings yet']))).toBe('45 min · Easy · No ratings yet');
    });

    it('leaves out an absent part together with its separator', () => {
        expect(textOf(metaRunOf(['45 min', undefined, null, false, 'No ratings yet']))).toBe('45 min · No ratings yet');
        expect(textOf(metaRunOf([undefined, 'Easy']))).toBe('Easy');
    });

    it('draws nothing when no part has data', () => {
        expect(metaRunOf([])).toEqual([]);
        expect(metaRunOf([undefined, null, false, ''])).toEqual([]);
    });

    it('keeps a nested node whole, keyed, and never turns it into a string', () => {
        const star = <b key="x">★ 4.8 (12)</b>;
        const run = metaRunOf(['45 min', star]);

        expect(textOf(run)).toBe('45 min · ★ 4.8 (12)');
        expect(run.some((part) => isValidElement(part))).toBe(true);
    });
});
