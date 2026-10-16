/**
 * Unit tests for the recipe page's pure decisions: who the viewer is (the session claim first, the profile second —
 * owner ruling 2026-10-16), when the body may show, which primary the action row offers and how a rating write's
 * failure is named. These moved out of two containers that each held a copy of them.
 */
import { NotFoundError } from '@kitchensink/recipe-service-client';
import { describe, expect, it } from 'vitest';

import {
    claimedViewerIdOf,
    primaryOf,
    ratingErrorKindOf,
    viewerIdOf,
    viewerKnown,
} from '../useRecipeDetailController.model.js';

describe('claimedViewerIdOf', () => {
    it.each([
        ['the external_id claim', { external_id: 'usr_1' }, 'usr_1'],
        ['no claims', undefined, undefined],
        ['null claims', null, undefined],
        ['a claim set without external_id', { sub: 'user_clerk' }, undefined],
        ['an empty external_id', { external_id: '' }, undefined],
        ['a non-string external_id', { external_id: 7 }, undefined],
        ['claims that are not an object', 'usr_1', undefined],
    ])('reads %s', (_name, claims, expected) => {
        expect(claimedViewerIdOf(claims)).toBe(expected);
    });
});

describe('viewerIdOf', () => {
    it('prefers the claim over the profile', () => {
        expect(viewerIdOf('usr_claim', 'usr_profile')).toBe('usr_claim');
    });

    it('falls back to the profile when there is no claim', () => {
        expect(viewerIdOf(undefined, 'usr_profile')).toBe('usr_profile');
    });

    it('is undefined when neither names the viewer', () => {
        expect(viewerIdOf(undefined, undefined)).toBeUndefined();
    });
});

describe('viewerKnown', () => {
    it('is known the moment a claim names the viewer, whatever the profile is doing', () => {
        expect(viewerKnown('usr_1', true)).toBe(true);
    });

    it('waits for the profile when nothing else names the viewer', () => {
        expect(viewerKnown(undefined, true)).toBe(false);
    });

    it('stops waiting once the profile has settled, even with no id (a signed-out viewer)', () => {
        expect(viewerKnown(undefined, false)).toBe(true);
    });
});

describe('primaryOf', () => {
    it('is Edit for the owner, even when the recipe may also be cloned', () => {
        expect(primaryOf({ viewerIsOwner: true, viewerCanClone: true })).toBe('edit');
    });

    it('is Save a copy for another cook who may clone', () => {
        expect(primaryOf({ viewerIsOwner: false, viewerCanClone: true })).toBe('saveCopy');
    });

    it('is nothing for a viewer who may do neither', () => {
        expect(primaryOf({ viewerIsOwner: false, viewerCanClone: false })).toBeUndefined();
    });
});

describe('ratingErrorKindOf', () => {
    it('is nothing when no write failed', () => {
        expect(ratingErrorKindOf(null)).toBeUndefined();
        expect(ratingErrorKindOf(undefined)).toBeUndefined();
    });

    it('names a not-found "not available" (Sc9), never a distinct forbidden', () => {
        expect(ratingErrorKindOf(new NotFoundError('gone'))).toBe('notAvailable');
    });

    it('names anything else generic', () => {
        expect(ratingErrorKindOf(new Error('network down'))).toBe('generic');
    });
});
