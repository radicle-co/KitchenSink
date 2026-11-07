/**
 * Unit tests for `nameProposalDraftsOf` — the policy that turns what the settled tiers remembered into the editor's
 * name proposals (ADR-0071 as amended: the add-by-name field PROPOSES what the tiers remember and never binds it).
 *
 * The properties that carry the requirement: every settled source becomes a proposal and none binds; the source key is
 * read from the tier's structured fields, never from its prose; a food two sources agree on appears once under the
 * STRONGEST source; and a tier the policy does not name (the ranked one) can never become a proposal here, so the
 * route stays two local reads.
 */
import { describe, expect, it } from 'vitest';

import type { FoodRef } from '../../../database/schema/foodLookupArm.js';
import type { TierOutcome } from '../../resolution/resolutionCascade.js';
import { nameProposalDraftsOf } from '../nameProposalPolicy.js';

const root = (id: string): FoodRef => ({ kind: 'root', id });

const curated = (
    food: FoodRef,
    mapping: { scope: 'author' | 'global'; origin: 'author' | 'curator' | 'corroboration' },
): TierOutcome => ({ kind: 'resolved', tier: 'curated', food, evidence: 'curated mapping', mapping });

const memo = (food: FoodRef): TierOutcome => ({ kind: 'resolved', tier: 'memo', food, evidence: 'memo exact match' });

describe('nameProposalDraftsOf', () => {
    it.each([
        ["the cook's own correction", curated(root('A'), { scope: 'author', origin: 'author' }), 'ownCorrection'],
        ['a staff ruling', curated(root('A'), { scope: 'global', origin: 'curator' }), 'staffRuling'],
        ['two cooks agreeing', curated(root('A'), { scope: 'global', origin: 'corroboration' }), 'corroborated'],
        ["a memo another cook's save taught", memo(root('A')), 'remembered'],
    ] as const)('proposes %s under its own source key', (_label, outcome, source) => {
        expect(nameProposalDraftsOf([outcome])).toStrictEqual([{ food: root('A'), source }]);
    });

    it('proposes a variant exactly as it proposes a root', () => {
        const variant: FoodRef = { kind: 'variant', id: 'VAR-1' };

        expect(nameProposalDraftsOf([memo(variant)])).toStrictEqual([{ food: variant, source: 'remembered' }]);
    });

    it('ignores a tier that passed', () => {
        expect(
            nameProposalDraftsOf([
                { kind: 'pass', tier: 'curated', reason: 'nothing' },
                { kind: 'pass', tier: 'memo', reason: 'nothing' },
            ]),
        ).toStrictEqual([]);
    });

    it('lists the strongest source first, whatever order the tiers answered in', () => {
        const drafts = nameProposalDraftsOf([
            memo(root('M')),
            curated(root('C'), { scope: 'global', origin: 'corroboration' }),
            curated(root('S'), { scope: 'global', origin: 'curator' }),
            curated(root('O'), { scope: 'author', origin: 'author' }),
        ]);

        expect(drafts.map((draft) => draft.source)).toStrictEqual([
            'ownCorrection',
            'staffRuling',
            'corroborated',
            'remembered',
        ]);
    });

    it('shows a food two sources agree on once, under the stronger source', () => {
        const drafts = nameProposalDraftsOf([
            memo(root('SAME')),
            curated(root('SAME'), { scope: 'global', origin: 'curator' }),
        ]);

        expect(drafts).toStrictEqual([{ food: root('SAME'), source: 'staffRuling' }]);
    });

    it('keeps a root and its own variant apart: they are different foods', () => {
        const drafts = nameProposalDraftsOf([
            memo(root('X')),
            curated(root('X-VAR'), { scope: 'author', origin: 'author' }),
        ]);

        expect(drafts).toHaveLength(2);
    });

    it('never turns a ranked answer into a proposal: the ranked tier is not a source of this route', () => {
        const ranked: TierOutcome = { kind: 'resolved', tier: 'lexical', food: root('R'), evidence: 'catalog ranking' };

        expect(nameProposalDraftsOf([ranked])).toStrictEqual([]);
    });

    it('fails closed on a curated answer that names no mapping, rather than guessing a source', () => {
        const unlabelled: TierOutcome = {
            kind: 'resolved',
            tier: 'curated',
            food: root('A'),
            evidence: 'curated mapping',
        };

        expect(nameProposalDraftsOf([unlabelled])).toStrictEqual([]);
    });
});
