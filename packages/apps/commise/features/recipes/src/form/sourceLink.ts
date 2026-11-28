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
    sourceLockOf,
    type SourceLock,
    RecipeSourceType,
    RecipeVisibility,
    UNRECOGNISED_SOURCE_KIND,
    UNRECOGNISED_STATEMENT_KIND,
    type PrivateRule,
    type RecipeDetail,
    type SourceLink,
    type SourceLinkExtraction,
    type SourceLinkRefusal,
} from '@kitchensink/recipe-core';
import type { RecipeStatementInput } from '@kitchensink/schema-recipe';
import type { RowAnswer } from '../editor/statementStore.js';

import { publicRefusalOf, type PublicRefusal, type PublicRefusalFacts } from '../actions/publicRefusal.js';
import { privateRuleForDraft } from '../actions/recipePrivateGate.js';
import type { RecipeFormValues } from './values.js';

/** What the recipe the editor holds says of its source: the server's own answer, `undefined` before the first save. */
type StoredRecipe = Pick<
    RecipeDetail,
    | 'status'
    | 'visibility'
    | 'sourceType'
    | 'sourceKind'
    | 'statementKind'
    | 'sourceUrl'
    | 'sourceAttribution'
    | 'clonedFromId'
    | 'publicNeedsCheck'
    | 'sourceConfirmed'
    | 'sourceCorrected'
>;

type PublicWebStatement = Extract<RecipeStatementInput, { kind: 'public_web' }>;

/** The wording a screen showed beside a pasted web link: what the attestation record stores beside the choice. */
export type PublicWebWording = NonNullable<PublicWebStatement['wording']>;

/** The Source field's text as the draft holds it, `''` when there is none. Pure. */
const sourceTextOf = (values: Pick<RecipeFormValues, 'sourceLink'>): string => values.sourceLink ?? '';

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
 * Whether the source can no longer change, by `recipe-core`'s ONE lock rule `sourceLockOf` (anything but `open` means the link can no longer change), the rule the server's
 * `PATCH` policy reads: not stated by the cook (the curator's text, a paid site), inherited by a clone, or an unknown kind. The
 * first publish does not lock it (ADR-0093 section 8). So the field, the wire and the server's `SOURCE_LOCKED` agree. A recipe
 * never saved has nothing to lock.
 *
 * @param recipe - The server's recipe, or `undefined` before the first save.
 */
const sourceLockOfStored = (recipe: StoredRecipe): SourceLock =>
    sourceLockOf({
        sourceType: recipe.sourceType,
        sourceKind: recipe.sourceKind ?? null,
        statementKind: recipe.statementKind ?? null,
        clonedFromId: recipe.clonedFromId,
        sourceConfirmed: recipe.sourceConfirmed === true,
    });

const sourceIsLocked = (recipe: StoredRecipe | undefined): boolean =>
    recipe !== undefined && sourceLockOfStored(recipe) !== 'open';

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
    const { sourceType, sourceKind } = draftPublicFactsOf(values, recipe);

    return privateRuleForDraft(sourceType, sourceKind);
}

/**
 * The facts `publicRefusalOf` judges, for the DRAFT: the recipe page reads the same function over the stored recipe, so the
 * editor's Public card, its choice and its send cannot disagree with the page (board P6, KTD-5). The branches are the ones
 * the Private rule takes: a locked source is the server's, a pasted link makes a web copy, a stored web copy with its link
 * taken off is the cook's own, and anything else keeps the stored facts. The statement is always the stored one: the cook's
 * answer in the sheet is a write, not part of the draft, and a stored "From another person" wins over a pasted link.
 *
 * @param values - The draft.
 * @param recipe - The server's recipe, or `undefined` before the first save.
 * @returns The source, the statement and whether a recorded source holds Public. Pure.
 */
export function draftPublicFactsOf(
    values: Pick<RecipeFormValues, 'sourceLink'>,
    recipe: StoredRecipe | undefined,
): PublicRefusalFacts {
    const statementKind = recipe?.statementKind ?? null;
    const held = publicHeldOf(values, recipe);
    const stored = {
        sourceType: recipe?.sourceType ?? RecipeSourceType.USER_CREATED,
        sourceKind: recipe?.sourceKind ?? null,
        statementKind,
        held,
        sourceCorrected: recipe?.sourceCorrected === true,
    };

    // A locked source is the server's, whatever the field holds: judge the stored facts.
    if (recipe !== undefined && sourceIsLocked(recipe)) {
        return stored;
    }

    const source = draftSourceOf(values);

    if (source.kind === 'link') {
        return { ...stored, sourceType: RecipeSourceType.IMPORTED_PUBLIC, sourceKind: 'public_web' };
    }

    // The label and the kind move together: a web copy with its link taken off is a recipe the cook wrote.
    if (source.kind === 'none' && heldAsWebCopy(recipe)) {
        return { ...stored, sourceType: RecipeSourceType.USER_CREATED, sourceKind: null };
    }

    return stored;
}

/**
 * Whether a recorded source holds the recipe out of Public although the draft states none (ADR-0095): the server says so
 * (`publicNeedsCheck`), or it stores a web or book source the cook has since taken off the draft. A source the server
 * recorded stays on record, so taking it off does not give Public back; the draft's own link is `draftPrivateRule`'s.
 *
 * @param values - The draft.
 * @param recipe - The server's recipe, or `undefined` before the first save.
 * @returns `true` when Public is held. Pure.
 */
export function publicHeldOf(values: Pick<RecipeFormValues, 'sourceLink'>, recipe: StoredRecipe | undefined): boolean {
    if (recipe === undefined) {
        return false;
    }

    return (
        recipe.publicNeedsCheck === true ||
        ((recipe.sourceKind === 'public_web' || recipe.sourceKind === 'book') && draftSourceOf(values).kind === 'none')
    );
}

/**
 * The reason Public is refused that is IN FORCE for this draft: the ONE rule the field, the choice, the publish guard and the
 * send all read, so none of them can disagree about a recipe that is already public.
 *
 * Two arms are the editor's own and always apply: a pasted link, and a recipe a recorded source holds out of Public
 * ({@link publicHeldOf}). Every other reason is only the CLIENT'S reading of stored facts (a newer server's kind it cannot name,
 * a statement), so it applies to a recipe that is not public yet and never to one that already is: a Save must not unpublish it,
 * and the screen must not show it as Private. The server stays the authority for such a recipe.
 *
 * @param values - The draft.
 * @param recipe - The server's recipe, or `undefined` before the first save.
 * @returns The reason, or `none`. Pure.
 */
export function publicRefusalInForce(
    values: Pick<RecipeFormValues, 'sourceLink'>,
    recipe: StoredRecipe | undefined,
): PublicRefusal {
    const reason = publicRefusalOf(draftPublicFactsOf(values, recipe));
    const editorsOwn = draftSourceOf(values).kind === 'link' || publicHeldOf(values, recipe);

    return editorsOwn || recipe?.visibility !== RecipeVisibility.PUBLIC ? reason : 'none';
}

/**
 * The visibility the draft is SENT with: Private whenever a reason is in force ({@link publicRefusalInForce}), else the draft's
 * own choice. `values.visibility` is left alone: taking the link off a draft-only link brings their choice back.
 *
 * @param values - The draft.
 * @param recipe - The server's recipe, or `undefined` before the first save.
 * @returns Private when Public is refused, else the draft's own visibility. Pure.
 */
export function derivedVisibility(
    values: Pick<RecipeFormValues, 'sourceLink' | 'visibility'>,
    recipe: StoredRecipe | undefined,
): RecipeVisibility {
    return publicRefusalInForce(values, recipe) === 'none' ? values.visibility : RecipeVisibility.PRIVATE;
}

/**
 * The `statement` a write carries.
 *
 * - Create (`recipe` is `undefined`): the link, when it parses.
 * - Update: only a CHANGE of source, also after the first publish. A source the server holds already is not sent
 *   again, an emptied field removes a stored web source (`null`), and text that is not (yet) a link sends NOTHING: a
 *   checkpoint in the middle of typing must not erase the stored source or send a citation the server refuses.
 *
 * @param values - The draft.
 * @param recipe - The server's recipe, or `undefined` for a create.
 * @param wording - The wording the screen showed beside the link. Without it the statement carries none.
 * @returns The statement, `null` to remove the stored one, or `undefined` to leave the source alone. Pure.
 */
export function sourceStatementOf(
    values: Pick<RecipeFormValues, 'sourceLink'>,
    recipe: StoredRecipe | undefined,
    wording?: PublicWebWording,
): PublicWebStatement | null | undefined {
    if (recipe !== undefined && sourceIsLocked(recipe)) {
        return undefined;
    }

    const source = draftSourceOf(values);

    switch (source.kind) {
        case 'link': {
            const stored = heldAsWebCopy(recipe) ? parseSourceLink(recipe?.sourceUrl ?? '') : undefined;

            return stored?.ok === true && stored.link.url === source.link.url
                ? undefined
                : { kind: 'public_web', citation: source.link.url, ...(wording === undefined ? {} : { wording }) };
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
    | { readonly kind: 'locked' }
    /** A confirmed "I wrote this": the link was left out, and the cook can still move it to a cookbook or paid website. */
    | { readonly kind: 'ownLinkLeftOut' };

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

    if (recipe !== undefined && sourceLockOfStored(recipe) === 'downgradeOnly') {
        return { note: { kind: 'ownLinkLeftOut' } };
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

/**
 * Whether a paste was nothing but a link: a link was found and no other text is left. Such a paste has no lines to add, so
 * the sheet says what to do instead of leaving its Add disabled without a word.
 *
 * @param extraction - What `extractSourceLink` found in the pasted text.
 * @returns `true` when the link was the whole paste. Pure.
 */
export const isLinkOnly = (extraction: SourceLinkExtraction): boolean =>
    extraction.link !== undefined && extraction.remaining.trim() === '';

/** The answers a locked Source row can name. */
export type LockedAnswer = 'paidSite' | 'fromPerson' | 'book';

/**
 * The words that name a locked answer: ONE map for both platforms' Source row.
 *
 * @param answer - The locked answer.
 * @param words - The statement sheet's answer labels.
 * @returns The label. Pure.
 */
export function lockedAnswerLabel(
    answer: LockedAnswer,
    words: { readonly answerPaidSite: string; readonly answerPerson: string; readonly answerBook: string },
): string {
    switch (answer) {
        case 'book':
            return words.answerBook;
        case 'paidSite':
            return words.answerPaidSite;
        case 'fromPerson':
            return words.answerPerson;
    }
}

/** Every state of the Source row (the editor spec's table). */
export type SourceRowModel =
    /** A locked source with no web link: nothing to show. */
    | { readonly kind: 'hidden' }
    /** A locked web source: its site as a link and the address, read only. */
    | { readonly kind: 'locked'; readonly site: string; readonly url: string }
    /**
     * A locked answer the cook gave: a paid website (its citation as plain text, with no address to open) or "From another
     * person" (no citation). `answer` is absent for a statement kind this client does not know: the row then says only that the
     * source cannot be changed.
     */
    | {
          readonly kind: 'lockedAnswer';
          readonly answer?: LockedAnswer;
          readonly citation?: string;
      }
    /**
     * A confirmed "I wrote this" (ADR-0100): the one answer the cook may still move, to a cookbook or a paid website. It has
     * no locked line.
     */
    | { readonly kind: 'own' }
    /**
     * An answer nobody has confirmed yet (a book an import stored, or an answer the cook just gave that does not lock until
     * the act confirms): the answer, its citation if it has one, and a way to change it.
     */
    | { readonly kind: 'openAnswered'; readonly answer: LockedAnswer; readonly citation?: string }
    | { readonly kind: 'empty'; readonly text: string }
    | {
          readonly kind: 'filled';
          readonly text: string;
          readonly site: string;
          readonly fromPaste: boolean;
          /** The recipe's answer is confirmed already, so the next save locks the link (`lockWarningSave`). Absent before. */
          readonly confirmed?: true;
      }
    | { readonly kind: 'invalid'; readonly text: string }
    | { readonly kind: 'ownSite'; readonly text: string };

/**
 * The row of a recipe whose source the cook can no longer change: the answer the server holds, its citation, or the page as a
 * link. Pure.
 *
 * @param recipe - The server's recipe.
 * @returns The locked row. A source with no answer to name (the curator's text) is `hidden`.
 */
function lockedRowOf(recipe: StoredRecipe): SourceRowModel {
    if (recipe.sourceKind === 'paid_site') {
        return { kind: 'lockedAnswer', answer: 'paidSite', citation: recipe.sourceAttribution ?? '' };
    }

    if (recipe.sourceKind === 'book') {
        return { kind: 'lockedAnswer', answer: 'book', citation: recipe.sourceAttribution ?? '' };
    }

    if (recipe.statementKind === 'fromPerson') {
        return { kind: 'lockedAnswer', answer: 'fromPerson' };
    }

    if (recipe.statementKind === UNRECOGNISED_STATEMENT_KIND || recipe.sourceKind === UNRECOGNISED_SOURCE_KIND) {
        return { kind: 'lockedAnswer' };
    }

    const stored = heldAsWebCopy(recipe) ? parseSourceLink(recipe.sourceUrl ?? '') : undefined;

    return stored?.ok === true ? { kind: 'locked', site: stored.link.site, url: stored.link.url } : { kind: 'hidden' };
}

/**
 * The row of an answer the cook just gave in the Source row's sheet, before any write has carried it. `locks` is the rule's
 * answer (`answerLocks`, decided once when the cook confirmed), so the row keeps no list of locking kinds. Pure.
 */
function answeredRowOf(statement: RecipeStatementInput, locks: boolean): SourceRowModel {
    switch (statement.kind) {
        case 'paid_site':
            return answeredOf('paidSite', statement.citation, locks);
        case 'fromPerson':
            return answeredOf('fromPerson', undefined, locks);
        case 'book':
            return answeredOf('book', statement.citation, locks);
        case 'authored':
            return { kind: 'own' };
        case 'public_web':
            return { kind: 'empty', text: statement.citation };
    }
}

/** One answer the row draws as locked or open by `locks`, the rule's answer (`answerLocks`), never a list of kinds. Pure. */
function answeredOf(answer: LockedAnswer, citation: string | undefined, locks: boolean): SourceRowModel {
    const withCitation = citation === undefined ? {} : { citation };

    return locks
        ? { kind: 'lockedAnswer', answer, ...withCitation }
        : { kind: 'openAnswered', answer, ...withCitation };
}

/**
 * What the Source row draws.
 *
 * @param input - The draft, the server's recipe, whether the link in the field came from a paste, and whether an unusable text
 *   is shown as an error yet.
 * @returns The row's state. Pure.
 */
export function sourceRowOf(input: {
    readonly values: Pick<RecipeFormValues, 'sourceLink'>;
    readonly recipe: StoredRecipe | undefined;
    readonly fromPaste: boolean;
    /**
     * Whether an unusable text is shown as the error it is: after the cook has left the field, or has tried to Publish.
     * While they type it is plain text, because a half-typed address is not a mistake yet.
     */
    readonly showError: boolean;
    /** The citation of a paid website the cook has confirmed and no write has yet carried: locked from the confirm. */
    readonly paidSiteStated?: string;
    /** What the Source row's own sheet answered and no write has yet carried: the row draws it from the confirm. */
    readonly rowAnswer?: RowAnswer;
}): SourceRowModel {
    const { values, recipe, fromPaste, showError, paidSiteStated, rowAnswer } = input;

    if (paidSiteStated !== undefined) {
        return { kind: 'lockedAnswer', answer: 'paidSite', citation: paidSiteStated };
    }

    if (rowAnswer?.statement != null) {
        return answeredRowOf(rowAnswer.statement, rowAnswer.locks);
    }

    // A clear in flight (`null`): the stored answer is gone from the row, whatever it was.
    const lock = recipe === undefined || rowAnswer !== undefined ? 'open' : sourceLockOfStored(recipe);

    if (recipe !== undefined && lock === 'downgradeOnly') {
        return { kind: 'own' };
    }

    if (recipe !== undefined && lock === 'locked') {
        return lockedRowOf(recipe);
    }

    // A link the draft holds (a paste set it) replaces the stored book at the next save: the field is the row then.
    if (rowAnswer === undefined && recipe?.sourceKind === 'book' && draftSourceOf(values).kind === 'none') {
        return { kind: 'openAnswered', answer: 'book', citation: recipe.sourceAttribution ?? '' };
    }

    const text = sourceTextOf(values);
    const source = draftSourceOf(values);

    switch (source.kind) {
        case 'none':
            return { kind: 'empty', text };
        case 'link':
            return {
                kind: 'filled',
                text,
                site: source.link.site,
                fromPaste,
                ...(recipe?.sourceConfirmed === true ? { confirmed: true as const } : {}),
            };
        case 'refused':
            return showError ? { kind: source.reason, text } : { kind: 'empty', text };
    }
}
