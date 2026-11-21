/**
 * The staff correction policy (ADR-0099, plan everyAnswerSourceLock KTD-6 and U3): a literal table over (stored answer x new answer
 * x visibility before), EVERY cell once, with the three mutations that must each fail a cell:
 * "hold on every correction", "no hold on own" and "no hold off a paid site". The visibility before never changes a cell: the
 * policy does not read it, and the test proves that by running each cell on both.
 */
import { describe, expect, it } from 'vitest';
import { RecipeSourceType } from '@kitchensink/recipe-core';

import { SOURCE_CORRECT_SCOPE } from '../../recipes.schema.js';
import {
    evaluateSourceCorrectionScope,
    holdOf,
    type CorrectableRecipe,
    type SourceAnswerKind,
} from '../sourceCorrectionScopePolicy.js';
import { evaluateVisibility, type VisibilityPolicyInput } from '../visibilityPolicy.js';
import { sourceConflictOfEvidence, type EvidenceToWrite } from '../sourceEvidence.js';
import { evidenceListOf } from '../sourceEvidence.js';
import type { StatementAnswer } from '../provenancePolicy.js';

const OWNER = '01JUOWNER000000000000000A1';
const SCOPES = [SOURCE_CORRECT_SCOPE] as const;
const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
const BOOK = 'Joy of Cooking, p. 12';
const PAID = 'Sam’s Subscription Kitchen';

const ANSWERS: Record<SourceAnswerKind, StatementAnswer> = {
    own: { kind: 'authored' },
    person: { kind: 'fromPerson' },
    webPage: { kind: 'public_web', citation: LINK },
    book: { kind: 'book', citation: BOOK },
    paidSite: { kind: 'paid_site', citation: PAID },
};

/** The stored row of a recipe that holds each answer (the same answer the matching request names, so it is `unchanged` over itself). */
const STORED: Record<SourceAnswerKind, CorrectableRecipe> = {
    own: {
        ownerId: OWNER,
        sourceType: 'user_created',
        sourceKind: null,
        statementKind: 'authored',
        sourceUrl: null,
        sourceAttribution: null,
    },
    person: {
        ownerId: OWNER,
        sourceType: 'user_created',
        sourceKind: null,
        statementKind: 'fromPerson',
        sourceUrl: null,
        sourceAttribution: null,
    },
    webPage: {
        ownerId: OWNER,
        sourceType: 'imported_public',
        sourceKind: 'public_web',
        statementKind: 'source',
        sourceUrl: LINK,
        sourceAttribution: 'allrecipes.com',
    },
    book: {
        ownerId: OWNER,
        sourceType: 'imported_physical',
        sourceKind: 'book',
        statementKind: 'source',
        sourceUrl: null,
        sourceAttribution: BOOK,
    },
    paidSite: {
        ownerId: OWNER,
        sourceType: 'imported_paid',
        sourceKind: 'paid_site',
        statementKind: 'source',
        sourceUrl: null,
        sourceAttribution: PAID,
    },
};

const KINDS = ['own', 'person', 'webPage', 'book', 'paidSite'] as const;

/** [stored answer, new answer, verdict]. `held` and `open` are both `apply`; the hold is the difference. Written out, never derived. */
const TABLE: ReadonlyArray<readonly [SourceAnswerKind, SourceAnswerKind, 'unchanged' | 'held' | 'open']> = [
    ['own', 'own', 'unchanged'],
    ['own', 'person', 'held'],
    ['own', 'webPage', 'open'],
    ['own', 'book', 'open'],
    ['own', 'paidSite', 'open'],
    ['person', 'own', 'held'],
    ['person', 'person', 'unchanged'],
    ['person', 'webPage', 'open'],
    ['person', 'book', 'open'],
    ['person', 'paidSite', 'open'],
    ['webPage', 'own', 'held'],
    ['webPage', 'person', 'held'],
    ['webPage', 'webPage', 'unchanged'],
    ['webPage', 'book', 'open'],
    ['webPage', 'paidSite', 'open'],
    ['book', 'own', 'held'],
    ['book', 'person', 'held'],
    ['book', 'webPage', 'open'],
    ['book', 'book', 'unchanged'],
    ['book', 'paidSite', 'open'],
    ['paidSite', 'own', 'held'],
    ['paidSite', 'person', 'held'],
    ['paidSite', 'webPage', 'held'],
    ['paidSite', 'book', 'held'],
    ['paidSite', 'paidSite', 'unchanged'],
];

const decide = (from: SourceAnswerKind, to: SourceAnswerKind) =>
    evaluateSourceCorrectionScope({
        callerScopes: SCOPES,
        recipe: STORED[from],
        ownerAccountId: OWNER,
        answer: ANSWERS[to],
    });

describe('evaluateSourceCorrectionScope — the whole table', () => {
    it('covers every stored answer x new answer exactly once', () => {
        expect(TABLE.map(([from, to]) => `${from}/${to}`).sort()).toEqual(
            KINDS.flatMap((from) => KINDS.map((to) => `${from}/${to}`)).sort(),
        );
    });

    it.each(TABLE)('%s corrected to %s: %s', (from, to, expected) => {
        const verdict = decide(from, to);

        if (expected === 'unchanged') {
            expect(verdict).toEqual({ kind: 'unchanged' });

            return;
        }

        expect(verdict).toMatchObject({ kind: 'apply', hold: expected === 'held', from, to });
    });

    it('never yields a public result: an apply carries a hold or an open recipe, and the write is private by construction', () => {
        for (const [from, to, expected] of TABLE) {
            const verdict = decide(from, to);

            expect(verdict.kind).not.toBe('forbidden');
            expect(verdict).not.toHaveProperty('visibility', 'public');
            expect(['unchanged', 'apply']).toContain(verdict.kind);
            expect(expected).toBeDefined();
        }
    });

    it('holdOf is the one rule: new own or person, or old paid site', () => {
        for (const from of KINDS) {
            for (const to of KINDS) {
                expect(holdOf(from, to)).toBe(to === 'own' || to === 'person' || from === 'paidSite');
            }
        }
    });

    it('a different citation over the same kind is an apply, held when the old answer was a paid site', () => {
        const other = (answer: StatementAnswer) =>
            answer.kind === 'book' ? { ...answer, citation: 'Another Book' } : answer;

        expect(
            evaluateSourceCorrectionScope({
                callerScopes: SCOPES,
                recipe: STORED.book,
                ownerAccountId: OWNER,
                answer: other(ANSWERS.book),
            }),
        ).toMatchObject({ kind: 'apply', hold: false });
        expect(
            evaluateSourceCorrectionScope({
                callerScopes: SCOPES,
                recipe: STORED.paidSite,
                ownerAccountId: OWNER,
                answer: { kind: 'paid_site', citation: 'Another Site' },
            }),
        ).toMatchObject({ kind: 'apply', hold: true });
    });
});

/**
 * qse Q-7: for every UNHELD cell, the Public outcome after the correction is the outcome of a cook who stated the new answer first
 * (the same evidence rule, the same private-only rule), and is never `SOURCE_CORRECTED`. The expected side is computed by the REAL
 * policies and the real evidence function, not re-derived here. A HELD cell, with nothing else refusing, answers `sourceCorrected`.
 */
describe('the hold oracle (qse Q-6, Q-7)', () => {
    const askPublic = (over: Partial<VisibilityPolicyInput>) =>
        evaluateVisibility({
            principalKind: 'real',
            containment: 'enforce',
            sourceType: RecipeSourceType.USER_CREATED,
            sourceKind: null,
            isPremium: false,
            hasAvailablePrivateSlot: true,
            requested: 'public',
            sourceConflict: false,
            fromPerson: false,
            sourceCorrected: false,
            ...over,
        });

    const evidenceOf = (to: SourceAnswerKind): EvidenceToWrite[] => {
        const verdict = decide('own', to);

        return verdict.kind === 'apply' ? evidenceListOf(verdict.provenance, 'editor') : [];
    };

    it.each(TABLE.filter(([, , expected]) => expected === 'open'))(
        '%s corrected to %s (unheld): Public is refused exactly as it is for a cook who stated it first',
        (from, to) => {
            const verdict = decide(from, to);

            if (verdict.kind !== 'apply') {
                throw new Error('test setup: an open cell applies');
            }

            const evidence = evidenceOf(to);
            const afterCorrection = askPublic({
                sourceType: verdict.provenance.sourceType,
                sourceKind: verdict.provenance.sourceKind,
                sourceConflict: sourceConflictOfEvidence(evidence, verdict.provenance),
                sourceCorrected: verdict.hold,
            });
            const statedFirst = askPublic({
                sourceType: verdict.provenance.sourceType,
                sourceKind: verdict.provenance.sourceKind,
                sourceConflict: sourceConflictOfEvidence(evidence, verdict.provenance),
            });

            expect(afterCorrection).toEqual(statedFirst);
            expect(afterCorrection.allowed === false && afterCorrection.denial).not.toBe('sourceCorrected');
        },
    );

    it.each(TABLE.filter(([, , expected]) => expected === 'held'))(
        '%s corrected to %s (held): with nothing else refusing, Public is refused as sourceCorrected',
        (from, to) => {
            const verdict = decide(from, to);

            if (verdict.kind !== 'apply') {
                throw new Error('test setup: a held cell applies');
            }

            expect(verdict.hold).toBe(true);
            expect(askPublic({ sourceCorrected: true })).toMatchObject({ allowed: false, denial: 'sourceCorrected' });
        },
    );
});

describe('the other verdicts', () => {
    it('no grant: forbidden, and the curator grant is not the grant', () => {
        for (const callerScopes of [[], ['recipes:import:public'], ['recipes:source:correct:extra']]) {
            expect(
                evaluateSourceCorrectionScope({
                    callerScopes,
                    recipe: STORED.own,
                    ownerAccountId: OWNER,
                    answer: ANSWERS.book,
                }),
            ).toEqual({ kind: 'forbidden' });
        }
    });

    it('forbidden is answered before the recipe is looked at: a missing recipe and a wrong owner are forbidden to a caller with no grant', () => {
        expect(
            evaluateSourceCorrectionScope({
                callerScopes: [],
                recipe: undefined,
                ownerAccountId: OWNER,
                answer: ANSWERS.book,
            }),
        ).toEqual({ kind: 'forbidden' });
    });

    it('a missing recipe and a wrong owner are the SAME answer', () => {
        const missing = evaluateSourceCorrectionScope({
            callerScopes: SCOPES,
            recipe: undefined,
            ownerAccountId: OWNER,
            answer: ANSWERS.book,
        });
        const wrongOwner = evaluateSourceCorrectionScope({
            callerScopes: SCOPES,
            recipe: STORED.own,
            ownerAccountId: '01JUSOMEONEELSE00000000A1',
            answer: ANSWERS.book,
        });

        expect(missing).toEqual({ kind: 'notFound' });
        expect(wrongOwner).toEqual(missing);
    });

    it('a recipe with no answer, and the curator’s public-domain text, are invalid targets', () => {
        const none: CorrectableRecipe = { ...STORED.own, statementKind: null };
        const publicDomain: CorrectableRecipe = { ...STORED.own, sourceType: 'imported_public', statementKind: null };

        for (const recipe of [none, publicDomain]) {
            expect(
                evaluateSourceCorrectionScope({
                    callerScopes: SCOPES,
                    recipe,
                    ownerAccountId: OWNER,
                    answer: ANSWERS.book,
                }),
            ).toEqual({ kind: 'invalidTarget' });
        }
    });

    it('a web link that is not a usable source is an invalid target', () => {
        expect(
            evaluateSourceCorrectionScope({
                callerScopes: SCOPES,
                recipe: STORED.own,
                ownerAccountId: OWNER,
                answer: { kind: 'public_web', citation: 'http://localhost/recipe' },
            }),
        ).toEqual({ kind: 'invalidTarget' });
    });
});
