/**
 * The recipe write for a draft with a Source (ADR-0089): the create is sent Private (the server refuses a web copy that is
 * public), and an update carries only a change of source, also after the first publish.
 */
import { RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { toRecipeFormValues } from '../../form/wire.js';
import { seedEditorCore, type ServerFacts } from '../editorCore.js';
import { recipeWriteIntent, rowAnswerRidesWrite } from '../editorIntents.js';

const LOCAL = 'local:recipe:01J0000000000000000000000A';
const ALLRECIPES = 'https://www.allrecipes.com/recipe/1/soup/';
const unsaved: ServerFacts = { kind: 'unsaved', ref: LOCAL, baseVersion: null };
const storedOf = (over = {}): ServerFacts =>
    seedEditorCore({
        recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 4, status: RecipeStatus.DRAFT, ...over }),
    }).core.server;
const draft = (over = {}) => ({
    ...toRecipeFormValues(makeRecipeDetail({ id: 'rec_1' })),
    title: 'Soup',
    visibility: RecipeVisibility.PUBLIC,
    ...over,
});
const payloadOf = (intent: ReturnType<typeof recipeWriteIntent>) => intent.payload;

/** The body's `statement`, read without a cast: the payload is opaque to the log. */
const bodyStatementOf = (input: Parameters<typeof recipeWriteIntent>[0]): unknown => {
    const { payload } = recipeWriteIntent(input);
    const body = typeof payload === 'object' && payload !== null && 'input' in payload ? payload.input : undefined;

    return typeof body === 'object' && body !== null && 'statement' in body ? body.statement : undefined;
};

describe('a create with a Source', () => {
    it('carries the statement, and goes out Private although the cook chose Public', () => {
        const payload = payloadOf(
            recipeWriteIntent({
                server: unsaved,
                draft: draft({ sourceLink: ALLRECIPES }),
                ref: LOCAL,
                publish: false,
                privateRefusal: undefined,
            }),
        );

        expect(payload).toMatchObject({
            input: { statement: { kind: 'public_web', citation: ALLRECIPES }, visibility: RecipeVisibility.PRIVATE },
        });
    });

    it('goes out Private even when every slot is used and a Publish would be refused (a draft takes no slot)', () => {
        expect(
            payloadOf(
                recipeWriteIntent({
                    server: unsaved,
                    draft: draft({ sourceLink: ALLRECIPES }),
                    ref: LOCAL,
                    publish: false,
                    privateRefusal: 'slots',
                }),
            ),
        ).toMatchObject({ input: { visibility: RecipeVisibility.PRIVATE } });
    });

    it('is unchanged without a Source: the cook’s Public stays Public', () => {
        const payload = payloadOf(
            recipeWriteIntent({
                server: unsaved,
                draft: draft(),
                ref: LOCAL,
                publish: false,
                privateRefusal: undefined,
            }),
        );

        expect(payload).toMatchObject({ input: { visibility: RecipeVisibility.PUBLIC } });
        expect(payload).not.toHaveProperty('input.statement');
    });
});

describe('an update with a Source', () => {
    it('sends a new link before the first publish', () => {
        const payload = payloadOf(
            recipeWriteIntent({
                server: storedOf(),
                draft: draft({ sourceLink: ALLRECIPES }),
                ref: 'rec_1',
                publish: false,
                privateRefusal: undefined,
            }),
        );

        expect(payload).toMatchObject({
            input: { statement: { kind: 'public_web', citation: ALLRECIPES }, expectedVersion: 4 },
        });
    });

    it('removes a stored web source with null when the cook took it off', () => {
        const server = storedOf({
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            sourceKind: 'public_web',
            sourceUrl: ALLRECIPES,
        });
        const payload = payloadOf(
            recipeWriteIntent({ server, draft: draft(), ref: 'rec_1', publish: false, privateRefusal: undefined }),
        );

        expect(payload).toHaveProperty('input.statement', null);
    });

    // Rewritten by the 2026-11-15 owner ruling: it said no statement is sent once the recipe has been published. The first
    // publish does not lock the statement, so a published recipe sends the cook's link; an inherited source still sends none.
    it('sends the statement once the recipe has been published', () => {
        const payload = payloadOf(
            recipeWriteIntent({
                server: storedOf({ status: RecipeStatus.PUBLISHED, firstPublishedAt: '2026-11-01T00:00:00.000Z' }),
                draft: draft({ sourceLink: ALLRECIPES }),
                ref: 'rec_1',
                publish: false,
                privateRefusal: undefined,
            }),
        );

        expect(payload).toHaveProperty('input.statement.citation', ALLRECIPES);
    });

    it('sends no statement for a published recipe whose source a clone inherited', () => {
        const payload = payloadOf(
            recipeWriteIntent({
                server: storedOf({
                    status: RecipeStatus.PUBLISHED,
                    firstPublishedAt: '2026-11-01T00:00:00.000Z',
                    clonedFromId: '00000000-0000-4000-8000-0000000000c1',
                    sourceType: 'imported_public',
                    sourceKind: 'public_web',
                    sourceUrl: ALLRECIPES,
                }),
                draft: draft({ sourceLink: 'https://www.bbcgoodfood.com/recipes/soup' }),
                ref: 'rec_1',
                publish: false,
                privateRefusal: undefined,
            }),
        );

        expect(payload).not.toHaveProperty('input.statement');
    });
});

describe('rowAnswerRidesWrite: whether the Source row\u2019s answer is what the write says about the source', () => {
    const paid = {
        kind: 'paid_site',
        citation: 'Sam',
        wording: { version: 'statementPaidSite.v1', locale: 'en' },
    } as const;
    const book = {
        kind: 'book',
        citation: 'Salt Fat Acid Heat',
        wording: { version: 'statementBook.v2', locale: 'en' },
    } as const;
    const person = { kind: 'fromPerson', wording: { version: 'statementFromPerson.v2', locale: 'en' } } as const;
    const input = (server: ServerFacts, publish: boolean, shown?: { statement?: typeof paid | typeof book }) => ({
        server,
        draft: draft(),
        ref: LOCAL,
        publish,
        privateRefusal: undefined,
        shown: { rowStatement: person, ...shown },
    });

    const cases = [
        ['an update, no Publish answer held', storedOf(), false, undefined, true],
        [
            'an update, a paid-site Publish answer the server does not hold yet (it outranks the row)',
            storedOf(),
            false,
            paid,
            false,
        ],
        [
            'an update, a paid-site Publish answer the server already holds (it rides no more)',
            storedOf({ sourceKind: 'paid_site' }),
            false,
            paid,
            true,
        ],
        ['a draft update, a book Publish answer (it rides only a publish)', storedOf(), false, book, true],
        ['a publishing update, a book Publish answer (it outranks the row)', storedOf(), true, book, false],
        ['a create, no Publish answer held', unsaved, false, undefined, true],
        ['a create, a paid-site Publish answer (it outranks the row)', unsaved, false, paid, false],
        ['a publishing create, a book Publish answer (it outranks the row)', unsaved, true, book, false],
    ] as const;
    const inputOf = (server: ServerFacts, publish: boolean, statement: typeof paid | typeof book | undefined) =>
        input(server, publish, statement === undefined ? {} : { statement });

    it.each(cases)('%s: %s', (_name, server, publish, statement, rides) => {
        expect(rowAnswerRidesWrite(inputOf(server, publish, statement))).toBe(rides);
    });

    // Ties the rule to the wire's own precedence chains: reorder one and this goes red.
    it.each(cases)(
        '%s: the body says the row\u2019s statement exactly when the rule says so',
        (_name, server, publish, statement) => {
            const x = inputOf(server, publish, statement);

            expect(bodyStatementOf(x) === person).toBe(rowAnswerRidesWrite(x));
        },
    );

    it('the one exception: a cleared row (null) on a create sends nothing, and still rides', () => {
        const x = { ...input(unsaved, false), shown: { rowStatement: null } };

        expect(bodyStatementOf(x)).toBeUndefined();
        expect(rowAnswerRidesWrite(x)).toBe(true);
    });

    it('a write built from no shown wordings carries the row\u2019s answer (there is nothing that outranks it)', () => {
        expect(rowAnswerRidesWrite({ ...input(unsaved, false), shown: undefined })).toBe(true);
    });
});
