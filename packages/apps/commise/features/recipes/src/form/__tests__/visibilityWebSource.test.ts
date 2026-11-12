/**
 * "Who can see it" for a draft whose source is a copied web page (ADR-0089): the visibility is DERIVED, so the field shows
 * Private and refuses Public with the web-source reason, while `values.visibility` is never written (taking the source off
 * brings the cook's own choice back).
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import type { RecipePrivateFacts } from '../../actions/recipePrivateGate.js';
import { editorMessages } from '../../editor/messages.js';
import { visibilityChoice, visibilityFieldOf } from '../props.js';

const v = editorMessages.en.visibility;
const OPEN = { kind: 'open', used: 38, limit: 50, left: 12 } as const;
const FULL = { kind: 'full', used: 50, limit: 50 } as const;
const facts = (
    rule: RecipePrivateFacts['rule'],
    standing: RecipePrivateFacts['standing'] = OPEN,
): RecipePrivateFacts => ({
    rule,
    standing,
    state: 'hidden',
});
const base = { saved: RecipeVisibility.PUBLIC, draft: RecipeVisibility.PUBLIC, refusal: undefined, messages: v };

describe('visibilityFieldOf for a web copy', () => {
    it('shows Private even though the cook chose Public, and refuses the Public card with the web-source reason', () => {
        const model = visibilityFieldOf({ ...base, facts: facts('privateOnly'), webSource: true });

        expect(model.shown).toBe(RecipeVisibility.PRIVATE);
        expect(model.options[0].refused).toBe(true);
        expect(model.options[0].note).toBe(
            'Not for this recipe. It’s copied from a web page, and its author owns the writing.',
        );
        expect(model.options[1].refused).toBe(false);
    });

    it('still shows Private when every slot is used (a web copy cannot fall back to Public)', () => {
        const model = visibilityFieldOf({
            ...base,
            refusal: 'slots',
            facts: facts('privateOnly', FULL),
            webSource: true,
        });

        expect(model.shown).toBe(RecipeVisibility.PRIVATE);
        expect(model.options[0].note).toBe(v.publicRefusedWebSource);
    });

    it('keeps the book and paid-site reason for a recipe that is not a web copy', () => {
        const model = visibilityFieldOf({ ...base, facts: facts('privateOnly'), webSource: false });

        expect(model.options[0].note).toBe(v.publicRefused);
    });

    it('is the cook’s own choice again once the source is off (the rule is slots)', () => {
        const model = visibilityFieldOf({ ...base, facts: facts('slots'), webSource: false });

        expect(model.shown).toBe(RecipeVisibility.PUBLIC);
        expect(model.options[0].refused).toBe(false);
    });

    it('choosing Public does nothing while the draft is a web copy', () => {
        expect(visibilityChoice('private', 'public', 'public', facts('privateOnly'))).toBeUndefined();
    });
});
