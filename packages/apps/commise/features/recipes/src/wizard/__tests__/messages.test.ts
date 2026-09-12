/**
 * Contract tests for the wizard shell's copy dictionary (U32/U33).
 *
 * Two things are pinned here that the type system alone cannot state:
 *
 *  - **The step NAMES and their association to a step number.** U33 renames the rail —
 *    `Photos` stops being a step of its own (its fields move into step 1) and step 4 becomes `Review`.
 *    `stepNames` is keyed BY `RecipeWizardStep`, not positional, so the association is the type rather
 *    than an index arithmetic both platform leaves used to repeat with a `?? ''` fallback that could only ever
 *    render an empty label. This test asserts the four names AND that every step in {@link WIZARD_STEPS} has
 *    one, so a step added without a name is a failure here rather than a blank pill in the rail.
 *  - **That the Preview surface is GONE, not merely unrendered** (owner ruling 2026-08-25). Review replaces
 *    it, and two surfaces rendering the same draft drift. A leftover `preview*` key is exactly how a deleted
 *    surface gets quietly restored, so its ABSENCE is asserted against the shipped dictionary object.
 */
import { describe, expect, it } from 'vitest';

import { WIZARD_STEPS } from '../model.js';
import { wizardMessages } from '../messages.js';

const en = wizardMessages.en;

describe('wizardMessages.stepNames (U33 — Photos folds into Details, step 4 becomes Review)', () => {
    it('names the four steps Details / Ingredients / Instructions / Review', () => {
        expect(en.stepNames).toEqual({ 1: 'Details', 2: 'Ingredients', 3: 'Instructions', 4: 'Review' });
    });

    it('gives every wizard step a non-empty name', () => {
        for (const step of WIZARD_STEPS) {
            expect(en.stepNames[step].length).toBeGreaterThan(0);
        }
    });

    it('no longer carries a step named Photos — photos are a field of Details, not a step', () => {
        expect(Object.values(en.stepNames)).not.toContain('Photos');
    });
});

describe('wizardMessages — the Preview surface was DELETED, not hidden (owner ruling 2026-08-25)', () => {
    it('carries no preview copy at all', () => {
        const previewKeys = Object.keys(en).filter((key) => key.toLowerCase().startsWith('preview'));

        expect(previewKeys).toEqual([]);
    });
});

describe('wizardMessages — the header back affordance (U32)', () => {
    it('names the back control, which replaces the kebab’s Cancel below lg', () => {
        expect(en.back.length).toBeGreaterThan(0);
    });

    it('names the wizard header region distinctly from the rail and the step controls', () => {
        expect(new Set([en.headerLabel, en.railLabel, en.controlsLabel]).size).toBe(3);
    });
});
