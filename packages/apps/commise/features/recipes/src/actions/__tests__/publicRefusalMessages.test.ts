/**
 * The words for each reason a recipe cannot be public (board P6, plan makePublicRefusalNotice U5, KTD-4). Written
 * before the keys: the lines are the designer's (decisions/makePublicRefusalNotice-designer.md, 2026-11-19), read back
 * from the keys, and the AE8 word list is checked over every locale's values.
 *
 * A reason line says what is true and stops: it never names a public path, never invites the cook to change the answer,
 * and never sends them to ask for a change (brainstorm R5, AE8).
 */
import { describe, expect, it } from 'vitest';

import { PUBLIC_REFUSALS, publicRefusalLineOf, type PublicRefusal } from '../publicRefusal.js';
import { recipeActionMessages } from '../messages.js';

const LINES: Readonly<Record<Exclude<PublicRefusal, 'none'>, string>> = {
    fromPerson: 'This recipe stays private because it’s from another person.',
    unrecognised: 'This recipe stays private because of its source.',
    'policy.webPage': 'This recipe stays private because it’s from a web page.',
    'policy.book': 'This recipe stays private because it’s from a cookbook or magazine.',
    'policy.paidSite': 'This recipe stays private because it’s from a paid website.',
    sourceConflict: 'This recipe stays private because it was saved with a source.',
};

/** AE8, with qse's two additions (H-2): no public path, no invitation to change the answer, nothing to ask for. */
const FORBIDDEN = [
    'rewrite',
    'rewritten',
    'public version',
    'Commise-written',
    'change the source',
    'change your answer',
    'ask us',
    'contact',
    'for now',
    'yet',
    'later',
    'until',
] as const;

describe('the reason lines', () => {
    const reasons = PUBLIC_REFUSALS.filter((reason): reason is Exclude<PublicRefusal, 'none'> => reason !== 'none');

    it.each(reasons)('%s says the designer’s line', (reason) => {
        expect(publicRefusalLineOf(reason, recipeActionMessages.en.publicRefusal)).toBe(LINES[reason]);
    });

    it('says nothing when nothing stops Public', () => {
        expect(publicRefusalLineOf('none', recipeActionMessages.en.publicRefusal)).toBeUndefined();
    });

    it('has one key per reason, and no other', () => {
        expect(Object.keys(recipeActionMessages.en.publicRefusal).sort()).toEqual(
            ['fromPerson', 'policyBook', 'policyPaidSite', 'policyWebPage', 'sourceConflict', 'unrecognised'].sort(),
        );
    });

    it('uses curly apostrophes, like every shipped key', () => {
        for (const line of Object.values(recipeActionMessages.en.publicRefusal)) {
            expect(line).not.toContain("'");
        }
    });
});

describe('AE8: no line promises a public path or invites a change of answer', () => {
    // Every locale: a locale added later is held to the same list.
    const cases = Object.entries(recipeActionMessages).flatMap(([locale, messages]) =>
        Object.entries(messages?.publicRefusal ?? {}).map(([key, value]) => [`${locale}.${key}`, value] as const),
    );

    it.each(cases)('%s contains none of the listed words', (_name, value) => {
        const found = FORBIDDEN.filter((word) => value.toLowerCase().includes(word.toLowerCase()));

        expect(found).toEqual([]);
    });

    it('checks at least one value per reason', () => {
        expect(cases.length).toBeGreaterThanOrEqual(6);
    });
});
