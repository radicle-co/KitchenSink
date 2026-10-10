/**
 * The editor's intents (`editorIntents.ts`): the recipe write a checkpoint submits, and what a Discard withdraws and
 * deletes — including code-reviewer High 1, a parked create that must never leave a delete waiting for it.
 */
import { RecipeStatus } from '@kitchensink/recipe-core';
import type { FailureClass } from '@kitchensink/sync';
import { describe, expect, it } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import { toRecipeFormValues } from '../../form/wire.js';
import type { RecipeLifecycle } from '../checkpointPolicy.js';
import { seedEditorCore, type ServerFacts } from '../editorCore.js';
import { discardPlanOf, recipeWriteIntent } from '../editorIntents.js';
import type { OutstandingWrite } from '../writeLane.js';

const LOCAL = 'local:recipe:01J0000000000000000000000A';
const unsaved: ServerFacts = { kind: 'unsaved', ref: LOCAL, baseVersion: null };
const stored = (status: RecipeStatus = RecipeStatus.DRAFT): ServerFacts =>
    seedEditorCore({ recipe: makeRecipeDetail({ id: 'rec_1', currentVersion: 4, status }) }).core.server;
const write = (over: Partial<OutstandingWrite>): OutstandingWrite => ({
    seq: 7,
    kind: 'create',
    sent: defaultRecipeFormValues(),
    finishing: false,
    parked: false,
    ...over,
});

describe('recipeWriteIntent', () => {
    const draft = { ...toRecipeFormValues(makeRecipeDetail({ id: 'rec_1' })), title: 'Soup' };

    it('a recipe the server has never stored is created under its local ref, as a draft unless it publishes', () => {
        const intent = recipeWriteIntent({ server: unsaved, draft, ref: LOCAL, publish: false });

        expect(intent).toMatchObject({
            entity: 'recipe',
            intentKind: 'create',
            localId: LOCAL,
            produces: LOCAL,
            dependsOn: [],
        });
        expect(intent.payload).toMatchObject({ input: { title: 'Soup', status: RecipeStatus.DRAFT } });
        expect(recipeWriteIntent({ server: unsaved, draft, ref: LOCAL, publish: true }).payload).toMatchObject({
            input: { status: RecipeStatus.PUBLISHED },
        });
    });

    it('a stored recipe is updated by its id at the version the editor holds; only a Publish states a status', () => {
        const intent = recipeWriteIntent({ server: stored(), draft, ref: 'rec_1', publish: false });

        expect(intent).toMatchObject({ intentKind: 'update', localId: 'rec_1', dependsOn: [] });
        expect(intent.payload).toMatchObject({ id: 'rec_1', input: { title: 'Soup', expectedVersion: 4 } });
        expect(intent.payload).not.toHaveProperty('input.status');
        expect(recipeWriteIntent({ server: stored(), draft, ref: 'rec_1', publish: true }).payload).toMatchObject({
            input: { status: RecipeStatus.PUBLISHED },
        });
    });
});

describe('discardPlanOf', () => {
    function plan(
        lifecycle: RecipeLifecycle,
        server: ServerFacts,
        outstanding?: OutstandingWrite,
        parkedFailure?: FailureClass,
    ) {
        return discardPlanOf({ lifecycle, server, ref: server.ref, outstanding, parkedFailure });
    }

    it('a published recipe: only its device changes go, and the cook returns to it', () => {
        expect(plan('published', stored(RecipeStatus.PUBLISHED))).toEqual({
            draftRef: 'rec_1',
            withdraw: undefined,
            remove: undefined,
            mayLeaveServerCopy: false,
            exit: { kind: 'leftForRecipe', recipeId: 'rec_1' },
        });
    });

    /**
     * REWRITTEN (finding 2 of the 2026-10-10 review): a recipe the server may not hold yet is asked of the outbox
     * whether this lane saw a create or not — another editor of the recipe may have queued one this lane never saw.
     * The outbox drops a delete nothing can address, so "nothing sent" still sends nothing (`outboxLog.test.ts`).
     */
    it.each([
        ['nothing sent from this editor', undefined],
        ['a create on its way (queued or on the wire)', write({})],
    ])('a new recipe with %s: the delete of its local ref is asked of the outbox', (_case, outstanding) => {
        expect(plan('unsaved', unsaved, outstanding)).toEqual({
            draftRef: LOCAL,
            withdraw: undefined,
            remove: {
                kind: 'ofCreate',
                intent: {
                    entity: 'recipe',
                    intentKind: 'delete',
                    localId: LOCAL,
                    dependsOn: [LOCAL],
                    payload: { id: LOCAL },
                },
            },
            mayLeaveServerCopy: false,
            exit: { kind: 'discarded' },
        });
    });

    it.each<FailureClass>(['transient', 'terminal', 'conflict'])(
        'a %s parked create: withdrawn, NO delete (it would wait forever), nothing to warn of',
        (failure) => {
            expect(plan('unsaved', unsaved, write({ parked: true }), failure)).toMatchObject({
                withdraw: 7,
                remove: undefined,
                mayLeaveServerCopy: false,
            });
        },
    );

    it('a parked create whose outcome is unknown: withdrawn, no delete, and the cook must be told it may exist', () => {
        expect(plan('unsaved', unsaved, write({ parked: true }), 'unknown')).toMatchObject({
            withdraw: 7,
            remove: undefined,
            mayLeaveServerCopy: true,
        });
    });

    it('a stored draft: deleted by its id, after any parked update is withdrawn', () => {
        const expected = {
            kind: 'byId',
            intent: {
                entity: 'recipe',
                intentKind: 'delete',
                localId: 'rec_1',
                dependsOn: [],
                payload: { id: 'rec_1' },
            },
        };

        expect(plan('neverPublished', stored())).toMatchObject({ withdraw: undefined, remove: expected });
        expect(plan('neverPublished', stored(), write({ kind: 'update', parked: true }), 'unknown')).toMatchObject({
            withdraw: 7,
            remove: expected,
            mayLeaveServerCopy: false,
        });
    });
});
