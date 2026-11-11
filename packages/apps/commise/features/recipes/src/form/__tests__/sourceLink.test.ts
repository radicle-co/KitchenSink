/**
 * `sourceLink.ts`: the editor's one reading of the Source field (ADR-0089). Written FROM the blueprint's state table, so
 * each case names the behaviour the cook sees, not the function that makes it.
 */
import { extractSourceLink, RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail, makeRecipeFormValues } from '../../__fixtures__/index.js';
import {
    derivedVisibility,
    draftPrivateRule,
    draftSourceOf,
    pastedSourcePlanOf,
    sourceRowOf,
    sourceStatementOf,
} from '../sourceLink.js';

const ALLRECIPES = 'https://www.allrecipes.com/recipe/1/soup/';
const withLink = (sourceLink: string, over = {}) => makeRecipeFormValues({ sourceLink, ...over });
/** The first-publish instant a published recipe always carries (the server's CHECK): the ONE fact the lock reads. */
const FIRST = '2026-11-01T00:00:00.000Z';
const CLONE_OF = '00000000-0000-4000-8000-0000000000c1';
const neverPublished = (over = {}) => makeRecipeDetail({ status: RecipeStatus.DRAFT, ...over });
const webCopy = (over = {}) =>
    makeRecipeDetail({
        sourceType: RecipeSourceType.IMPORTED_PUBLIC,
        sourceKind: 'public_web',
        sourceUrl: ALLRECIPES,
        visibility: RecipeVisibility.PRIVATE,
        status: RecipeStatus.DRAFT,
        ...over,
    });

describe('draftSourceOf', () => {
    it('reads no link as none', () => {
        expect(draftSourceOf(makeRecipeFormValues())).toEqual({ kind: 'none' });
        expect(draftSourceOf(withLink('   '))).toEqual({ kind: 'none' });
    });

    it('proves a web link and names its site', () => {
        expect(draftSourceOf(withLink(ALLRECIPES))).toEqual({
            kind: 'link',
            link: { url: ALLRECIPES, site: 'allrecipes.com' },
        });
    });

    it('refuses text that is not a web link, and our own site', () => {
        expect(draftSourceOf(withLink('soup'))).toEqual({ kind: 'refused', reason: 'invalid' });
        expect(draftSourceOf(withLink('https://www.commise.app/en/recipes/1'))).toEqual({
            kind: 'refused',
            reason: 'ownSite',
        });
    });
});

describe('derivedVisibility', () => {
    it('is Private for a draft with a source link, whatever the cook chose', () => {
        expect(derivedVisibility(withLink(ALLRECIPES, { visibility: RecipeVisibility.PUBLIC }))).toBe(
            RecipeVisibility.PRIVATE,
        );
    });

    it('is the cook’s choice with no link, so removing the link restores it', () => {
        expect(derivedVisibility(makeRecipeFormValues({ visibility: RecipeVisibility.PUBLIC }))).toBe(
            RecipeVisibility.PUBLIC,
        );
    });

    it('is the cook’s choice while the text is not yet a link', () => {
        expect(derivedVisibility(withLink('https://', { visibility: RecipeVisibility.PUBLIC }))).toBe(
            RecipeVisibility.PUBLIC,
        );
    });
});

describe('draftPrivateRule: the rule follows the DRAFT’s source', () => {
    it('is private only for a never-saved draft with a link (label and kind both come from the draft)', () => {
        expect(draftPrivateRule(withLink(ALLRECIPES), undefined)).toBe('privateOnly');
    });

    it('is slots for a never-saved draft with no link', () => {
        expect(draftPrivateRule(makeRecipeFormValues(), undefined)).toBe('slots');
    });

    it('goes back to slots when the cook removes the source of a stored web copy', () => {
        expect(draftPrivateRule(makeRecipeFormValues(), webCopy())).toBe('slots');
    });

    it('stays private only for a stored web copy that still has its link', () => {
        expect(draftPrivateRule(withLink(ALLRECIPES), webCopy())).toBe('privateOnly');
    });

    it('keeps a book recipe private only, and the curator’s public-domain text on slots', () => {
        const book = neverPublished({ sourceType: RecipeSourceType.IMPORTED_PHYSICAL, sourceKind: 'book' });
        const curator = neverPublished({ sourceType: RecipeSourceType.IMPORTED_PUBLIC });

        expect(draftPrivateRule(makeRecipeFormValues(), book)).toBe('privateOnly');
        expect(draftPrivateRule(makeRecipeFormValues(), curator)).toBe('slots');
    });
});

describe('sourceStatementOf: what the wire carries', () => {
    it('create: a link that parses is sent as the citation, re-serialised', () => {
        expect(sourceStatementOf(withLink(`  ${ALLRECIPES}.`), undefined)).toEqual({
            kind: 'public_web',
            citation: ALLRECIPES,
        });
    });

    it('create: nothing is sent for no link, or for text that is not a link', () => {
        expect(sourceStatementOf(makeRecipeFormValues(), undefined)).toBeUndefined();
        expect(sourceStatementOf(withLink('soup'), undefined)).toBeUndefined();
    });

    it('update: the same source the server holds is not sent again', () => {
        expect(sourceStatementOf(withLink(ALLRECIPES), webCopy())).toBeUndefined();
    });

    it('update: a new link on a draft is sent', () => {
        expect(sourceStatementOf(withLink(ALLRECIPES), neverPublished())).toEqual({
            kind: 'public_web',
            citation: ALLRECIPES,
        });
    });

    it('update: an emptied field removes a stored web source with null, and sends nothing when none is stored', () => {
        expect(sourceStatementOf(makeRecipeFormValues(), webCopy())).toBeNull();
        expect(sourceStatementOf(makeRecipeFormValues(), neverPublished())).toBeUndefined();
    });

    it('update: half-typed text never erases the stored source, and is never sent', () => {
        expect(sourceStatementOf(withLink('https://exa'), webCopy())).toBeUndefined();
        expect(sourceStatementOf(withLink('https://www.commise.app/x'), webCopy())).toBeUndefined();
    });

    it('update: nothing is sent once the recipe has been published (the source is locked)', () => {
        const published = webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST });

        expect(sourceStatementOf(makeRecipeFormValues(), published)).toBeUndefined();
        expect(sourceStatementOf(withLink('https://other.example/a'), published)).toBeUndefined();
        expect(
            sourceStatementOf(
                withLink('https://other.example/a'),
                makeRecipeDetail({ status: RecipeStatus.DRAFT, firstPublishedAt: '2026-11-01T00:00:00.000Z' }),
            ),
        ).toBeUndefined();
    });
});

describe('pastedSourcePlanOf: a link line in pasted text', () => {
    const plan = (pasted: string, over: Partial<Parameters<typeof pastedSourcePlanOf>[0]> = {}) =>
        pastedSourcePlanOf({
            extraction: extractSourceLink(pasted),
            current: makeRecipeFormValues(),
            recipe: undefined,
            removed: undefined,
            ...over,
        });

    it('fills an empty Source and says which site and that the recipe will be private', () => {
        expect(plan(`2 eggs\n${ALLRECIPES}`)).toEqual({
            set: ALLRECIPES,
            note: { kind: 'set', site: 'allrecipes.com' },
        });
    });

    it('keeps a source the cook already has, and says so', () => {
        expect(plan(`2 eggs\n${ALLRECIPES}`, { current: withLink('https://www.bbcgoodfood.com/x') })).toEqual({
            note: { kind: 'keptExisting', site: 'bbcgoodfood.com' },
        });
    });

    it('leaves out a Commise link with a note, and sets nothing', () => {
        expect(plan('2 eggs\nhttps://commise.app/en/recipes/9')).toEqual({ note: { kind: 'ownSiteLeftOut' } });
    });

    it('does nothing for text with no link line', () => {
        expect(plan('2 eggs')).toEqual({});
    });

    it('does not bring back a link the cook removed in this session', () => {
        expect(plan(`2 eggs\n${ALLRECIPES}`, { removed: ALLRECIPES })).toEqual({});
    });

    it('sets nothing on a recipe whose source is locked, and says it can’t change', () => {
        expect(
            plan(`2 eggs\n${ALLRECIPES}`, {
                recipe: webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST }),
            }),
        ).toEqual({ note: { kind: 'locked' } });
    });

    it('sets nothing on a clone that inherited a web source (cloning is not a way to relabel)', () => {
        expect(plan(`2 eggs\n${ALLRECIPES}`, { recipe: webCopy({ clonedFromId: CLONE_OF }) })).toEqual({
            note: { kind: 'locked' },
        });
    });
});

describe('sourceRowOf: every state of the Source row', () => {
    const row = (
        values = makeRecipeFormValues(),
        recipe = undefined as ReturnType<typeof makeRecipeDetail> | undefined,
    ) => sourceRowOf({ values, recipe, fromPaste: false });

    it('empty: the field with its hint and no Remove', () => {
        expect(row()).toEqual({ kind: 'empty', text: '' });
    });

    it('filled: the site, and no error', () => {
        expect(row(withLink(ALLRECIPES))).toEqual({
            kind: 'filled',
            text: ALLRECIPES,
            site: 'allrecipes.com',
            fromPaste: false,
        });
    });

    it('filled from a paste says so', () => {
        expect(sourceRowOf({ values: withLink(ALLRECIPES), recipe: undefined, fromPaste: true })).toMatchObject({
            kind: 'filled',
            fromPaste: true,
        });
    });

    it('invalid: not a web link', () => {
        expect(row(withLink('soup'))).toEqual({ kind: 'invalid', text: 'soup' });
    });

    it('ownSite: a Commise link', () => {
        expect(row(withLink('https://commise.app/en'))).toEqual({ kind: 'ownSite', text: 'https://commise.app/en' });
    });

    it('locked: the site link and the URL, read only', () => {
        expect(row(withLink(ALLRECIPES), webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST }))).toEqual(
            { kind: 'locked', site: 'allrecipes.com', url: ALLRECIPES },
        );
    });

    it('locked: a clone keeps the web source it inherited, read only', () => {
        expect(row(makeRecipeFormValues(), webCopy({ clonedFromId: CLONE_OF }))).toEqual({
            kind: 'locked',
            site: 'allrecipes.com',
            url: ALLRECIPES,
        });
    });

    it('hidden: published with no source', () => {
        expect(
            row(makeRecipeFormValues(), makeRecipeDetail({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST })),
        ).toEqual({ kind: 'hidden' });
    });

    it('hidden: a source the cook did not state through a link (the curator’s text, a book), even on a draft', () => {
        const curator = makeRecipeDetail({
            status: RecipeStatus.DRAFT,
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            sourceUrl: 'https://gutenberg.org/x',
        });
        const book = makeRecipeDetail({
            status: RecipeStatus.DRAFT,
            sourceType: RecipeSourceType.IMPORTED_PHYSICAL,
            sourceKind: 'book',
        });

        expect(row(makeRecipeFormValues(), curator)).toEqual({ kind: 'hidden' });
        expect(row(makeRecipeFormValues(), book)).toEqual({ kind: 'hidden' });
    });

    it('a never-published stored recipe still edits its source', () => {
        expect(row(withLink(ALLRECIPES), webCopy())).toMatchObject({ kind: 'filled' });
    });
});
