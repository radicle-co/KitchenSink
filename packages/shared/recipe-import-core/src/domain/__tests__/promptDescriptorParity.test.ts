/**
 * The parse prompt's "product descriptors" and the merge's identity vocabulary must agree.
 *
 * The LLM is told to keep these words in the food's NAME (`PARSE_SYSTEM_PROMPT`, rule 7). The merge then re-places
 * every word through `classifyModifier`, and stores the result. A descriptor the lexicon files as preparation is
 * moved out of the name AFTER the model kept it there: `2 tablespoons unsalted butter, melted` was stored as `butter`
 * with the preparation `melted unsalted`, and bound to salted butter. So the two lists are one piece of knowledge.
 *
 * The prompt text is pinned by length and SHA-256 and changing it is a new parse generation, so this reads the list
 * OUT of the prompt rather than sharing a constant with it. A word added to the prompt alone fails here.
 *
 * Each exception names the ruling that keeps the lexicon apart from the prompt. An exception stops being one the day
 * its ruling changes: the second test fails if an exception starts to classify as identity, so it cannot go stale.
 */
import { describe, it, expect } from 'vitest';

import { PARSE_SYSTEM_PROMPT } from '@kitchensink/recipe-core/parsing/parse-prompt';

import { classifyModifier } from '../modifierLexicon.js';

/** The prompt words the lexicon files as preparation on purpose, each with the ruling that says so. */
const RULED_PREPARATION: Readonly<Record<string, string>> = {
    // Owner ruling 2026-08-23 as refined 2026-08-26 (modifierIdentity.test.ts): a cook whips cream.
    whipped: 'owner ruling 2026-08-26, something a cook does',
    // The 1919 corpus diff (2026-11-06): as identity it moved 9 lines, and on 8 of them `mixed` FOLLOWS the food as the
    // cook's action ("flour mixed with ...", "almonds mixed"). This lexicon reads a word, not its position, so `mixed`
    // stays preparation. Accepted loss: `mixed herbs` is stored as `herbs` with the preparation `mixed`.
    mixed: 'corpus diff 2026-11-06, mostly the cook mixing',
};

/** The descriptor list, read out of the prompt sentence that states it. */
const promptDescriptors = (): readonly string[] => {
    const match = /ONLY these product descriptors stay in the name: ([^.]+)\./u.exec(PARSE_SYSTEM_PROMPT);

    if (match?.[1] === undefined) {
        throw new Error('The parse prompt no longer states its product descriptors; update this guard.');
    }

    return match[1].split(',').map((word) => word.trim());
};

describe('the prompt and the merge agree on which words name a food', () => {
    it('reads a non-empty descriptor list out of the prompt', () => {
        expect(promptDescriptors().length).toBeGreaterThanOrEqual(20);
        expect(promptDescriptors()).toContain('unsalted');
    });

    it.each(promptDescriptors().filter((word) => !(word in RULED_PREPARATION)))(
        '%s stays in the name, as the prompt tells the model',
        (word) => {
            expect(classifyModifier(word)).toBe('identity');
        },
    );

    it.each(Object.keys(RULED_PREPARATION))('%s is still a ruled exception that the prompt lists', (word) => {
        expect(promptDescriptors()).toContain(word);
        expect(classifyModifier(word)).toBe('preparation');
    });
});
