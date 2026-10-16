/**
 * Home's greeting, once for both apps: mobile's `useHomeGreeting` body and the same hour-bucket logic web inlined in
 * `HomeGreeting` (FR-044: the two greet identically).
 */
import { describe, expect, it } from 'vitest';

import { homeGreetingOf, type HomeGreetingCopy } from '../homeGreeting.js';

const COPY: HomeGreetingCopy = {
    greetings: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Still up?' },
    greetingsNamed: {
        morning: 'Good morning, {name}',
        afternoon: 'Good afternoon, {name}',
        evening: 'Good evening, {name}',
        night: 'Still up, {name}?',
    },
};

describe('homeGreetingOf', () => {
    it.each([
        [3, 'Still up?'],
        [9, 'Good morning'],
        [14, 'Good afternoon'],
        [20, 'Good evening'],
    ])('greets hour %i without a name with %j', (hour, expected) => {
        expect(homeGreetingOf(COPY, undefined, hour)).toBe(expected);
    });

    it('names the cook in the bucket’s own phrasing', () => {
        expect(homeGreetingOf(COPY, 'Eliza', 14)).toBe('Good afternoon, Eliza');
        expect(homeGreetingOf(COPY, 'Eliza', 3)).toBe('Still up, Eliza?');
    });

    it('inserts a name literally, even one made of replacement patterns', () => {
        expect(homeGreetingOf(COPY, '$&', 9)).toBe('Good morning, $&');
        expect(homeGreetingOf(COPY, "$'", 9)).toBe("Good morning, $'");
    });
});
