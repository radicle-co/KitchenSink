// @vitest-environment jsdom
/**
 * ADR-0095, review item 9: the passive Public line is DRAWN under the Public card by one rule (`visibilityFieldOf` and the
 * surface's photo-finish guard) and its wording is SENT by another (`statementPlanOf`). A write carries the wording if and
 * only if the cook could read the line when they pressed Publish; the two drifting is a false attestation row.
 * Web leaves; the native pair is `RecipeEditorSurface.confirmLine.native.test.tsx`.
 */
import { RecipeVisibility, RecipeSourceType } from '@kitchensink/recipe-core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CONFIRM_LINE, mountConfirmLineSurface } from '../../__fixtures__/confirmLineSurface.js';
import type { EditorSeed } from '../../hooks/useRecipeEditor.js';
import { makeFilledRecipeFormValues, makeRecipeDetail } from '../../__fixtures__/index.js';

afterEach(cleanup);

const PUBLIC = makeFilledRecipeFormValues({ visibility: RecipeVisibility.PUBLIC });

/** Press Publish with `values` chosen, and say what was drawn then and what went out. */
function pressPublish(
    seed: EditorSeed,
    values = PUBLIC,
): { readonly drawn: boolean; readonly sent: boolean; readonly wrote: boolean } {
    const surface = mountConfirmLineSurface(render, seed);
    surface.choose(values);
    const drawn = screen.queryByText(CONFIRM_LINE) !== null;
    surface.publish();

    return { drawn, sent: surface.sentConfirmation(), wrote: surface.writes() > 0 };
}

describe('the passive Public line and the wording a write carries (web)', () => {
    it('Public chosen: the line is drawn, and the write carries its wording', () => {
        expect(pressPublish({})).toEqual({ drawn: true, sent: true, wrote: true });
    });

    it('Private chosen: no line is drawn, and none is sent', () => {
        const values = makeFilledRecipeFormValues({ visibility: RecipeVisibility.PRIVATE });

        expect(pressPublish({}, values)).toEqual({ drawn: false, sent: false, wrote: true });
    });

    it('a private-only recipe (a book) whose draft still says Public: no line, nothing sent', () => {
        const seed = { recipe: makeRecipeDetail({ sourceType: RecipeSourceType.IMPORTED_PHYSICAL }) };

        expect(pressPublish(seed)).toMatchObject({ drawn: false, sent: false });
    });

    it('a recipe a recorded source holds out of Public (held): no line, nothing sent', () => {
        const seed = { recipe: makeRecipeDetail({ publicNeedsCheck: true }) };

        expect(pressPublish(seed)).toEqual({ drawn: false, sent: false, wrote: true });
    });

    // The finish waits for photos AFTER Publish was pressed, and hides the field while it waits. What the write carries is the
    // line the cook read when they pressed, so it is still sent.
    it('a finish waiting for photos hides the field after the press: the line the cook read is still what is sent', () => {
        const surface = mountConfirmLineSurface(render, {});
        surface.choose(PUBLIC);
        expect(screen.queryByText(CONFIRM_LINE)).not.toBeNull();
        surface.waitForPhotos();
        expect(screen.queryByText(CONFIRM_LINE)).toBeNull();
        surface.publish();

        expect(surface.writes()).toBeGreaterThan(0);
        expect(surface.sentConfirmation()).toBe(true);
    });

    // The record names the catalog that served the words (review item 10): English copy shown for a French request is English.
    it('a locale the line fell back from is recorded as en, the locale of the words the cook read', () => {
        const surface = mountConfirmLineSurface(render, {}, 'fr-CA');
        surface.choose(PUBLIC);
        expect(screen.queryByText(CONFIRM_LINE)).not.toBeNull();
        surface.publish();

        expect(surface.sentLocales()).toEqual(['en']);
    });
});
