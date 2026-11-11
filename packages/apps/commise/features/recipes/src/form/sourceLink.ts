/**
 * @module @commise/features-recipes/form — the editor's ONE reading of the Source field (ADR-0089): the web link a cook
 * pastes as the place a recipe was copied from.
 *
 * Every question the editor asks about it is answered here, from the draft and the recipe the server holds, so the field,
 * the Private rule, the visibility that is sent, the wire body and the paste sheets cannot disagree. The link itself is
 * `recipe-core`'s `parseSourceLink`, the reading the server's `statement` schema uses too: the client's "that is not a
 * source" and the server's `400` are one rule.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Value Object + Parse, don't validate — {@link draftSourceOf} turns the field's text into a proved link or a named refusal
 * @pattern Policy — {@link draftPrivateRule}, {@link derivedVisibility} and {@link sourceStatementOf} each decide one thing from that reading
 * @pattern Visitor — {@link sourceRowOf} is the discriminated union both platforms' Source row switches over
 */
import {
    parseSourceLink,
    RecipeSourceType,
    RecipeVisibility,
    type PrivateRule,
    type RecipeDetail,
    type SourceLink,
    type SourceLinkExtraction,
    type SourceLinkRefusal,
} from '@kitchensink/recipe-core';
import type { RecipeStatementInput } from '@kitchensink/schema-recipe';

import { privateRuleForDraft } from '../actions/recipePrivateGate.js';
import { lifecycleOf } from '../editor/checkpointPolicy.js';
import type { RecipeFormValues } from './values.js';

/** What the recipe the editor holds says of its source: the server's own answer, `undefined` before the first save. */
type StoredRecipe = Pick<RecipeDetail, 'status' | 'firstPublishedAt' | 'sourceType' | 'sourceKind' | 'sourceUrl'>;

/** The Source field's text as the draft holds it, `''` when there is none. Pure. */
export const sourceTextOf = (values: Pick<RecipeFormValues, 'sourceLink'>): string => values.sourceLink ?? '';

/** The draft's source: nothing, a proved web link, or text that is not one. */
export type DraftSource =
    | { readonly kind: 'none' }
    | { readonly kind: 'link'; readonly link: SourceLink }
    | { readonly kind: 'refused'; readonly reason: SourceLinkRefusal };

/**
 * Read the Source field.
 *
 * @param values - The draft.
 * @returns `none` for an empty field, `link` for a usable web link, else `refused` with why. Pure.
 */
export function draftSourceOf(values: Pick<RecipeFormValues, 'sourceLink'>): DraftSource {
    const text = sourceTextOf(values);

    if (text.trim() === '') {
        return { kind: 'none' };
    }

    const parsed = parseSourceLink(text);

    return parsed.ok ? { kind: 'link', link: parsed.link } : { kind: 'refused', reason: parsed.reason };
}

/**
 * Whether the source can no longer change: the recipe was published at some point (ADR-0023 section 1b, ADR-0058). The
 * same fact the checkpoints are keyed on, so the field, the wire and the server's `SOURCE_LOCKED` agree.
 *
 * @param recipe - The server's recipe, or `undefined` before the first save.
 */
export const sourceIsLocked = (recipe: Pick<StoredRecipe, 'status' | 'firstPublishedAt'> | undefined): boolean =>
    lifecycleOf(recipe) === 'published';

const heldAsWebCopy = (recipe: Pick<StoredRecipe, 'sourceKind'> | undefined): boolean =>
    recipe?.sourceKind === 'public_web';

/**
 * The Private rule the DRAFT's source puts the recipe under (ADR-0089), not the stored one: a link the cook has just
 * pasted makes a never-saved draft private only, and removing the source of a stored web copy gives its slots back.
 *
 * @param values - The draft.
 * @param recipe - The server's recipe, or `undefined` before the first save.
 * @returns `privateOnly` for a web copy, a book or a paid-site recipe, else `slots`. Pure.
 */
export function draftPrivateRule(
    values: Pick<RecipeFormValues, 'sourceLink'>,
    recipe: StoredRecipe | undefined,
): PrivateRule {
    const source = draftSourceOf(values);

    if (source.kind === 'link') {
        return privateRuleForDraft(RecipeSourceType.IMPORTED_PUBLIC, 'public_web');
    }

    // The label and the kind move together: a web copy with its link taken off is a recipe the cook wrote.
    if (source.kind === 'none' && heldAsWebCopy(recipe)) {
        return privateRuleForDraft(RecipeSourceType.USER_CREATED, null);
    }

    return privateRuleForDraft(recipe?.sourceType, recipe?.sourceKind ?? null);
}

/**
 * The visibility the draft is SENT with. A web copy is private only, so a draft with a link goes out Private whatever the
 * cook chose, and `values.visibility` is left alone: taking the link off brings their choice back.
 *
 * @param values - The draft.
 * @returns Private for a draft with a usable web link, else the draft's own visibility. Pure.
 */
export function derivedVisibility(values: Pick<RecipeFormValues, 'sourceLink' | 'visibility'>): RecipeVisibility {
    return draftSourceOf(values).kind === 'link' ? RecipeVisibility.PRIVATE : values.visibility;
}

/**
 * The `statement` a write carries.
 *
 * - Create (`recipe` is `undefined`): the link, when it parses.
 * - Update: only a CHANGE of source, and only before the first publish. A source the server holds already is not sent
 *   again, an emptied field removes a stored web source (`null`), and text that is not (yet) a link sends NOTHING: a
 *   checkpoint in the middle of typing must not erase the stored source or send a citation the server refuses.
 *
 * @param values - The draft.
 * @param recipe - The server's recipe, or `undefined` for a create.
 * @returns The statement, `null` to remove the stored one, or `undefined` to leave the source alone. Pure.
 */
export function sourceStatementOf(
    values: Pick<RecipeFormValues, 'sourceLink'>,
    recipe: StoredRecipe | undefined,
): RecipeStatementInput | null | undefined {
    if (recipe !== undefined && sourceIsLocked(recipe)) {
        return undefined;
    }

    const source = draftSourceOf(values);

    switch (source.kind) {
        case 'link': {
            const stored = heldAsWebCopy(recipe) ? parseSourceLink(recipe?.sourceUrl ?? '') : undefined;

            return stored?.ok === true && stored.link.url === source.link.url
                ? undefined
                : { kind: 'public_web', citation: source.link.url };
        }
        case 'none':
            return heldAsWebCopy(recipe) ? null : undefined;
        case 'refused':
            return undefined;
    }
}

/** What a paste says about the link it carried. */
export type PastedSourceNote =
    | { readonly kind: 'set'; readonly site: string }
    | { readonly kind: 'keptExisting'; readonly site: string }
    | { readonly kind: 'ownSiteLeftOut' }
    | { readonly kind: 'locked' };

/** What a paste does to the Source: the link to set, if any, and what to tell the cook. */
export interface PastedSourcePlan {
    readonly set?: string;
    readonly note?: PastedSourceNote;
}

/**
 * What a pasted link line does to the Source (ADR-0089, the editor spec). It fills an EMPTY Source; a Source the cook
 * already has is kept and the other link is left out; a Commise link is never a source; a link the cook removed in this
 * session is not brought back; and once the source is locked a pasted link changes nothing. The link line itself is out
 * of the pasted text in every case (`extractSourceLink`).
 *
 * @param input - What the paste found, the draft, the server's recipe and the link the cook removed this session.
 * @returns The link to set and the note to say. Pure.
 */
export function pastedSourcePlanOf(input: {
    readonly extraction: SourceLinkExtraction;
    readonly current: Pick<RecipeFormValues, 'sourceLink'>;
    readonly recipe: StoredRecipe | undefined;
    readonly removed: string | undefined;
}): PastedSourcePlan {
    const { extraction, current, recipe, removed } = input;
    const { link } = extraction;

    if (link === undefined) {
        return extraction.ownSiteLeftOut ? { note: { kind: 'ownSiteLeftOut' } } : {};
    }

    if (sourceIsLocked(recipe)) {
        return { note: { kind: 'locked' } };
    }

    const existing = draftSourceOf(current);

    if (existing.kind === 'link') {
        return existing.link.url === link.url ? {} : { note: { kind: 'keptExisting', site: existing.link.site } };
    }

    return removed === link.url ? {} : { set: link.url, note: { kind: 'set', site: link.site } };
}

/** Every state of the Source row (the editor spec's table). */
export type SourceRowModel =
    /** Published with no source: nothing to show. */
    | { readonly kind: 'hidden' }
    /** Published with a web source: its site as a link and the address, read only. */
    | { readonly kind: 'locked'; readonly site: string; readonly url: string }
    | { readonly kind: 'empty'; readonly text: string }
    | { readonly kind: 'filled'; readonly text: string; readonly site: string; readonly fromPaste: boolean }
    | { readonly kind: 'invalid'; readonly text: string }
    | { readonly kind: 'ownSite'; readonly text: string };

/**
 * What the Source row draws.
 *
 * @param input - The draft, the server's recipe and whether the link in the field came from a paste.
 * @returns The row's state. Pure.
 */
export function sourceRowOf(input: {
    readonly values: Pick<RecipeFormValues, 'sourceLink'>;
    readonly recipe: StoredRecipe | undefined;
    readonly fromPaste: boolean;
}): SourceRowModel {
    const { values, recipe, fromPaste } = input;

    if (sourceIsLocked(recipe)) {
        const stored = heldAsWebCopy(recipe) ? parseSourceLink(recipe?.sourceUrl ?? '') : undefined;

        return stored?.ok === true
            ? { kind: 'locked', site: stored.link.site, url: stored.link.url }
            : { kind: 'hidden' };
    }

    const text = sourceTextOf(values);
    const source = draftSourceOf(values);

    switch (source.kind) {
        case 'none':
            return { kind: 'empty', text };
        case 'link':
            return { kind: 'filled', text, site: source.link.site, fromPaste };
        case 'refused':
            return { kind: source.reason, text };
    }
}
