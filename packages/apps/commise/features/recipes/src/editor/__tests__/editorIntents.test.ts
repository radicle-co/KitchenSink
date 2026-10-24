/**
 * The editor's intents (`editorIntents.ts`): the recipe write a checkpoint submits, and what a Discard withdraws and
 * deletes — including code-reviewer High 1, a parked create that must never leave a delete waiting for it.
 */
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
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
        const intent = recipeWriteIntent({
            server: unsaved,
            draft,
            ref: LOCAL,
            publish: false,
            privateRefusal: undefined,
        });

        expect(intent).toMatchObject({
            entity: 'recipe',
            intentKind: 'create',
            localId: LOCAL,
            produces: LOCAL,
            dependsOn: [],
        });
        expect(intent.payload).toMatchObject({ input: { title: 'Soup', status: RecipeStatus.DRAFT } });
        expect(
            recipeWriteIntent({ server: unsaved, draft, ref: LOCAL, publish: true, privateRefusal: undefined }).payload,
        ).toMatchObject({
            input: { status: RecipeStatus.PUBLISHED },
        });
    });

    it('a stored recipe is updated by its id at the version the editor holds; only a Publish states a status', () => {
        const intent = recipeWriteIntent({
            server: stored(),
            draft,
            ref: 'rec_1',
            publish: false,
            privateRefusal: undefined,
        });

        expect(intent).toMatchObject({ intentKind: 'update', localId: 'rec_1', dependsOn: [] });
        expect(intent.payload).toMatchObject({ id: 'rec_1', input: { title: 'Soup', expectedVersion: 4 } });
        expect(intent.payload).not.toHaveProperty('input.status');
        expect(
            recipeWriteIntent({ server: stored(), draft, ref: 'rec_1', publish: true, privateRefusal: undefined })
                .payload,
        ).toMatchObject({
            input: { status: RecipeStatus.PUBLISHED },
        });
    });
});

/**
 * A create is the only queued write that carries visibility (an update never does: it follows through its own endpoint).
 * A create carrying a Private the server is known to refuse parked behind a Try again that could never succeed — the
 * stuck save. It goes out public instead: a draft is the owner's alone whatever its visibility, and the publish-time
 * follow-up says why it stayed public. Try again builds a fresh intent from the draft, so a parked one heals too.
 */
describe('recipeWriteIntent — a create never carries a refused Private', () => {
    const privateDraft = {
        ...toRecipeFormValues(makeRecipeDetail({ id: 'rec_1' })),
        visibility: RecipeVisibility.PRIVATE,
    };

    it.each(['final', 'premium'] as const)(
        'under a %s refusal, a private draft is created public',
        (privateRefusal) => {
            const intent = recipeWriteIntent({
                server: unsaved,
                draft: privateDraft,
                ref: LOCAL,
                publish: false,
                privateRefusal,
            });

            expect(intent.payload).toMatchObject({ input: { visibility: RecipeVisibility.PUBLIC } });
        },
    );

    it('with no known refusal, a private draft is created private', () => {
        const intent = recipeWriteIntent({
            server: unsaved,
            draft: privateDraft,
            ref: LOCAL,
            publish: false,
            privateRefusal: undefined,
        });

        expect(intent.payload).toMatchObject({ input: { visibility: RecipeVisibility.PRIVATE } });
    });

    it('a public draft is created public under any refusal', () => {
        const publicDraft = { ...privateDraft, visibility: RecipeVisibility.PUBLIC };

        for (const privateRefusal of ['final', 'premium', undefined] as const) {
            expect(
                recipeWriteIntent({ server: unsaved, draft: publicDraft, ref: LOCAL, publish: true, privateRefusal })
                    .payload,
            ).toMatchObject({ input: { visibility: RecipeVisibility.PUBLIC } });
        }
    });
});

describe('discardPlanOf', () => {
    function plan(
        lifecycle: RecipeLifecycle,
        server: ServerFacts,
        outstanding?: OutstandingWrite,
        parkedFailure?: FailureClass,
        parkedResends = false,
    ) {
        return discardPlanOf({ lifecycle, server, ref: server.ref, outstanding, parkedFailure, parkedResends });
    }

    it('a published recipe: only its device changes go, and the cook returns to it', () => {
        expect(plan('published', stored(RecipeStatus.PUBLISHED))).toEqual({
            draftRef: 'rec_1',
            withdraw: undefined,
            remove: undefined,
            mayLeaveServerCopy: false,
            savedChangesMayStand: false,
            exit: { kind: 'leftForRecipe', recipeId: 'rec_1' },
        });
    });

    /**
     * ⛔ A PUBLISHED RECIPE'S PARKED SAVE CHANGES DOES NOT OUTLIVE THE DISCARD. The plan used to answer `withdraw:
     * undefined` for every published recipe, so an earlier Save changes that parked stayed in the outbox for ever, and
     * "Syncing 1" with it. The cook's confirmed Discard is the consent to withdraw it. Whether its changes may already
     * stand is the confirm's business: an unknown outcome might have landed (`savedChangesMayStand`).
     *
     * REWRITTEN (GATE round 3): ⛔ A PARKED WRITE A DRAIN RE-SENDS BY ITSELF MAY STAND TOO. A `401` resumes when the cook
     * signs in and a transient refusal is retried (`resendsWhenParked`), so either can be claimed and land between the
     * confirm and the act. The confirm said "stays as it was" for them; it may promise that only for a write that waits
     * for the cook (a conflict, a terminal refusal).
     */
    it.each<[string, OutstandingWrite | undefined, FailureClass | undefined, boolean, number | undefined, boolean]>([
        ['nothing outstanding', undefined, undefined, false, undefined, false],
        [
            'an update on its way (pending or on the wire): left alone',
            write({ kind: 'update' }),
            undefined,
            false,
            undefined,
            false,
        ],
        ['a parked update, outcome unknown', write({ kind: 'update', parked: true }), 'unknown', false, 7, true],
        ['a parked update, refused', write({ kind: 'update', parked: true }), 'terminal', false, 7, false],
        [
            'a parked update its signed-out cook never sent (401, resent at sign-in)',
            write({ kind: 'update', parked: true }),
            'terminal',
            true,
            7,
            true,
        ],
        [
            'a parked update refused transiently (resent by a drain)',
            write({ kind: 'update', parked: true }),
            'transient',
            true,
            7,
            true,
        ],
        ['a parked update, conflict', write({ kind: 'update', parked: true }), 'conflict', false, 7, false],
    ])('a published recipe with %s', (_case, outstanding, failure, resends, withdraw, mayStand) => {
        expect(plan('published', stored(RecipeStatus.PUBLISHED), outstanding, failure, resends)).toMatchObject({
            withdraw,
            remove: undefined,
            savedChangesMayStand: mayStand,
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
            savedChangesMayStand: false,
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

    /**
     * ⛔ GATE round 3: a parked create a drain re-sends by itself (`401` at sign-in, a transient refusal) may be claimed
     * between the confirm and the Discard's act, and then make the recipe on the server. The confirm says it may exist.
     */
    it.each<FailureClass>(['transient', 'terminal'])(
        'a %s parked create a drain re-sends by itself: withdrawn, no delete, and the cook is told it may exist',
        (failure) => {
            expect(plan('unsaved', unsaved, write({ parked: true }), failure, true)).toMatchObject({
                withdraw: 7,
                remove: undefined,
                mayLeaveServerCopy: true,
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
