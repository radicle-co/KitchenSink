'use client';

/**
 * @module @commise/features-recipes/actions — asking for Private, for any recipe surface that offers it (editor field,
 * recipe page ⋯ menu). A request applies at once, opens the Premium sheet, or does nothing, as {@link recipePrivateChoice}
 * decides (ADR-0073: a recipe is under the slots rule, or for an imported public-web recipe the Premium rule; owner ruling
 * 2026-10-13 for the latter).
 *
 * ⛔ UNDER THE PREMIUM RULE A LOADING STATE FAILS CLOSED, as it always did. Under the slots rule an unknown standing does
 * not: the write goes out and the server decides. A COLLECTION is not asked here (`useCollectionVisibility` asks
 * `privateChoice` directly).
 *
 * @pattern Policy — `recipePrivateChoice` decides WHAT a request does; this holds the sheet it may open
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { useState } from 'react';

import type { RecipeUpsellSheetProps, RecipeUpsellVariant } from './model.js';
import { recipeOffersPrivate, recipePrivateChoice, usesSlots, type RecipePrivateFacts } from './recipePrivateGate.js';

/** Options for {@link useGatedPrivate}. */
export interface UseGatedPrivateOptions {
    /** The recipe's rule, the cook's slot standing and their paid-feature state. */
    readonly facts: RecipePrivateFacts;
    /** The visibility the server holds. */
    readonly saved: RecipeVisibility;
    /** Make the recipe private: set the draft's field, or send the visibility write. Called only when allowed. */
    readonly apply: () => void;
    /**
     * The cook asked for Private while every slot is KNOWN used. The editor leaves it unset: its field already shows the
     * refusal and its ways forward. A surface with nowhere to show one (the recipe page's menu) sends the write here, so
     * the server's `PRIVATE_SLOTS_FULL` is what says no - the count is a display fact, never a reason to withhold a write.
     */
    readonly whenFull?: () => void;
}

/** What the host wires in. */
export interface GatedPrivate {
    /** Whether the surface offers Private at all (`recipeOffersPrivate`). */
    readonly offersPrivate: boolean;
    /** The cook asked for Private. */
    readonly request: () => void;
    /** Open the Premium sheet directly (the refusal's "Get Premium"); nothing opens unless the upsell stands. */
    readonly showPremium: () => void;
    /** For `RecipeUpsellSheet`. Open only under `upsell`. */
    readonly sheet: RecipeUpsellSheetProps;
}

/**
 * The Private request for one recipe surface.
 *
 * @param options - The recipe's private facts, the saved visibility and what applying Private does.
 * @returns Whether Private is offered, the request, the direct Premium command, and the Premium sheet's props.
 * @sideEffect Calls `apply` for a request that is allowed.
 */
export function useGatedPrivate(options: UseGatedPrivateOptions): GatedPrivate {
    const { facts, saved, apply, whenFull } = options;
    const [open, setOpen] = useState(false);
    const sheetVariant = sheetVariantOf(facts);

    return {
        offersPrivate: recipeOffersPrivate(facts, saved),
        request: () => {
            const outcome = recipePrivateChoice(facts, saved, RecipeVisibility.PRIVATE);

            if (outcome === 'upsell') {
                setOpen(true);
            } else if (outcome === 'apply') {
                apply();
            } else if (outcome === 'slotsFull') {
                whenFull?.();
            }
        },
        showPremium: () => setOpen(true),
        // Derived, never stored: a refetch that moves the state off `upsell` (or a slot freeing up) closes the sheet in the
        // same render.
        sheet: {
            open: open && sheetVariant !== undefined,
            variant: sheetVariant ?? WEB_IMPORT,
            onOpenChange: setOpen,
            onSeePremium: () => setOpen(false),
        },
    };
}

const WEB_IMPORT: RecipeUpsellVariant = { kind: 'webImport' };

/**
 * Which fact the Premium sheet may state, or `undefined` when it may not open at all. Pure.
 *
 * ⛔ Only where paid features are shown (`upsell`), and only when it is TRUE: an imported public-web recipe needs Premium
 * (`webImport`); a slots-rule recipe needs it only with every slot KNOWN used (`noSlot`). A free cook with a slot free,
 * or whose count is unknown, is never shown it - Private just works for them.
 */
function sheetVariantOf(facts: RecipePrivateFacts): RecipeUpsellVariant | undefined {
    if (facts.state !== 'upsell') {
        return undefined;
    }

    if (!usesSlots(facts.rule)) {
        return WEB_IMPORT;
    }

    return facts.standing.kind === 'full' ? { kind: 'noSlot', total: facts.standing.limit } : undefined;
}
