import { RecipeStatus } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { cookLinkOutcome } from '../cookLinkOutcome.js';
import type { CookLinkInput, CookLinkOutcome } from '../cookLinkOutcome.js';

/**
 * `cookLinkOutcome` — where a cook link goes. Decided once here, acted on by the route adapters.
 *
 * Every reachable row of the entry table is a case. The ordering rule that matters most: a recipe the viewer cannot
 * read is `gone` FIRST, whatever its status, so the link never tells a non-owner that a recipe is a draft or has no
 * steps. `stepCount` is the count of steps with text (`cookingStepsOf`, FR-033a).
 *
 * Not in the table yet: "in review" (spec 020 is unbuilt and has no field), and a facts card (it has no cook link).
 */

const PUBLISHED = RecipeStatus.PUBLISHED;
const DRAFT = RecipeStatus.DRAFT;

const rows: readonly (readonly [string, CookLinkInput, CookLinkOutcome])[] = [
    ['published, mine, with steps', { status: PUBLISHED, stepCount: 6, isOwner: true, readable: true }, 'cook'],
    ["another cook's public recipe", { status: PUBLISHED, stepCount: 6, isOwner: false, readable: true }, 'cook'],
    ['not approved (private, mine)', { status: PUBLISHED, stepCount: 3, isOwner: true, readable: true }, 'cook'],
    ['published, mine, 0 steps', { status: PUBLISHED, stepCount: 0, isOwner: true, readable: true }, 'noSteps'],
    ["another cook's, 0 steps", { status: PUBLISHED, stepCount: 0, isOwner: false, readable: true }, 'noSteps'],
    ['my draft', { status: DRAFT, stepCount: 6, isOwner: true, readable: true }, 'editor'],
    ['my draft with no steps', { status: DRAFT, stepCount: 0, isOwner: true, readable: true }, 'editor'],
    ["another cook's draft I can read", { status: DRAFT, stepCount: 6, isOwner: false, readable: true }, 'gone'],
    ['deleted or no longer mine to read', { status: PUBLISHED, stepCount: 6, isOwner: false, readable: false }, 'gone'],
    ['unreadable draft', { status: DRAFT, stepCount: 6, isOwner: false, readable: false }, 'gone'],
    ['unreadable, 0 steps', { status: PUBLISHED, stepCount: 0, isOwner: false, readable: false }, 'gone'],
    ['unreadable even as owner', { status: DRAFT, stepCount: 6, isOwner: true, readable: false }, 'gone'],
];

describe('cookLinkOutcome — the entry table', () => {
    it.each(rows)('%s → %s', (_, input, outcome) => {
        expect(cookLinkOutcome(input)).toBe(outcome);
    });
});
