/**
 * The key-to-wording map (ADR-0095 section 4). A statement's wording version is the client's word that it showed THAT text,
 * so the text each version stands for is pinned here: editing a string without moving its version fails this test, and a
 * new version in `recipe-core` fails it until the text is chosen on purpose.
 */
import { PUBLIC_CONFIRM_WORDINGS, STATEMENT_WORDINGS_BY_CHOICE } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { recipeActionMessages } from '../messages.js';

const { sourceStatement: m, publicConfirm } = recipeActionMessages.en;

/** What each wording version said when it was shown. A change of a word here is a NEW version, never an edit. */
const SHOWN = {
    'statementAuthored.v1': [m.answerAuthored, m.hintAuthored],
    'statementPublicWeb.v1': [m.answerWeb, m.hintPrivate],
    'statementBook.v1': [m.answerBook, m.hintPrivate],
    'statementFromPerson.v1': [m.answerPerson, m.hintPerson],
} as const;

describe('the statement wordings', () => {
    it('pins the text each version stands for', () => {
        expect(SHOWN).toEqual({
            'statementAuthored.v1': [
                'I wrote this',
                'It’s my own recipe, in my own words, and any photos are mine. It isn’t copied from a website, book or another person. Goes public.',
            ],
            'statementPublicWeb.v1': ['From a web page', 'Stays private to you.'],
            'statementBook.v1': ['From a cookbook or magazine', 'Stays private to you.'],
            'statementFromPerson.v1': [
                'From another person',
                'A recipe someone gave you, like family or a friend. Stays private to you.',
            ],
        });
        expect(publicConfirm.line).toBe(
            'By making this public, you confirm it’s your own recipe in your own words, or that you have the right to share it.',
        );
    });

    it('has a pinned text for every version the registry lists, and the registry lists exactly one per choice today', () => {
        const registry = Object.values(STATEMENT_WORDINGS_BY_CHOICE).flat();

        expect(Object.keys(SHOWN).sort()).toEqual([...registry].sort());
        expect(PUBLIC_CONFIRM_WORDINGS).toEqual(['publicConfirm.v1']);
    });
});
