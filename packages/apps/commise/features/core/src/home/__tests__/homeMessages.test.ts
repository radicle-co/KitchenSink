/**
 * The Home copy both apps share. The shapes are held by the types; what a test must hold is the CONTENT the apps used to
 * author twice and got different: the tab bar's accessible name (web "Tabs", mobile "Main" - `buildSpec.md` §10 names the
 * tab bar "Tabs" and the sidebar "Main", two different landmarks), and the `{name}` slots the greeting and the profile
 * entry fill in.
 */
import { describe, expect, it } from 'vitest';

import { homeGreetingOf } from '../homeGreeting.js';
import { homeMessages } from '../messages.js';

const { en } = homeMessages;

describe('homeMessages', () => {
    it('names the tab bar landmark "Tabs", so it never shares the sidebar’s "Main" (buildSpec §10)', () => {
        expect(en.chrome.tabNavLabel).toBe('Tabs');
    });

    it('leaves a {name} slot in every named greeting and in the profile entry’s name', () => {
        for (const greeting of Object.values(en.greetingsNamed)) {
            expect(greeting).toContain('{name}');
        }

        expect(en.chrome.profileButton).toContain('{name}');
        expect(en.chrome.profileButtonNoName).not.toContain('{name}');
    });

    it('is a complete greeting copy for the shared greeting rule, at every hour', () => {
        for (let hour = 0; hour < 24; hour += 1) {
            expect(homeGreetingOf(en, 'Eliza', hour)).toContain('Eliza');
            expect(homeGreetingOf(en, undefined, hour)).not.toContain('{name}');
        }
    });
});
