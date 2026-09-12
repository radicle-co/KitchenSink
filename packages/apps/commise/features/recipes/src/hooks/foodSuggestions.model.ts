/**
 * @module @commise/features-recipes/hooks — what a food list shows, from the ONE progressive answer food-service streams
 * (ADR-0055 points 5 and 9): our database's two groups first, then each remote source's part as it arrives, then the
 * end of the answer. The rules are `docs/design/rowEditorOpenDecisions.md`, "S7 list contract" P1 to P6; L1 to L4 still
 * govern the database part. Every surface that picks a food reads this view: the editor's entry fields, rows 6 and 7,
 * and the recipe page's ambiguity review (owner ruling 2026-10-02).
 *
 * Pure and platform-agnostic: no React, no client. The suggestion source reduces its TanStack read to a
 * {@link ProgressiveRead} ({@link progressiveReadOf}), and this module reduces that to one {@link EntrySearchView}.
 *
 * - ⛔ A food's group is the frame part that carried it, never a field of the food (L1).
 * - ⛔ Nothing already shown moves: the database part settles once, at its frame, and each remote part is added after
 *   the last (P2). Each group keeps the order its frame gave and is cut to {@link FOOD_GROUP_CAP} (P4).
 *
 * @pattern Visitor — exhaustive switches over the read, the view and the remote part unions
 */
import type {
    AuthoredFoodSearchResultView,
    AuthoredGroup,
    CatalogGroup,
    CatalogSearchResultView,
    ProgressiveAnswer,
    ProgressiveSourceFrame,
    RemoteFoodView,
} from '@kitchensink/food-service-client';
import {
    inGroupOrder,
    namedFoodHitsOf,
    type NamedFoodHit,
} from '@kitchensink/recipe-core/resolution/food-search-groups';
import { MIN_SEARCH_QUERY_LENGTH, meetsSearchMinimum } from '@kitchensink/recipe-core/resolution/search-minimum';

import type { IngredientPick, RemoteFoodPick } from './lineCommit.js';

/** The most foods one group shows, database or remote (P4). The wire takes no limit, so the list cuts each group. */
export const FOOD_GROUP_CAP = 10;

/** One catalog search result: a root, and the one variant the search matched, if any. */
export type CatalogFoodHit = CatalogSearchResultView;

/** One of the cook's own foods. Its group says whose it is, so no field is read for that. */
export type AuthoredFoodHit = Pick<AuthoredFoodSearchResultView, 'id' | 'name' | 'score'>;

/** An offered food of the cook's own. */
export interface AuthoredFoodOption {
    readonly group: 'authored';
    readonly hit: NamedFoodHit<AuthoredFoodHit>;
}

/** An offered catalog food. */
export interface CatalogFoodOption {
    readonly group: 'catalog';
    readonly hit: NamedFoodHit<CatalogFoodHit>;
}

/** One food of our database the list offers, tagged with its group. It is picked by its id. */
export type FoodOption = AuthoredFoodOption | CatalogFoodOption;

/**
 * One remote source's food the list offers: a food our catalog does not hold (R66), with no variant (R64). It is picked
 * by the reference food issued with it (ADR-0055 point 10), and its name is the name its root will carry.
 */
export interface RemoteFoodOption {
    readonly group: 'remote';
    /** The source's register id: the list names it through the register, never by this id (P5). */
    readonly source: string;
    readonly hit: RemoteFoodView;
}

/** What one database group shows once the database part is in. */
export type FoodGroup<O extends FoodOption> =
    | { readonly kind: 'answered'; readonly foods: readonly O[] }
    /** Food could not read it: the group says why instead of showing nothing (L3). */
    | { readonly kind: 'unavailable' };

/** Our database's part of the answer: both groups, settled together at the database frame. */
export interface DatabasePart {
    readonly authored: FoodGroup<AuthoredFoodOption>;
    readonly catalog: FoodGroup<CatalogFoodOption>;
}

/** One remote source's part of the answer. */
export type RemotePart =
    /** The source answered: its foods, which may be none (P6 shows nothing then). */
    | { readonly kind: 'answered'; readonly source: string; readonly foods: readonly RemoteFoodOption[] }
    /** The source was busy: try later. */
    | { readonly kind: 'busy'; readonly source: string }
    /** The cook's own limit skipped the source, until `retryAt` (epoch milliseconds). */
    | { readonly kind: 'limited'; readonly source: string; readonly retryAt: number }
    /** The source did not answer in time: try now. */
    | { readonly kind: 'unavailable'; readonly source: string };

/** Where a served answer stands. */
export type AnswerProgress =
    /** Frames may still arrive. */
    | 'running'
    /** The complete frame arrived. */
    | 'complete'
    /** It ended without one: the body ended, it broke, or the overall deadline stopped it. */
    | 'incomplete';

/** What a food list shows for the text in its field. */
export type EntrySearchView =
    /** Nothing typed. */
    | { readonly kind: 'idle' }
    /** Typed, below the search minimum (003-FR-010a). */
    | { readonly kind: 'tooShort'; readonly minimum: number }
    /** The debounce has not caught up, or the database part has not arrived. `resumed`: the answer was parked first. */
    | { readonly kind: 'searching'; readonly resumed: boolean }
    /** The read is held offline before it ran (P6). It resumes by itself. */
    | { readonly kind: 'offline' }
    /** The answer ended with nothing arrived (P6, "Every part fails, or nothing arrived"). */
    | { readonly kind: 'failed'; readonly resumed: boolean }
    /** The database part is in: its groups, then each remote part in arrival order. */
    | {
          readonly kind: 'served';
          readonly database: DatabasePart;
          readonly remote: readonly RemotePart[];
          readonly progress: AnswerProgress;
          readonly resumed: boolean;
      };

/** Where the progressive read stands, as the suggestion source reduces it. */
export type ProgressiveRead =
    /** It runs, or is about to, inside its deadlines: the answer so far. */
    | { readonly kind: 'asking'; readonly answer: ProgressiveAnswer; readonly resumed: boolean }
    /** It is held offline before it ran. */
    | { readonly kind: 'parked' }
    /** It ended: completed, its body ended or broke, it failed, or a deadline stopped it. The answer as it ended. */
    | { readonly kind: 'ended'; readonly answer: ProgressiveAnswer; readonly resumed: boolean };

/** The facts of the progressive read: TanStack's own, its two deadlines, the app's focus, and whether it was parked. */
export interface ProgressiveReadFacts {
    readonly data: ProgressiveAnswer | undefined;
    readonly status: 'pending' | 'error' | 'success';
    readonly fetchStatus: 'fetching' | 'paused' | 'idle';
    /** The database part's deadline fired (`FOOD_SEARCH_DEADLINE_MS`). */
    readonly databaseExpired: boolean;
    /** The whole answer's deadline fired (P3). */
    readonly overallExpired: boolean;
    /** Whether the app has focus (`useAppFocused`): TanStack also holds a read for want of focus. */
    readonly appIsFocused: boolean;
    /** This answer was parked offline before it ran (P2, "A reconnect resumes the parked answer"). */
    readonly resumed: boolean;
}

/** The answer before any frame. */
const NOTHING: ProgressiveAnswer = { database: undefined, sources: [], complete: false };

/**
 * Where the progressive read stands. Pure.
 *
 * ⚠️ The order matters. A read held offline is parked whatever its deadlines read, because they do not run while it is
 * held, so an offline search never turns into a failure. Then the database deadline ends an answer that has no database
 * part, and the overall deadline ends any answer, keeping what arrived (P2, P3). Only then does TanStack's own state
 * decide: running, or ended.
 *
 * @param facts - The read, its deadlines, the app's focus and whether it was parked.
 * @returns The read.
 */
export function progressiveReadOf(facts: ProgressiveReadFacts): ProgressiveRead {
    const answer = facts.data ?? NOTHING;
    const { resumed } = facts;

    if (facts.fetchStatus === 'paused') {
        return facts.appIsFocused ? { kind: 'parked' } : { kind: 'asking', answer, resumed };
    }

    if ((facts.databaseExpired && answer.database === undefined) || facts.overallExpired) {
        return { kind: 'ended', answer, resumed };
    }

    if (facts.fetchStatus === 'fetching' || facts.status === 'pending') {
        return { kind: 'asking', answer, resumed };
    }

    return { kind: 'ended', answer, resumed };
}

/** The foods a group offers (`namedFoodHitsOf`), at most {@link FOOD_GROUP_CAP}. Pure. */
function offered<H extends { readonly name: string | null }>(hits: readonly H[]): NamedFoodHit<H>[] {
    return namedFoodHitsOf(hits).slice(0, FOOD_GROUP_CAP);
}

/** The cook's own group, from its frame part. Pure. */
function authoredGroupOf(group: AuthoredGroup): FoodGroup<AuthoredFoodOption> {
    return group.outcome === 'answered'
        ? {
              kind: 'answered',
              foods: offered(group.results).map((hit): AuthoredFoodOption => ({ group: 'authored', hit })),
          }
        : { kind: 'unavailable' };
}

/** The catalog group, from its frame part. Pure. */
function catalogGroupOf(group: CatalogGroup): FoodGroup<CatalogFoodOption> {
    return group.outcome === 'answered'
        ? {
              kind: 'answered',
              foods: offered(group.results).map((hit): CatalogFoodOption => ({ group: 'catalog', hit })),
          }
        : { kind: 'unavailable' };
}

/** One source's part, from its frame. Pure. */
function remotePartOf(frame: ProgressiveSourceFrame): RemotePart {
    switch (frame.outcome) {
        case 'answered':
            return {
                kind: 'answered',
                source: frame.source,
                foods: frame.items
                    .slice(0, FOOD_GROUP_CAP)
                    .map((hit): RemoteFoodOption => ({ group: 'remote', source: frame.source, hit })),
            };
        case 'busy':
            return { kind: 'busy', source: frame.source };
        case 'limited':
            return { kind: 'limited', source: frame.source, retryAt: frame.retryAt };
        case 'unavailable':
            return { kind: 'unavailable', source: frame.source };

        default: {
            const unhandled: never = frame;

            return unhandled;
        }
    }
}

/** The texts a list is for, and its read. */
export interface EntrySearchInput {
    readonly trimmed: string;
    /** The debounced text: the text the read was asked for. */
    readonly debouncedTrimmed: string;
    readonly read: ProgressiveRead;
}

/**
 * What the list shows. Pure.
 *
 * ⚠️ The order matters, and each step is a rule of the contract:
 * 1. Below the minimum no search runs, so it is checked before the debounce, which would otherwise wait forever.
 * 2. While the debounce lags, the read is for the previous text, so its foods are never shown for this one (P2).
 * 3. A parked read makes the list offline at once (P6): nothing waits for it.
 * 4. Until the database frame is in, the list is searching, or failed if the answer ended (P2, P6).
 *
 * @param input - The texts and the read.
 * @returns The view.
 */
export function entrySearchViewOf(input: EntrySearchInput): EntrySearchView {
    if (!meetsSearchMinimum(input.trimmed)) {
        return input.trimmed.length === 0 ? { kind: 'idle' } : { kind: 'tooShort', minimum: MIN_SEARCH_QUERY_LENGTH };
    }

    if (input.trimmed !== input.debouncedTrimmed) {
        return { kind: 'searching', resumed: false };
    }

    const { read } = input;

    switch (read.kind) {
        case 'parked':
            return { kind: 'offline' };
        case 'asking':
        case 'ended':
            return answeredViewOf(read);

        default: {
            const unhandled: never = read;

            return unhandled;
        }
    }
}

/**
 * What a read that asked shows: searching or failed until the database frame is in, then what has arrived (P2, P6).
 * Pure.
 *
 * @param read - A read that asked: still asking, or ended.
 * @returns The view.
 */
function answeredViewOf(read: Exclude<ProgressiveRead, { readonly kind: 'parked' }>): EntrySearchView {
    const { database, sources, complete } = read.answer;

    if (database === undefined) {
        return read.kind === 'asking'
            ? { kind: 'searching', resumed: read.resumed }
            : { kind: 'failed', resumed: read.resumed };
    }

    return {
        kind: 'served',
        database: { authored: authoredGroupOf(database.authored), catalog: catalogGroupOf(database.catalog) },
        remote: sources.map(remotePartOf),
        progress: read.kind === 'asking' ? 'running' : complete ? 'complete' : 'incomplete',
        resumed: read.resumed,
    };
}

/** The foods of one database group. Pure. */
function foodsOf<O extends FoodOption>(group: FoodGroup<O>): readonly O[] {
    return group.kind === 'answered' ? group.foods : [];
}

/**
 * The database foods the list offers, in the order it shows them (`inGroupOrder`): the cook's own, then the catalog's.
 * Pure.
 *
 * @param view - The list's view.
 * @returns The foods; none until the database part is in.
 */
export function servedFoodsOf(view: EntrySearchView): readonly FoodOption[] {
    return view.kind === 'served'
        ? inGroupOrder({ authored: foodsOf(view.database.authored), catalog: foodsOf(view.database.catalog) })
        : [];
}

/**
 * The remote foods the list offers, in the order it shows them: each source's, in the order its frame arrived. Pure.
 *
 * @param view - The list's view.
 * @returns The foods; none until a source has answered with some.
 */
export function remoteFoodsOf(view: EntrySearchView): readonly RemoteFoodOption[] {
    return view.kind === 'served' ? view.remote.flatMap((part) => (part.kind === 'answered' ? part.foods : [])) : [];
}

/**
 * The pick a database food makes: always by id (L4.4). A catalog result that names a variant binds that variant (§S2).
 * Pure.
 *
 * @param option - The food the cook chose.
 * @returns The pick.
 */
export function foodPickOf(option: FoodOption): IngredientPick {
    switch (option.group) {
        case 'authored':
            return { kind: 'catalogFood', foodId: option.hit.id, name: option.hit.name };
        case 'catalog':
            return option.hit.variant === undefined
                ? { kind: 'catalogFood', foodId: option.hit.id, name: option.hit.name }
                : { kind: 'catalogVariant', foodVariantId: option.hit.variant.id };

        default: {
            const unhandled: never = option;

            return unhandled;
        }
    }
}

/**
 * The pick a remote food makes: by the reference food issued, with the name its root carries and its source, so the
 * row can say where it is adding from (P8). Pure.
 *
 * @param option - The remote food the cook chose.
 * @returns The pick.
 */
export function remotePickOf(option: RemoteFoodOption): RemoteFoodPick {
    return { kind: 'remoteFood', reference: option.hit.reference, name: option.hit.name, source: option.source };
}
