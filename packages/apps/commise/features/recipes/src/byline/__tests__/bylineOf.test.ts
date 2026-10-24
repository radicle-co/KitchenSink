/**
 * The one byline rule every surface renders (plan 2026-10-15-010 D11): the Clerk username is the public "@handle"
 * (owner ruling 2026-10-13), the display name stays public beside it, and an erased author is a former member — never
 * the `user_<ULID>` pseudonym, which reads like a username and is a legal one.
 */
import { pseudonymizedAuthorHandle } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { bylineInitial, bylineOf } from '../bylineOf.js';

describe('bylineOf', () => {
    it('is a PERSON when the author has a username, carrying the display name beside it', () => {
        expect(bylineOf({ username: 'braise', displayName: 'Eliza Moreno' })).toEqual({
            kind: 'person',
            username: 'braise',
            displayName: 'Eliza Moreno',
        });
    });

    it.each([
        ['absent', undefined],
        ['blank', '   '],
        ['the username again', 'braise'],
        ['the username in another case, with an @', '@Braise'],
    ])('drops a display name that is %s, so the byline does not say the same thing twice', (_case, displayName) => {
        expect(bylineOf({ username: 'braise', ...(displayName === undefined ? {} : { displayName }) })).toEqual({
            kind: 'person',
            username: 'braise',
        });
    });

    it('is a NAME — never prefixed "@" — when there is a display name and no username', () => {
        expect(bylineOf({ displayName: 'Eliza Moreno' })).toEqual({ kind: 'name', displayName: 'Eliza Moreno' });
    });

    it('is a FORMER MEMBER when the display name is the erasure pseudonym, whatever else is present', () => {
        expect(bylineOf({ displayName: pseudonymizedAuthorHandle('01J9ZK8N7QF3B2X4M6T0V5C1AB') })).toEqual({
            kind: 'former',
        });
    });

    it('is a SOURCE for an imported recipe with no author', () => {
        expect(bylineOf({ sourceAttribution: 'Serious Eats' })).toEqual({
            kind: 'source',
            attribution: 'Serious Eats',
        });
    });

    it('prefers the AUTHOR over a source line', () => {
        expect(bylineOf({ username: 'braise', sourceAttribution: 'Serious Eats' }).kind).toBe('person');
    });

    it('is NONE when nothing is known', () => {
        expect(bylineOf({})).toEqual({ kind: 'none' });
        expect(bylineOf({ displayName: ' ', sourceAttribution: '' })).toEqual({ kind: 'none' });
    });
});

describe('bylineInitial', () => {
    it('takes the first letter of the USERNAME, upper-cased — the first character a reader sees', () => {
        expect(bylineInitial({ kind: 'person', username: 'braise', displayName: 'Eliza Moreno' })).toBe('B');
    });

    it('falls back to the display name when the username starts with no letter', () => {
        expect(bylineInitial({ kind: 'person', username: '_42cook', displayName: 'Eliza Moreno' })).toBe('E');
    });

    it('takes the display name’s first letter for a name-only byline, whole even when it is astral', () => {
        expect(bylineInitial({ kind: 'name', displayName: '𝒜da' })).toBe('𝒜');
    });

    it.each([{ kind: 'former' as const }, { kind: 'source' as const, attribution: 'X' }, { kind: 'none' as const }])(
        'draws no disc for a %o byline',
        (byline) => {
            expect(bylineInitial(byline)).toBeUndefined();
        },
    );

    it('draws no disc when neither half has a letter', () => {
        expect(bylineInitial({ kind: 'person', username: '_42' })).toBeUndefined();
    });
});
