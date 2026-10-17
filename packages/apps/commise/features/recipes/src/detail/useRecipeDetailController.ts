'use client';

/**
 * @module @commise/features-recipes/detail — `useRecipeDetailController`: everything the recipe page DECIDES and DOES, for
 * both apps. The web container and the mobile screen each held ~110 lines of it (the Private gate, the make-public
 * confirm, the visibility notice, ownership and clone, the ⋯ menu, the rating block, the three owner dialogs), and the two
 * had drifted. What stays in an app is what is truly its own: the read, the layout, the router and the transport of a
 * finished-editor refusal.
 *
 * The viewer is one fact with one rule on both platforms (owner ruling 2026-10-16): the signed session claim's
 * `external_id`, else the profile's `user.id` ({@link viewerIdOf}). With a claim in hand the body does not wait for the
 * profile; the paid features still come from the profile alone, so Make private appears when it lands.
 *
 * ⛔ The READ is the host's: this package does not depend on `@commise/query`, so the failed-refresh notices stay beside
 * the query in the app and are handed to the view directly.
 *
 * @pattern Humble Object — the hook holds every decision so the two thin shells only draw; Ports — the host supplies the
 *     profile read, the session claims and a navigation port (`RecipeDetailNav`) instead of this module importing a router.
 */
import { knownPaidFeaturesOf, paidFeatureStateOf, type ProfileQueryState } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import type { ActionMenuItem, ActionMenuProps } from '@commise/ui/action-menu';
import { RecipeVisibility, canClone, isOwner, makeViewer, type RecipeDetail } from '@kitchensink/recipe-core';
import {
    useCloneRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { useEffect, useState } from 'react';

import { recipeActionMessages } from '../actions/messages.js';
import { useGatedPrivate } from '../actions/useGatedPrivate.js';
import { useMakePublicConfirm } from '../actions/useMakePublicConfirm.js';
import { useServerRefusedPrivate } from '../actions/useServerRefusedPrivate.js';
import { visibilityNoticeOf } from '../actions/visibilityNotice.js';
import { ratingModeFor } from '../rating/model.js';
import { detailMenuOf, type DetailMenuItem } from './detailMenu.js';
import type { RecipeDetailDialogsProps } from './RecipeDetailDialogs.js';
import type { RecipeDetailRatingProps } from './RecipeDetailRating.js';
import { useCookMarks } from './useCookMarks.js';
import {
    claimedViewerIdOf,
    primaryOf,
    ratingErrorKindOf,
    viewerIdOf,
    viewerKnown,
} from './useRecipeDetailController.model.js';

/** The slice of the viewer's profile read the controller uses: the state the paid-feature adapters read, plus the id. */
export interface RecipeDetailProfile extends ProfileQueryState {
    /** Whether the first read is in flight. `false` for a signed-out viewer, whose query is disabled. */
    readonly isLoading: boolean;
}

/** Where the page goes. Each app supplies its own: a router push on web, a navigator callback on mobile. */
export interface RecipeDetailNav {
    /** Open the version history. Offered to the owner only. */
    readonly onVersions: () => void;
    /** A copy was made: open it (in the editor — a copy needs a real edit before it can be published, FR-005b). */
    readonly onCloned: (createdId: string) => void;
    /** The recipe was deleted: leave. How the cook is told (an address flag, a snackbar) is the app's. */
    readonly onDeleted: () => void;
}

/** Input to {@link useRecipeDetailController}. */
export interface RecipeDetailControllerInput {
    /** The recipe id of the route; the marks, the mutations and the refusal are keyed on it. */
    readonly id: string;
    /** The settled recipe. */
    readonly recipe: RecipeDetail;
    /** The signed session claims (untyped). */
    readonly sessionClaims: unknown;
    /** The viewer's profile read. */
    readonly profile: RecipeDetailProfile;
    /** Whether the finished editor's withheld-Private claim stands for THIS recipe (the app's transport decides). */
    readonly finishRefused: boolean;
    /** The route handed a withheld-Private claim that has not been seen yet (mobile). */
    readonly refusalArrived?: boolean;
    /** Called once the BODY has mounted with a claim waiting, never while the skeleton shows. */
    readonly onFinishRefusalSeen?: () => void;
    readonly nav: RecipeDetailNav;
    /**
     * A write of this recipe is on the wire (the host's `SyncQueue.entityInFlight`): Delete is unavailable until it
     * settles (owner ruling 2026-10-17, "Don't allow users to delete while saving"). REQUIRED, so a host cannot forget it.
     * The host reads it; this package does not depend on `@commise/query`.
     */
    readonly saving: boolean;
}

/** What the controller hands the shells. */
export interface RecipeDetailController {
    /** Whether the page knows who is looking. While `false` the shell draws its skeleton, not the body. */
    readonly ready: boolean;
    readonly viewerIsOwner: boolean;
    /** The sentence under the rating and visibility line, when there is one (§6.4). */
    readonly visibilityNotice: string | undefined;
    /** The action row's primary. */
    readonly primary: 'edit' | 'saveCopy' | undefined;
    /** Save a copy: whether it is in flight, and the command. */
    readonly clone: { readonly pending: boolean; readonly run: () => void };
    /** The ⋯ menu's props (the shell adds `appearance`), or `undefined` when it has nothing to offer. */
    readonly menu: Omit<ActionMenuProps, 'appearance'> | undefined;
    /** For `RecipeDetailRating`. */
    readonly rating: RecipeDetailRatingProps;
    /** For `RecipeDetailDialogs`. */
    readonly dialogs: RecipeDetailDialogsProps;
}

/**
 * The recipe page's controller.
 *
 * @param input - The recipe, the viewer's identity signals, the finish-refusal claim and the navigation port.
 * @returns The decided page: what to draw and the commands behind it.
 * @sideEffect Calls `onFinishRefusalSeen` once the body has mounted with a claim waiting; mutates through the recipe
 *     service hooks.
 */
export function useRecipeDetailController(input: RecipeDetailControllerInput): RecipeDetailController {
    const { id, recipe, sessionClaims, profile, finishRefused, refusalArrived, onFinishRefusalSeen, nav, saving } =
        input;
    const { detailActions, moreMenu, visibility: visibilityCopy } = useMessages(recipeActionMessages);
    const deleteRecipe = useDeleteRecipe();
    const setVisibility = useSetRecipeVisibility();
    const cloneRecipe = useCloneRecipe();
    const setRating = useSetRecipeRating();
    const deleteRating = useDeleteRecipeRating();
    // The view binds the cook's marks itself; the ⋯ menu reads the same marks to offer Clear checks.
    const marks = useCookMarks(id);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const viewerId = viewerIdOf(claimedViewerIdOf(sessionClaims), profile.data?.user.id);
    const ready = viewerKnown(viewerId, profile.isLoading);

    // §6.4: tell the route its claim was seen, once the body is on screen. The effect runs after the commit that mounts
    // the body, so the live region exists, empty, before the route's answer fills it. Never during the skeleton.
    useEffect(() => {
        if (ready && refusalArrived === true) {
            onFinishRefusalSeen?.();
        }
    }, [ready, refusalArrived, onFinishRefusalSeen]);

    // Plan 2026-10-14-009 D14: whether Make private is offered, and whether it applies or opens the Premium sheet, is
    // decided in ONE place, `useGatedPrivate`, from the viewer's paid features alone (owner ruling 2026-10-13).
    const privateGate = useGatedPrivate({
        state: paidFeatureStateOf(profile),
        saved: recipe.visibility,
        apply: () => setVisibility.mutate({ id, visibility: RecipeVisibility.PRIVATE }),
    });
    // Q5 (UX SPECIFY 2026-10-15): a downgraded owner confirms Make public first; the confirm stays up, busy, while the
    // change is in flight, and says a failure inside itself.
    const serverRefusedPrivate = useServerRefusedPrivate(id, knownPaidFeaturesOf(profile));
    // The confirm's words say what is KNOWN: a failed profile read is "may not", never "won't" (review).
    const makePublic = useMakePublicConfirm({
        state: knownPaidFeaturesOf(profile) ?? 'loading',
        saved: recipe.visibility,
        apply: (done) => setVisibility.mutate({ id, visibility: RecipeVisibility.PUBLIC }, { onSuccess: done }),
    });

    // P4: ONE Viewer value object feeds every gate below through the shared policy predicates (D7).
    const viewer = makeViewer({ id: viewerId });
    const viewerIsOwner = isOwner(recipe, viewer);
    const isPublic = recipe.visibility === RecipeVisibility.PUBLIC;
    // §6.4: ONE slot under the rating and visibility line says every refusal of a Private, and the generic failure. The
    // make-public confirm says its own failure inside itself, so it is not said twice.
    const visibilityNotice = visibilityNoticeOf(
        {
            viewerIsOwner,
            isPublic,
            serverRefusal: serverRefusedPrivate,
            finishRefused,
            known: knownPaidFeaturesOf(profile),
            writeFailed: setVisibility.error !== null && !makePublic.dialog.open,
        },
        visibilityCopy,
    );

    // §6.1/§6.4: the ⋯ menu's entries are decided once for both platforms (`detailMenuOf`).
    //
    // ⛔ The delete CONFIRMATION DIALOG does NOT live in the menu: it stays a sibling, so it survives the menu closing
    // while the dialog is open.
    const menu = detailMenuOf({
        owner: viewerIsOwner,
        isPublic,
        hasMarks: marks.hasMarks,
        offersPrivate: privateGate.offersPrivate,
    });

    const menuItem = (item: DetailMenuItem): ActionMenuItem => {
        switch (item) {
            case 'versions':
                return { id: item, label: detailActions.versionHistory, icon: 'clock', onSelect: nav.onVersions };
            case 'makePrivate':
                return { id: item, label: detailActions.makePrivate, icon: 'lock', onSelect: privateGate.request };
            case 'makePublic':
                return {
                    id: item,
                    label: detailActions.makePublic,
                    icon: 'globe',
                    // A fresh confirm starts clean: an earlier failure is not news to it (review S3).
                    onSelect: () => {
                        setVisibility.reset();
                        makePublic.request();
                    },
                };
            case 'clearChecks':
                return { id: item, label: detailActions.clearChecks, icon: 'rotateCcw', onSelect: marks.clear };
        }
    };

    const hasMenu = menu.items.length > 0 || menu.destructive !== undefined;

    // FR-013 ratings: the viewer may rate a recipe they can read and do NOT own (Sc8); the backend enforces the rest.
    // Set errors win over remove (only one is in flight at a time — the control disables its inputs while pending).
    const ratingError = setRating.error ?? deleteRating.error;

    return {
        ready,
        viewerIsOwner,
        visibilityNotice,
        // D7: a viewer may clone a PUBLIC recipe they do not own — the SAME `canClone` predicate on both platforms.
        primary: primaryOf({ viewerIsOwner, viewerCanClone: canClone(recipe, viewer) }),
        clone: {
            pending: cloneRecipe.isPending,
            run: () => cloneRecipe.mutate(id, { onSuccess: (created) => nav.onCloned(created.id) }),
        },
        menu: hasMenu
            ? {
                  triggerLabel: moreMenu.triggerFor.replace('{title}', recipe.title),
                  title: moreMenu.title,
                  closeLabel: moreMenu.close,
                  items: menu.items.map(menuItem),
                  ...(menu.destructive === undefined
                      ? {}
                      : {
                            destructiveItem: {
                                id: 'delete',
                                label: detailActions.deleteRecipe,
                                icon: 'trash',
                                onSelect: () => {
                                    if (!saving) {
                                        setDeleteOpen(true);
                                    }
                                },
                                ...(saving ? { unavailable: detailActions.saving } : {}),
                            },
                        }),
              }
            : undefined,
        rating: {
            mode: ratingModeFor({ viewerId, ownerId: recipe.ownerId }),
            average: recipe.averageRating,
            ratingCount: recipe.ratingCount,
            // The stars the input pre-selects: the server's `viewerRating` (DA4 — the rating hooks patch it
            // optimistically in the cache, so it never flickers back to the pre-write value before the refetch lands).
            selectedStars: recipe.viewerRating,
            pending: setRating.isPending || deleteRating.isPending,
            error: ratingErrorKindOf(ratingError),
            onRate: (stars) => setRating.mutate({ id, input: { stars } }),
            onRemove: () => deleteRating.mutate(id),
        },
        dialogs: {
            viewerIsOwner,
            recipeTitle: recipe.title,
            upsell: privateGate.sheet,
            makePublic: { ...makePublic.dialog, busy: setVisibility.isPending, error: setVisibility.error !== null },
            delete: {
                open: deleteOpen,
                deleting: deleteRecipe.isPending,
                // B17 — a failed delete left the dialog open with no explanation; surface an honest reason inside it.
                error: deleteRecipe.error !== null,
                // ⛔ The dialog may already be open when a write starts: its confirm is unavailable, and so is this.
                onConfirm: () => {
                    if (!saving) {
                        deleteRecipe.mutate(id, { onSuccess: () => nav.onDeleted() });
                    }
                },
                onCancel: () => setDeleteOpen(false),
                ...(saving ? { unavailable: detailActions.saving } : {}),
            },
        },
    };
}
