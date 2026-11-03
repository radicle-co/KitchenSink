import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { META_SEPARATOR, metaRunOf, unbreakable } from '../metaRun.js';

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
    it('joins the parts that exist with the separator, and no separator at either end', () => {
        expect(textOf(metaRunOf(['45 min', 'Easy', 'No ratings yet']))).toBe(
            '45\u00A0min\u2060\u00A0\u2060· Easy\u2060\u00A0\u2060· No\u00A0ratings\u00A0yet',
        );
    });

    it('leaves out an absent part together with its separator', () => {
        expect(textOf(metaRunOf(['45 min', undefined, null, false, 'No ratings yet']))).toBe(
            '45\u00A0min\u2060\u00A0\u2060· No\u00A0ratings\u00A0yet',
        );
        expect(textOf(metaRunOf([undefined, 'Easy']))).toBe('Easy');
    });

    it('draws nothing when no part has data', () => {
        expect(metaRunOf([])).toEqual([]);
        expect(metaRunOf([undefined, null, false, ''])).toEqual([]);
    });

    it('keeps a nested node whole, keyed, and never turns it into a string', () => {
        const star = <b key="x">★ 4.8 (12)</b>;
        const run = metaRunOf(['45 min', star]);

        expect(textOf(run)).toBe('45\u00A0min\u2060\u00A0\u2060· ★ 4.8 (12)');
        expect(run.some((part) => isValidElement(part))).toBe(true);
    });
});

// UI Designer ruling (2026-11-03): each part is unbreakable inside, so the line breaks only after a dot.
describe('unbreakable — no break inside a part', () => {
    it('turns every ordinary space into a no-break space', () => {
        expect(unbreakable('45 min')).toBe('45\u00A0min');
        expect(unbreakable('★ 4.8 (12)')).toBe('★\u00A04.8\u00A0(12)');
        expect(unbreakable('No ratings yet')).toBe('No\u00A0ratings\u00A0yet');
    });

    it('is applied to every string part of a run, and leaves the separator’s own space after the dot', () => {
        expect(metaRunOf(['45 min', 'No ratings yet'])).toEqual([
            '45\u00A0min',
            META_SEPARATOR,
            'No\u00A0ratings\u00A0yet',
        ]);
    });
});

// qa-ios on 087051a43 (UI Designer ruling 2026-11-03): the dot must never start a line, even when a part is wider than the line
// and the platform has to break inside a no-break chain. A word joiner on each side of the no-break space keeps the dot with
// the word before it.
describe('META_SEPARATOR — the dot stays with the word before it', () => {
    it('is a no-break space between two word joiners, then the dot and an ordinary space', () => {
        expect(META_SEPARATOR).toBe('\u2060\u00A0\u2060· ');
    });

    it('has exactly one break opportunity: the space after the dot', () => {
        expect([...META_SEPARATOR.matchAll(/ /gu)]).toHaveLength(1);
        expect(META_SEPARATOR.endsWith('· ')).toBe(true);
    });
});
