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
    isLinkOnly,
    pastedSourcePlanOf,
    publicHeldOf,
    sourceRowOf,
    sourceStatementOf,
} from '../sourceLink.js';

const ALLRECIPES = 'https://www.allrecipes.com/recipe/1/soup/';
const withLink = (sourceLink: string, over = {}) => makeRecipeFormValues({ sourceLink, ...over });
/** The first-publish instant a published recipe always carries. The lock reads none of it (ADR-0093 section 8). */
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

describe('publicHeldOf', () => {
    it('is false before the first save, and for a recipe holding no source', () => {
        expect(publicHeldOf(makeRecipeFormValues(), undefined)).toBe(false);
        expect(publicHeldOf(makeRecipeFormValues(), makeRecipeDetail())).toBe(false);
    });

    it('is true when the server says the recipe is held, whatever the draft says', () => {
        expect(publicHeldOf(makeRecipeFormValues(), makeRecipeDetail({ publicNeedsCheck: true }))).toBe(true);
        expect(publicHeldOf(withLink(ALLRECIPES), makeRecipeDetail({ publicNeedsCheck: true }))).toBe(true);
    });

    it('is true for a stored web source whose draft source was removed: the source stays on record', () => {
        expect(publicHeldOf(makeRecipeFormValues(), webCopy())).toBe(true);
        expect(publicHeldOf(withLink('   '), webCopy())).toBe(true);
    });

    it('is false while the draft still holds the stored link (the link rule answers, not this one)', () => {
        expect(publicHeldOf(withLink(ALLRECIPES), webCopy())).toBe(false);
    });

    it('is true for a stored book source with no draft source', () => {
        expect(
            publicHeldOf(
                makeRecipeFormValues(),
                makeRecipeDetail({ sourceType: RecipeSourceType.IMPORTED_PHYSICAL, sourceKind: 'book' }),
            ),
        ).toBe(true);
    });
});

describe('derivedVisibility', () => {
    it('is Private for a recipe the stored source holds out of Public, though the cook chose Public', () => {
        const values = makeRecipeFormValues({ visibility: RecipeVisibility.PUBLIC });

        expect(derivedVisibility(values, webCopy())).toBe(RecipeVisibility.PRIVATE);
        expect(derivedVisibility(values, makeRecipeDetail({ publicNeedsCheck: true }))).toBe(RecipeVisibility.PRIVATE);
        expect(derivedVisibility(values, makeRecipeDetail())).toBe(RecipeVisibility.PUBLIC);
    });

    it('is Private for a draft with a source link, whatever the cook chose', () => {
        expect(derivedVisibility(withLink(ALLRECIPES, { visibility: RecipeVisibility.PUBLIC }), undefined)).toBe(
            RecipeVisibility.PRIVATE,
        );
    });

    it('is the cook’s choice with no link, so removing the link restores it', () => {
        expect(derivedVisibility(makeRecipeFormValues({ visibility: RecipeVisibility.PUBLIC }), undefined)).toBe(
            RecipeVisibility.PUBLIC,
        );
    });

    it('is the cook’s choice while the text is not yet a link', () => {
        expect(derivedVisibility(withLink('https://', { visibility: RecipeVisibility.PUBLIC }), undefined)).toBe(
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

    /** Rewrites the earlier tests that asserted a built-in English wording: the wording is the caller's input. */
    it('create: the wording the caller gives is sent as given, in any locale', () => {
        const wording = { version: 'statementPublicWeb.v1', locale: 'fr' } as const;

        expect(sourceStatementOf(withLink(ALLRECIPES), undefined, wording)).toEqual({
            kind: 'public_web',
            citation: ALLRECIPES,
            wording,
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

    // Rewritten by the 2026-11-15 owner ruling: it said nothing is sent once the recipe has been published. The cook's
    // statement stays editable after the first publish, so a published recipe sends its change like any other.
    it('update: a published recipe sends its change, because the first publish does not lock the statement', () => {
        const published = webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST });

        expect(sourceStatementOf(makeRecipeFormValues(), published)).toBeNull();
        expect(sourceStatementOf(withLink('https://other.example/a'), published)).toEqual({
            kind: 'public_web',
            citation: 'https://other.example/a',
        });
        expect(
            sourceStatementOf(
                withLink('https://other.example/a'),
                makeRecipeDetail({ status: RecipeStatus.DRAFT, firstPublishedAt: FIRST }),
            ),
        ).toMatchObject({ kind: 'public_web' });
    });

    it('update: a published recipe whose source is locked for another reason sends nothing', () => {
        const inherited = webCopy({
            status: RecipeStatus.PUBLISHED,
            firstPublishedAt: FIRST,
            clonedFromId: CLONE_OF,
        });

        expect(sourceStatementOf(withLink('https://other.example/a'), inherited)).toBeUndefined();
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
                recipe: webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST, clonedFromId: CLONE_OF }),
            }),
        ).toEqual({ note: { kind: 'locked' } });
    });

    // Rewritten by the 2026-11-15 owner ruling: a published recipe used to answer `locked` here.
    it('fills an empty Source on a published recipe: the first publish does not lock it', () => {
        expect(
            plan(`2 eggs\n${ALLRECIPES}`, {
                recipe: makeRecipeDetail({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST }),
            }),
        ).toEqual({ set: ALLRECIPES, note: { kind: 'set', site: 'allrecipes.com' } });
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
    ) => sourceRowOf({ values, recipe, fromPaste: false, showError: true });

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
        expect(
            sourceRowOf({ values: withLink(ALLRECIPES), recipe: undefined, fromPaste: true, showError: true }),
        ).toMatchObject({
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

    // Rewritten by the 2026-11-15 owner ruling: a published web copy used to be locked, read only. It is a filled field now.
    it('a published web copy is a filled field the cook can still change', () => {
        expect(
            row(withLink(ALLRECIPES), webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST })),
        ).toMatchObject({ kind: 'filled', site: 'allrecipes.com' });
    });

    it('locked: a published clone keeps the web source it inherited, read only', () => {
        expect(
            row(
                withLink(ALLRECIPES),
                webCopy({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST, clonedFromId: CLONE_OF }),
            ),
        ).toEqual({ kind: 'locked', site: 'allrecipes.com', url: ALLRECIPES });
    });

    it('locked: a clone keeps the web source it inherited, read only', () => {
        expect(row(makeRecipeFormValues(), webCopy({ clonedFromId: CLONE_OF }))).toEqual({
            kind: 'locked',
            site: 'allrecipes.com',
            url: ALLRECIPES,
        });
    });

    // Rewritten by the 2026-11-15 owner ruling: a published recipe with no source was hidden. The cook can state one after
    // the first publish, so the row is the empty field.
    it('empty: a published recipe with no source still offers the field', () => {
        expect(
            row(makeRecipeFormValues(), makeRecipeDetail({ status: RecipeStatus.PUBLISHED, firstPublishedAt: FIRST })),
        ).toEqual({ kind: 'empty', text: '' });
    });

    it('hidden: a published recipe with the curator’s text', () => {
        expect(
            row(
                makeRecipeFormValues(),
                makeRecipeDetail({
                    status: RecipeStatus.PUBLISHED,
                    firstPublishedAt: FIRST,
                    sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                }),
            ),
        ).toEqual({ kind: 'hidden' });
    });

    it('hidden: the curator’s text, even on a draft; a book on a draft is correctable (migration 0088), so its row is not hidden', () => {
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
        expect(row(makeRecipeFormValues(), book)).toEqual({ kind: 'empty', text: '' });
    });

    it('a stored recipe still edits its source', () => {
        expect(row(withLink(ALLRECIPES), webCopy())).toMatchObject({ kind: 'filled' });
    });
});

describe('sourceRowOf: a paid website is locked, with no link', () => {
    const paid = makeRecipeDetail({
        status: RecipeStatus.DRAFT,
        sourceType: RecipeSourceType.IMPORTED_PAID,
        sourceKind: 'paid_site',
        sourceAttribution: 'Sam’s Subscription Kitchen',
    });

    it('a saved paid-site recipe shows its citation, not the hidden row', () => {
        expect(
            sourceRowOf({ values: makeRecipeFormValues(), recipe: paid, fromPaste: false, showError: true }),
        ).toEqual({ kind: 'lockedCitation', citation: 'Sam’s Subscription Kitchen' });
    });

    it('a citation the cook has just confirmed locks the row before any write', () => {
        expect(
            sourceRowOf({
                values: makeRecipeFormValues(),
                recipe: undefined,
                fromPaste: false,
                showError: false,
                paidSiteStated: 'Sam’s Subscription Kitchen',
            }),
        ).toEqual({ kind: 'lockedCitation', citation: 'Sam’s Subscription Kitchen' });
    });

    it('a locked web copy with an address keeps its linked row, and the curator’s text stays hidden', () => {
        const web = makeRecipeDetail({
            status: RecipeStatus.DRAFT,
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            sourceKind: 'public_web',
            sourceUrl: ALLRECIPES,
            clonedFromId: CLONE_OF,
        });

        expect(
            sourceRowOf({ values: makeRecipeFormValues(), recipe: web, fromPaste: false, showError: true }),
        ).toMatchObject({ kind: 'locked', site: 'allrecipes.com' });
        expect(
            sourceRowOf({
                values: makeRecipeFormValues(),
                recipe: makeRecipeDetail({ sourceType: RecipeSourceType.IMPORTED_PUBLIC }),
                fromPaste: false,
                showError: true,
            }),
        ).toEqual({ kind: 'hidden' });
    });
});

describe('sourceRowOf: an error is shown after the cook is done typing, not while they type', () => {
    const row = (values: ReturnType<typeof withLink>, showError: boolean) =>
        sourceRowOf({ values, recipe: undefined, fromPaste: false, showError });

    it('text that is not yet a link reads as plain text while typing', () => {
        expect(row(withLink('https://exa'), false)).toEqual({ kind: 'empty', text: 'https://exa' });
        expect(row(withLink('https://commise.app/en'), false)).toEqual({
            kind: 'empty',
            text: 'https://commise.app/en',
        });
    });

    it('the same text is the error once the cook has left the field or tried to Publish', () => {
        expect(row(withLink('https://exa'), true)).toEqual({ kind: 'invalid', text: 'https://exa' });
        expect(row(withLink('https://commise.app/en'), true)).toEqual({
            kind: 'ownSite',
            text: 'https://commise.app/en',
        });
    });

    it('a usable link is filled either way', () => {
        expect(row(withLink(ALLRECIPES), false)).toMatchObject({ kind: 'filled' });
    });
});

describe('isLinkOnly: a paste that is nothing but a link', () => {
    it('is true for a link with no other text, and for a link and blank lines', () => {
        expect(isLinkOnly(extractSourceLink(ALLRECIPES))).toBe(true);
        expect(isLinkOnly(extractSourceLink(`Source: ${ALLRECIPES}\n\n  \n`))).toBe(true);
    });

    it('is false with text beside the link, with no link, or with only a Commise link', () => {
        expect(isLinkOnly(extractSourceLink(`2 eggs\n${ALLRECIPES}`))).toBe(false);
        expect(isLinkOnly(extractSourceLink('2 eggs'))).toBe(false);
        expect(isLinkOnly(extractSourceLink('https://commise.app/en/recipes/1'))).toBe(false);
    });
});
