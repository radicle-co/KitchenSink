/**
 * Whether the visibility policy refuses an import item's requested visibility for the label its statement sets (ADR-0072 §9).
 *
 * The policy (`evaluateVisibility`) is the authority and is tested on its own; this pins the ONE seam the importer reads it
 * through, and the derived `visibilityRefused` issue the view shows. The mutation: judging the request against the wrong
 * label (a book recipe judged as the cook's own, which a free cook may keep public).
 *
 * The public web rows were REWRITTEN to the rule in force: a web recipe may be private on any plan, using a slot
 * (owner ruling 2026-10-29, ADR-0077 §6). They used to assert that it needed Premium and a substantive edit. The slot
 * itself is the save's question (ADR-0073), so this seam never refuses for want of one.
 */
import { describe, expect, it } from 'vitest';

import { makePrincipal } from '../../__fixtures__/importFixtures.js';
import { visibilityFactsOf, visibilityRefusedFor, type VisibilityFacts } from '../importVisibility.js';

const FREE: VisibilityFacts = { principalKind: 'real', containment: 'enforce', isPremium: false };
const PREMIUM: VisibilityFacts = { ...FREE, isPremium: true };
const BOOK = { kind: 'book', citation: 'Joy, p. 12' } as const;
const PAID = { kind: 'paid_site', citation: 'site' } as const;
const WEB = { kind: 'public_web', citation: 'https://example.com/r' } as const;
const MINE = { kind: 'authored' } as const;
const OWN_SITE = { kind: 'public_web', citation: 'https://commise.app/r/1' } as const;

describe('visibilityFactsOf: the cook as the policy reads them', () => {
    it('reads the containment and the plan off the principal', () => {
        expect(visibilityFactsOf(makePrincipal())).toStrictEqual(FREE);
        expect(visibilityFactsOf(makePrincipal({ roles: ['premium'] }))).toStrictEqual(PREMIUM);
        expect(visibilityFactsOf(makePrincipal({ principalKind: 'test', containment: 'off' }))).toMatchObject({
            principalKind: 'test',
            containment: 'off',
        });
    });
});

describe('visibilityRefusedFor', () => {
    it.each([
        ['a book recipe can never be public', FREE, BOOK, 'public', true],
        ['a paid-site recipe can never be public', PREMIUM, PAID, 'public', true],
        ['a book recipe may be private on any plan', FREE, BOOK, 'private', false],
        ['a paid-site recipe may be private on any plan', FREE, PAID, 'private', false],
        // ⛔ ADR-0089: a web copy is private only. Judged as `imported_public` with NO kind it would read as the curator's
        // public-domain text, which may be public.
        ['⛔ a public web recipe can never be public (a web copy, ADR-0089)', FREE, WEB, 'public', true],
        ['…not even for a Premium cook', PREMIUM, WEB, 'public', true],
        ['⛔ a web statement whose link is not a usable source is refused either way', FREE, OWN_SITE, 'private', true],
        [
            '⛔ a public web recipe may be private for a free cook, with no edit (ADR-0077 §6)',
            FREE,
            WEB,
            'private',
            false,
        ],
        ['…and for a Premium cook', PREMIUM, WEB, 'private', false],
        ['your own recipe may be public', FREE, MINE, 'public', false],
        [
            '⛔ your own recipe private on the free plan: the slot is the save’s question, not this seam’s',
            FREE,
            MINE,
            'private',
            false,
        ],
        ['your own recipe private: the policy decides by the plan', PREMIUM, MINE, 'private', false],
    ] as const)('%s', (_name, facts, statement, requested, refused) => {
        expect(visibilityRefusedFor(facts, statement, requested)).toBe(refused);
    });

    it('refuses a contained test principal’s public item, as the create route does', () => {
        expect(
            visibilityRefusedFor({ principalKind: 'test', containment: 'enforce', isPremium: true }, MINE, 'public'),
        ).toBe(true);
    });
});
