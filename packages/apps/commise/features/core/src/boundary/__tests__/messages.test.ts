/**
 * The crash fallback's copy is authored ONCE (owner rule: UI duplicated between web and mobile lives in the shared
 * package). The page/screen wording split was ruled away by the UX review: a person who hit a crash does not
 * distinguish "page" from "screen", and "snag" was the only error copy in either app that did not say "couldn’t load".
 */
import { describe, expect, it } from 'vitest';

import { boundaryMessages } from '../messages.js';

describe('boundaryMessages', () => {
    it('states one body for any crashed view, noun-free, in the "couldn’t load" register of every sibling error', () => {
        expect(boundaryMessages.en.errorBody).toBe('We couldn’t load this. Please try again.');
    });

    it('states the Home variant separately, because Home offers no Back to Home', () => {
        expect(boundaryMessages.en.errorBodyHome).toBe('We couldn’t load Home. Please try again.');
    });
});
