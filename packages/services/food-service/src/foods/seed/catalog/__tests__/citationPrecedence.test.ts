/**
 * `chooseCitation` (plan KTD-22, R50): the one policy that picks a root's cited dataset from its candidates.
 *
 * A Branded product or a label is the fallback. An exact, same-substance or close table entry displaces it, but only
 * when it states energy or the fallback does not, so a citation never trades calories for a better name. A generic
 * table entry never displaces it. Within a pool, match quality decides, then energy, then the dataset order. Two
 * candidates that rank equally are a tie the policy refuses to break, so file order never decides.
 */
import { describe, expect, it } from 'vitest';

import { CITATION_MATCHES, chooseCitation, type CitationCandidate } from '../citationPrecedence.js';

/** A candidate with energy, in the given dataset and tier. */
function candidate(overrides: Partial<CitationCandidate> = {}): CitationCandidate {
    return { dataset: 'ciqual', key: '1', match: 'exact', hasEnergy: true, ...overrides };
}

/**
 * The candidate a choice picked.
 *
 * @param candidates - The candidates.
 * @returns The chosen one, or the kind of the choice when none was chosen.
 */
function chosen(candidates: readonly CitationCandidate[]): CitationCandidate | string {
    const choice = chooseCitation(candidates);

    return choice.kind === 'chosen' ? choice.candidate : choice.kind;
}

describe('CITATION_MATCHES', () => {
    it('names the four match qualities, best first', () => {
        expect(CITATION_MATCHES).toEqual(['exact', 'sameSubstance', 'close', 'generic']);
    });
});

describe('chooseCitation', () => {
    it('has no citation for a root with no candidates', () => {
        expect(chooseCitation([])).toEqual({ kind: 'none' });
    });

    it('takes the earlier dataset when two candidates share a tier, in either order', () => {
        const fndds = candidate({ dataset: 'usdaFndds', key: 'fdc:2710705' });

        expect(chosen([candidate(), fndds])).toBe(fndds);
        expect(chosen([fndds, candidate()])).toBe(fndds);
    });

    it('ranks a same-substance USDA stand-in with an exact match, ahead of every table', () => {
        const standIn = candidate({ dataset: 'usdaSrFoundation', key: 'fdc:171326', match: 'sameSubstance' });

        expect(chosen([candidate({ dataset: 'usdaFndds' }), standIn])).toBe(standIn);
    });

    it('takes a better match from a later dataset over a worse match from an earlier one', () => {
        const exactSweden = candidate({ dataset: 'livsmedelsverket', match: 'exact' });

        expect(chosen([candidate({ dataset: 'usdaFndds', match: 'close' }), exactSweden])).toBe(exactSweden);
    });

    it('takes a candidate with energy over an earlier dataset without it, in the same tier', () => {
        const withEnergy = candidate({ dataset: 'cofid', hasEnergy: true });

        expect(chosen([candidate({ dataset: 'ciqual', hasEnergy: false }), withEnergy])).toBe(withEnergy);
    });

    it('lets an exact or close table entry with energy displace a Branded product', () => {
        const close = candidate({ dataset: 'bls', match: 'close' });

        expect(chosen([candidate({ dataset: 'usdaBranded', key: 'fdc:2096555' }), close])).toBe(close);
    });

    it('never lets a table entry with no energy displace a Branded product or a label that states energy', () => {
        const branded = candidate({ dataset: 'usdaBranded', key: 'fdc:2096555' });
        const label = candidate({ dataset: 'label', key: 'https://example.com/label' });
        const noEnergy = candidate({ dataset: 'ciqual', match: 'exact', hasEnergy: false });

        expect(chosen([noEnergy, branded])).toBe(branded);
        expect(chosen([noEnergy, label])).toBe(label);
    });

    it('still prefers an exact table entry to a Branded product when neither states energy', () => {
        const table = candidate({ dataset: 'ciqual', hasEnergy: false });

        expect(chosen([candidate({ dataset: 'usdaBranded', key: 'fdc:1', hasEnergy: false }), table])).toBe(table);
    });

    it('never lets a generic table entry displace a Branded product or a label, even one with no energy', () => {
        const branded = candidate({ dataset: 'usdaBranded', key: 'fdc:2096555', hasEnergy: false });
        const label = candidate({ dataset: 'label', key: 'https://example.com/label' });
        const generic = candidate({ dataset: 'usdaFndds', match: 'generic' });

        expect(chosen([generic, branded])).toBe(branded);
        expect(chosen([generic, label])).toBe(label);
    });

    it('takes a generic table entry when nothing better exists, because some numbers beat none', () => {
        const generic = candidate({ dataset: 'usdaFndds', match: 'generic' });

        expect(chosen([generic])).toBe(generic);
    });

    it('takes a Branded product before a label', () => {
        const branded = candidate({ dataset: 'usdaBranded', key: 'fdc:2096555' });

        expect(chosen([candidate({ dataset: 'label', key: 'https://example.com' }), branded])).toBe(branded);
    });

    it('reports a tie between the top two when they rank equally, whatever their order', () => {
        const first = candidate({ key: '2076' });
        const second = candidate({ key: '2077' });

        expect(chooseCitation([first, second])).toEqual({ kind: 'tie', candidates: [first, second] });
        expect(chooseCitation([second, first, candidate({ dataset: 'cnf' })])).toEqual({
            kind: 'tie',
            candidates: [second, first],
        });
    });

    it('ignores an equal pair below the top candidate', () => {
        const top = candidate({ dataset: 'usdaFndds', key: 'fdc:1' });

        expect(chosen([candidate({ key: '2076' }), top, candidate({ key: '2077' })])).toBe(top);
    });
});
