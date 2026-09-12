/**
 * The catalog planner (curated catalog plan U5, KTD-8, KTD-11, KTD-12, KTD-19).
 *
 * @pattern Functional core — a pure function from a target content, a snapshot and the declared changes to a
 *   canonical plan; it reads no clock, mints no id and touches no database, so the CI diff and the deploy apply plan
 *   with the same code
 *
 * The plan is canonical over natural keys: every row is named by its key, a row the snapshot holds keeps its id, and a
 * row the apply must mint carries `id: null`. Every output list is sorted by natural key, so the same inputs in any
 * order give the same plan.
 *
 * Ownership is the spine. Each item has one owner, retired owners included (KTD-8), and every root and variant is
 * placed by asking where its item is owned before (the snapshot) and after (the target):
 *
 * - kept, renamed, restored or moved: the same key is owned on both sides;
 * - retired: the key and its item both leave the seed, so the row keeps its item and gains `retired_at`;
 * - deleted: the key leaves but its item stays, as another owner's item or an alias source, so the row is deleted
 *   and forwards to where the item went: a merge, a split, an alias or a displaced owner;
 * - inserted: a key the snapshot never held, or held only as a forward's source, whose id it then reuses (R33).
 *
 * The plan lists rows, not phases. The applier owns the write order and decides nothing (U6).
 */
import canonicalize from 'canonicalize';

import { normalizeName } from '../../foodName.js';
import { isFdcKey, type ItemKey, type SeedKey } from '../catalogKey.js';
import { CatalogPlanRefusedError, type CatalogPlanIssue } from './catalogPlanBuilder.errors.js';
import {
    compareCategories,
    comparePortions,
    compareText,
    sourceRefKey,
    type CatalogContent,
    type CatalogSnapshot,
    type ContentCitation,
    type ContentItem,
    type ContentNutrition,
    type ContentRoot,
    type ContentVariant,
    type OwnerKind,
    type SnapshotForward,
} from './catalogSnapshot.js';
import type { CatalogChanges, CuratedPart } from './curatedSeedFormat.js';

/** A root or variant, by natural key. */
export type OwnerKey =
    { readonly kind: 'root'; readonly key: SeedKey } | { readonly kind: 'variant'; readonly key: ItemKey };

/** A root row the apply writes. */
export interface RootWrite {
    /** The row's id; `null` when the apply mints one. */
    readonly id: string | null;
    readonly seedKey: SeedKey;
    readonly name: string;
    readonly synonyms: readonly string[];
    readonly item: ItemKey;
    /** Whether the row is retired now and the write clears `retired_at`. */
    readonly restore: boolean;
}

/** A variant row the apply inserts. */
export interface VariantWrite {
    /** The row's id; `null` when the apply mints one. */
    readonly id: string | null;
    readonly item: ItemKey;
    readonly root: SeedKey;
}

/** A row the snapshot holds, by id and natural key. */
export interface HeldRow<Key extends string> {
    readonly id: string;
    readonly key: Key;
}

/** An item row the apply inserts. */
export interface ItemWrite {
    readonly key: ItemKey;
    readonly ownerKind: OwnerKind;
}

/** A `food_forward` row the apply inserts. Its target is a live root or variant after the apply. */
export interface ForwardWrite {
    readonly sourceId: string;
    readonly sourceKind: OwnerKind;
    readonly sourceKey: string | null;
    readonly target: OwnerKey;
}

/** One owner's nutrition, replaced whole: `null` deletes the header. */
export interface NutritionWrite {
    readonly owner: OwnerKey;
    readonly nutrition: ContentNutrition | null;
}

/** One variant's parts, replaced whole. */
export interface PartsWrite {
    readonly item: ItemKey;
    readonly parts: readonly CuratedPart[];
}

/** The rows a plan writes, by table. */
/** A live, non-seed food the seed retires because a seed root claims its name (KTD-12's exception). */
export interface LiveClaim {
    readonly id: string;
    readonly by: SeedKey;
}

/** The rows a plan writes, by table. */
export interface CatalogRowPlan {
    /** Live foods to retire; each also has a forward in `forwards.insert`. */
    readonly claims: readonly LiveClaim[];
    readonly roots: {
        readonly insert: readonly RootWrite[];
        readonly update: readonly RootWrite[];
        readonly retire: readonly HeldRow<SeedKey>[];
        /** Rows a declared change removes; each has a forward in `forwards.insert`. */
        readonly delete: readonly HeldRow<SeedKey>[];
    };
    readonly variants: {
        /** New rows, rows restored from a forward, and moved rows re-inserted under their own id. */
        readonly insert: readonly VariantWrite[];
        /** Retired rows that stay under their root and clear `retired_at`. */
        readonly restore: readonly HeldRow<ItemKey>[];
        readonly retire: readonly HeldRow<ItemKey>[];
        /** Removed rows, each with a forward, and moved rows before they are re-inserted. */
        readonly delete: readonly HeldRow<ItemKey>[];
    };
    readonly items: {
        readonly insert: readonly ItemWrite[];
        /** Kept items whose owner kind flips. */
        readonly reown: readonly (HeldRow<ItemKey> & { readonly ownerKind: OwnerKind })[];
        /** Items the apply leaves with no owner. */
        readonly delete: readonly HeldRow<ItemKey>[];
    };
    /** Items whose sources, portions and popularity are replaced whole. */
    readonly itemChildren: readonly ContentItem[];
    readonly nutrition: readonly NutritionWrite[];
    readonly parts: readonly PartsWrite[];
    readonly forwards: {
        /** By source id: restored rows' forwards, and forwards re-inserted with a new or the same target. */
        readonly delete: readonly string[];
        readonly insert: readonly ForwardWrite[];
    };
}

/** Why a declared change removes a root or variant, read off where its item goes (KTD-8). */
export type RemovalReason =
    /** The root's item became a variant's item: it forwards to that variant's root. */
    | 'merged'
    /** The item became an alias source of another item: it forwards to that item's owner. */
    | 'aliased'
    /** Another root took the root's item as its own: it forwards to that root. */
    | 'displaced'
    /** The variant's item became a root's item (a split, or a restore): it forwards to that root. */
    | 'promoted';

/** One change a reviewer reads in the seed diff (R41, KTD-22). */
export type CatalogChange =
    | { readonly kind: 'rootAdded'; readonly seedKey: SeedKey; readonly name: string }
    | { readonly kind: 'rootSplit'; readonly seedKey: SeedKey; readonly name: string; readonly from: SeedKey }
    | { readonly kind: 'rootRestored'; readonly seedKey: SeedKey; readonly name: string }
    | { readonly kind: 'rootRenamed'; readonly seedKey: SeedKey; readonly from: string; readonly to: string }
    | {
          readonly kind: 'rootSynonymsChanged';
          readonly seedKey: SeedKey;
          readonly from: readonly string[];
          readonly to: readonly string[];
      }
    | { readonly kind: 'rootItemChanged'; readonly seedKey: SeedKey; readonly from: ItemKey; readonly to: ItemKey }
    | { readonly kind: 'rootRetired'; readonly seedKey: SeedKey; readonly name: string }
    | {
          readonly kind: 'rootRemoved';
          readonly seedKey: SeedKey;
          readonly name: string;
          readonly reason: Exclude<RemovalReason, 'promoted'>;
          readonly to: OwnerKey;
      }
    | { readonly kind: 'variantAdded'; readonly item: ItemKey; readonly root: SeedKey }
    | { readonly kind: 'variantRestored'; readonly item: ItemKey; readonly root: SeedKey }
    | { readonly kind: 'variantMoved'; readonly item: ItemKey; readonly from: SeedKey; readonly to: SeedKey }
    | { readonly kind: 'variantRetired'; readonly item: ItemKey; readonly root: SeedKey }
    | {
          readonly kind: 'variantRemoved';
          readonly item: ItemKey;
          readonly root: SeedKey;
          readonly reason: Extract<RemovalReason, 'promoted' | 'aliased'>;
          readonly to: OwnerKey;
      }
    | {
          readonly kind: 'variantPartsChanged';
          readonly item: ItemKey;
          readonly from: readonly CuratedPart[];
          readonly to: readonly CuratedPart[];
      }
    | { readonly kind: 'itemChanged'; readonly item: ItemKey }
    | {
          readonly kind: 'citationChanged';
          readonly owner: OwnerKey;
          readonly from: ContentCitation | null;
          readonly to: ContentCitation | null;
      }
    | { readonly kind: 'nutritionValuesChanged'; readonly owner: OwnerKey }
    | { readonly kind: 'liveFoodClaimed'; readonly id: string; readonly seedKey: SeedKey };

/** A plan: what a reviewer reads, and what the apply writes. */
export interface CatalogPlan {
    readonly changes: readonly CatalogChange[];
    readonly rows: CatalogRowPlan;
}

/** Where a row the snapshot holds stands. */
type Held<Row> = { readonly state: 'live' | 'retired'; readonly row: Row };

/** What happens to a root or variant key. Only `retired` and `staysRetired` rows keep their item without the seed. */
type Fate = 'kept' | 'restored' | 'inserted' | 'moved' | 'retired' | 'staysRetired' | 'deleted';

/** Where a removed row's item goes, and so where the row forwards. */
interface Claim {
    readonly by: 'root' | 'variant' | 'alias';
    readonly to: OwnerKey;
}

/** What one planning call reads: the inputs, and the indexes derived from them once. */
interface PlanInputs {
    readonly target: CatalogContent;
    readonly snapshot: CatalogSnapshot;
    /** Each target item's owner. */
    readonly targetOwner: ReadonlyMap<ItemKey, OwnerKey>;
    /** Each alias source's host: the owner of the target item that lists it as a source row (R48). */
    readonly aliasHost: ReadonlyMap<ItemKey, OwnerKey>;
    /** The snapshot's forwards whose source is a deleted seed row, by {@link forwardSourceKey}. */
    readonly forwardsBySource: ReadonlyMap<string, SnapshotForward>;
    /** Each declared split's new key, and the root it splits from. */
    readonly splitFrom: ReadonlyMap<SeedKey, SeedKey>;
}

/** What one planning call writes. Local to the call, so the function stays pure. */
interface PlanState {
    readonly issues: CatalogPlanIssue[];
    readonly changes: CatalogChange[];
    readonly claims: LiveClaim[];
    readonly rootInsert: RootWrite[];
    readonly rootUpdate: RootWrite[];
    readonly rootRetire: HeldRow<SeedKey>[];
    readonly rootDelete: HeldRow<SeedKey>[];
    readonly variantInsert: VariantWrite[];
    readonly variantRestore: HeldRow<ItemKey>[];
    readonly variantRetire: HeldRow<ItemKey>[];
    readonly variantDelete: HeldRow<ItemKey>[];
    readonly itemInsert: ItemWrite[];
    readonly itemReown: (HeldRow<ItemKey> & { readonly ownerKind: OwnerKind })[];
    readonly itemDelete: HeldRow<ItemKey>[];
    readonly itemChildren: ContentItem[];
    readonly nutrition: NutritionWrite[];
    readonly parts: PartsWrite[];
    readonly forwardDelete: string[];
    readonly forwardInsert: ForwardWrite[];
    readonly rootFate: Map<SeedKey, Fate>;
    readonly variantFate: Map<ItemKey, Fate>;
    /** Where each deleted row, and each claimed live food, now forwards, by {@link forwardSourceKey} of its id. */
    readonly destination: Map<string, OwnerKey>;
    /** Forwards whose source row the plan restores, by source id. */
    readonly restoredForwards: Set<string>;
}

/**
 * Compare two values by their RFC 8785 canonical JSON. Pure.
 *
 * @param left - A JSON value.
 * @param right - A JSON value.
 * @returns Whether they are equal.
 */
function sameJson(left: unknown, right: unknown): boolean {
    return canonicalize(left) === canonicalize(right);
}

/**
 * A nutrition header with its values in dictionary order, so an adapter's order never reads as a change. Pure.
 *
 * @param nutrition - A header, or `null`.
 * @returns The same header, sorted.
 */
function sortedNutrition(nutrition: ContentNutrition | null): ContentNutrition | null {
    return nutrition === null
        ? null
        : {
              citation: nutrition.citation,
              values: [...nutrition.values].sort(
                  (left, right) => compareText(left.name, right.name) || compareText(left.unit, right.unit),
              ),
          };
}

/**
 * An item with its lists in natural-key order. Pure.
 *
 * @param item - An item.
 * @returns The same item, sorted.
 */
function sortedItem(item: ContentItem): ContentItem {
    return {
        key: item.key,
        sources: [...item.sources].sort((left, right) => compareText(sourceRefKey(left), sourceRefKey(right))),
        portions: [...item.portions].sort(comparePortions),
        categories: [...item.categories].sort(compareCategories),
        popularity: item.popularity,
    };
}

/**
 * Look a key up in live content, then retired content. Pure.
 *
 * @param live - The live rows.
 * @param retired - The retired rows.
 * @param key - The key.
 * @returns Where the row stands, if the snapshot holds it.
 */
function heldIn<Key, Row>(
    live: ReadonlyMap<Key, Row>,
    retired: ReadonlyMap<Key, Row>,
    key: Key,
): Held<Row> | undefined {
    const liveRow = live.get(key);

    if (liveRow !== undefined) {
        return { state: 'live', row: liveRow };
    }

    const retiredRow = retired.get(key);

    return retiredRow === undefined ? undefined : { state: 'retired', row: retiredRow };
}

/**
 * The sorted union of several key sets. Pure.
 *
 * @param sets - Key iterables.
 * @returns Each key once, in {@link compareText} order.
 */
function unionOf<Key extends string>(...sets: Iterable<Key>[]): Key[] {
    return [...new Set(sets.flatMap((set) => [...set]))].sort(compareText);
}

/**
 * Order a list by a key it derives. Pure.
 *
 * @param rows - The rows (not mutated).
 * @param keyOf - The sort key of a row.
 * @returns A new, sorted array.
 */
function sortedBy<Row>(rows: readonly Row[], keyOf: (row: Row) => string): Row[] {
    return [...rows].sort((left, right) => compareText(keyOf(left), keyOf(right)));
}

/**
 * The one string a root or variant is found by, whether by natural key or by id. Pure.
 *
 * @param kind - Its table.
 * @param keyOrId - Its natural key or its id.
 * @returns One string.
 */
function forwardSourceKey(kind: OwnerKind, keyOrId: string): string {
    return `${kind}\u0000${keyOrId}`;
}

/**
 * The text an owner sorts by. Pure.
 *
 * @param owner - An owner.
 * @returns `kind key`.
 */
function ownerText(owner: OwnerKey): string {
    return `${owner.kind} ${owner.key}`;
}

/**
 * A change's sort key: roots, then variants, then items, then nutrition, then claims; then subject; then kind. Pure.
 *
 * @param change - A change.
 * @returns The key it sorts by.
 */
function changeSortKey(change: CatalogChange): string {
    switch (change.kind) {
        case 'rootAdded':
        case 'rootSplit':
        case 'rootRestored':
        case 'rootRenamed':
        case 'rootSynonymsChanged':
        case 'rootItemChanged':
        case 'rootRetired':
        case 'rootRemoved':
            return `0 ${change.seedKey}\u0000${change.kind}`;

        case 'variantAdded':
        case 'variantRestored':
        case 'variantMoved':
        case 'variantRetired':
        case 'variantRemoved':
        case 'variantPartsChanged':
            return `1 ${change.item}\u0000${change.kind}`;

        case 'itemChanged':
            return `2 ${change.item}\u0000${change.kind}`;

        case 'citationChanged':
        case 'nutritionValuesChanged':
            return `3 ${ownerText(change.owner)}\u0000${change.kind}`;

        case 'liveFoodClaimed':
            return `4 ${change.id}\u0000${change.kind}`;
    }
}

/**
 * Index the inputs once. Pure.
 *
 * @param target - The seed's content.
 * @param snapshot - The catalog.
 * @param changes - The declared changes.
 * @returns The inputs with their indexes.
 */
function indexInputs(target: CatalogContent, snapshot: CatalogSnapshot, changes: CatalogChanges): PlanInputs {
    const targetOwner = new Map<ItemKey, OwnerKey>([
        ...[...target.roots.values()].map((root): [ItemKey, OwnerKey] => [
            root.item,
            { kind: 'root', key: root.seedKey },
        ]),
        ...[...target.variants.values()].map((variant): [ItemKey, OwnerKey] => [
            variant.item,
            { kind: 'variant', key: variant.item },
        ]),
    ]);
    const aliasHost = new Map<ItemKey, OwnerKey>();

    for (const item of target.items.values()) {
        const host = targetOwner.get(item.key);

        for (const source of item.sources) {
            const sourceItem = source.source === 'usda' ? `fdc:${source.externalKey}` : undefined;

            if (host !== undefined && isFdcKey(sourceItem) && sourceItem !== item.key) {
                aliasHost.set(sourceItem, host);
            }
        }
    }

    return {
        target,
        snapshot,
        targetOwner,
        aliasHost,
        forwardsBySource: new Map(
            snapshot.forwards.flatMap((forward) =>
                forward.sourceKey === null ? [] : [[forwardSourceKey(forward.sourceKind, forward.sourceKey), forward]],
            ),
        ),
        splitFrom: new Map(changes.splits.map((split) => [split.newKey, split.from])),
    };
}

/**
 * Where an item the seed takes from its catalog owner now goes. Pure.
 *
 * @param inputs - The indexed inputs.
 * @param item - The item.
 * @returns The claim, or `undefined` when the seed does not hold the item at all.
 */
function claimOf(inputs: PlanInputs, item: ItemKey): Claim | undefined {
    const owner = inputs.targetOwner.get(item);
    const variant = inputs.target.variants.get(item);

    if (owner?.kind === 'variant' && variant !== undefined) {
        return { by: 'variant', to: { kind: 'root', key: variant.root } };
    }

    if (owner?.kind === 'root') {
        return { by: 'root', to: owner };
    }

    const host = inputs.aliasHost.get(item);

    return host === undefined ? undefined : { by: 'alias', to: host };
}

/**
 * Delete a row the seed takes the item of, and forward it to where the item went (KTD-8).
 *
 * @param state - The plan being built.
 * @param kind - The row's table.
 * @param row - The row.
 * @param claim - Where its item went.
 */
function remove(state: PlanState, kind: OwnerKind, row: HeldRow<string>, claim: Claim): void {
    state.destination.set(forwardSourceKey(kind, row.id), claim.to);
    state.forwardInsert.push({ sourceId: row.id, sourceKind: kind, sourceKey: row.key, target: claim.to });
}

/**
 * Plan an owner's nutrition against what the catalog holds.
 *
 * @param state - The plan being built.
 * @param owner - The owner.
 * @param wanted - The seed's header.
 * @param had - The catalog's header; `undefined` when the owner's row is new, so its header is too.
 */
function planNutrition(
    state: PlanState,
    owner: OwnerKey,
    wanted: ContentNutrition | null,
    had: ContentNutrition | null | undefined,
): void {
    const want = sortedNutrition(wanted);

    if (had === undefined) {
        if (want !== null) {
            state.nutrition.push({ owner, nutrition: want });
        }

        return;
    }

    const have = sortedNutrition(had);

    if (sameJson(want, have)) {
        return;
    }

    state.nutrition.push({ owner, nutrition: want });

    if (!sameJson(want?.citation ?? null, have?.citation ?? null)) {
        state.changes.push({
            kind: 'citationChanged',
            owner,
            from: have?.citation ?? null,
            to: want?.citation ?? null,
        });
    }

    if (!sameJson(want?.values ?? null, have?.values ?? null)) {
        state.changes.push({ kind: 'nutritionValuesChanged', owner });
    }
}

/**
 * Plan a root the catalog holds and the seed keeps or restores.
 *
 * @param state - The plan being built.
 * @param wanted - The seed's root.
 * @param had - The catalog's root.
 * @param write - The row to write when anything differs.
 */
function planKeptRoot(state: PlanState, wanted: ContentRoot, had: ContentRoot, write: RootWrite): void {
    const { seedKey } = wanted;
    const synonymsChanged = !sameJson(wanted.synonyms, had.synonyms);

    if (write.restore) {
        state.changes.push({ kind: 'rootRestored', seedKey, name: wanted.name });
    } else if (wanted.name !== had.name) {
        state.changes.push({ kind: 'rootRenamed', seedKey, from: had.name, to: wanted.name });
    }

    if (synonymsChanged) {
        state.changes.push({ kind: 'rootSynonymsChanged', seedKey, from: had.synonyms, to: wanted.synonyms });
    }

    if (wanted.item !== had.item) {
        state.changes.push({ kind: 'rootItemChanged', seedKey, from: had.item, to: wanted.item });
    }

    if (write.restore || wanted.name !== had.name || wanted.item !== had.item || synonymsChanged) {
        state.rootUpdate.push(write);
    }

    planNutrition(state, { kind: 'root', key: seedKey }, wanted.nutrition, had.nutrition);
}

/**
 * Plan every root key either side holds.
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 */
function planRoots(inputs: PlanInputs, state: PlanState): void {
    const { target, snapshot } = inputs;
    const { content: live, retired, ids } = snapshot;

    for (const seedKey of unionOf(target.roots.keys(), live.roots.keys(), retired.roots.keys())) {
        const wanted = target.roots.get(seedKey);
        const held = heldIn(live.roots, retired.roots, seedKey);
        const id = ids.roots.get(seedKey);

        if (wanted === undefined) {
            if (held !== undefined && id !== undefined) {
                planLeavingRoot(inputs, state, held, { id, key: seedKey });
            }

            continue;
        }

        const write = { seedKey, name: wanted.name, synonyms: wanted.synonyms, item: wanted.item };

        if (held === undefined || id === undefined) {
            const forward = inputs.forwardsBySource.get(forwardSourceKey('root', seedKey));
            const splitFrom = inputs.splitFrom.get(seedKey);

            state.rootFate.set(seedKey, 'inserted');
            state.rootInsert.push({ ...write, id: forward?.sourceId ?? null, restore: false });
            planNutrition(state, { kind: 'root', key: seedKey }, wanted.nutrition, undefined);

            if (forward !== undefined) {
                state.restoredForwards.add(forward.sourceId);
                state.changes.push({ kind: 'rootRestored', seedKey, name: wanted.name });
            } else if (splitFrom !== undefined) {
                state.changes.push({ kind: 'rootSplit', seedKey, name: wanted.name, from: splitFrom });
            } else {
                state.changes.push({ kind: 'rootAdded', seedKey, name: wanted.name });
            }

            continue;
        }

        const restore = held.state === 'retired';

        state.rootFate.set(seedKey, restore ? 'restored' : 'kept');
        planKeptRoot(state, wanted, held.row, { ...write, id, restore });
    }
}

/**
 * Plan a root the catalog holds and the seed no longer names.
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 * @param held - The catalog's root.
 * @param row - Its id and key.
 */
function planLeavingRoot(inputs: PlanInputs, state: PlanState, held: Held<ContentRoot>, row: HeldRow<SeedKey>): void {
    const claim = claimOf(inputs, held.row.item);

    if (claim !== undefined) {
        state.rootFate.set(row.key, 'deleted');
        state.rootDelete.push(row);
        remove(state, 'root', row, claim);
        state.changes.push({
            kind: 'rootRemoved',
            seedKey: row.key,
            name: held.row.name,
            reason: claim.by === 'variant' ? 'merged' : claim.by === 'root' ? 'displaced' : 'aliased',
            to: claim.to,
        });
    } else if (held.state === 'live') {
        state.rootFate.set(row.key, 'retired');
        state.rootRetire.push(row);
        state.changes.push({ kind: 'rootRetired', seedKey: row.key, name: held.row.name });
    } else {
        state.rootFate.set(row.key, 'staysRetired');
    }
}

/**
 * Plan a variant's nutrition and parts.
 *
 * @param state - The plan being built.
 * @param wanted - The seed's variant.
 * @param had - The catalog's variant when its row survives the apply; `undefined` for a new or re-inserted row.
 */
function planVariantChildren(state: PlanState, wanted: ContentVariant, had: ContentVariant | undefined): void {
    planNutrition(state, { kind: 'variant', key: wanted.item }, wanted.nutrition, had?.nutrition);

    if (had === undefined) {
        state.parts.push({ item: wanted.item, parts: wanted.parts });
    } else if (!sameJson(wanted.parts, had.parts)) {
        state.parts.push({ item: wanted.item, parts: wanted.parts });
        state.changes.push({ kind: 'variantPartsChanged', item: wanted.item, from: had.parts, to: wanted.parts });
    }
}

/**
 * Plan every variant key either side holds. Runs after {@link planRoots}, whose fates it reads.
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 */
function planVariants(inputs: PlanInputs, state: PlanState): void {
    const { target, snapshot } = inputs;
    const { content: live, retired, ids } = snapshot;

    for (const item of unionOf(target.variants.keys(), live.variants.keys(), retired.variants.keys())) {
        const wanted = target.variants.get(item);
        const held = heldIn(live.variants, retired.variants, item);
        const id = ids.variants.get(item);

        if (wanted === undefined) {
            if (held !== undefined && id !== undefined) {
                planLeavingVariant(inputs, state, held, { id, key: item });
            }

            continue;
        }

        if (held === undefined || id === undefined) {
            const forward = inputs.forwardsBySource.get(forwardSourceKey('variant', item));

            state.variantFate.set(item, 'inserted');
            state.variantInsert.push({ id: forward?.sourceId ?? null, item, root: wanted.root });
            state.changes.push({
                kind: forward === undefined ? 'variantAdded' : 'variantRestored',
                item,
                root: wanted.root,
            });

            if (forward !== undefined) {
                state.restoredForwards.add(forward.sourceId);
            }

            planVariantChildren(state, wanted, undefined);
            continue;
        }

        if (held.row.root !== wanted.root) {
            state.variantFate.set(item, 'moved');
            state.variantDelete.push({ id, key: item });
            state.variantInsert.push({ id, item, root: wanted.root });
            state.changes.push({ kind: 'variantMoved', item, from: held.row.root, to: wanted.root });
            // The delete cascades the variant's header and parts, so both are written again.
            planVariantChildren(state, wanted, undefined);
            continue;
        }

        if (held.state === 'retired') {
            state.variantFate.set(item, 'restored');
            state.variantRestore.push({ id, key: item });
            state.changes.push({ kind: 'variantRestored', item, root: wanted.root });
        } else {
            state.variantFate.set(item, 'kept');
        }

        planVariantChildren(state, wanted, held.row);
    }
}

/**
 * Plan a variant the catalog holds and the seed no longer names.
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 * @param held - The catalog's variant.
 * @param row - Its id and key.
 */
function planLeavingVariant(
    inputs: PlanInputs,
    state: PlanState,
    held: Held<ContentVariant>,
    row: HeldRow<ItemKey>,
): void {
    const claim = claimOf(inputs, row.key);

    if (claim !== undefined) {
        state.variantFate.set(row.key, 'deleted');
        state.variantDelete.push(row);
        remove(state, 'variant', row, claim);
        state.changes.push({
            kind: 'variantRemoved',
            item: row.key,
            root: held.row.root,
            reason: claim.by === 'alias' ? 'aliased' : 'promoted',
            to: claim.to,
        });

        return;
    }

    state.variantFate.set(row.key, held.state === 'live' ? 'retired' : 'staysRetired');

    if (held.state === 'live') {
        state.variantRetire.push(row);
        state.changes.push({ kind: 'variantRetired', item: row.key, root: held.row.root });
    }

    if (state.rootFate.get(held.row.root) === 'deleted') {
        state.issues.push({
            where: row.key,
            rule: 'retiredVariantLosesRoot',
            detail: `it stays retired under ${held.row.root}, which the seed removes`,
        });
    }
}

/**
 * Plan every item either side holds. Runs after the owners, whose fates decide which items survive.
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 */
function planItems(inputs: PlanInputs, state: PlanState): void {
    const { target, snapshot } = inputs;
    const { content: live, retired, ids } = snapshot;
    const endsRetired = (fate: Fate | undefined): boolean => fate === 'retired' || fate === 'staysRetired';
    const heldRoots = [...live.roots.values(), ...retired.roots.values()];
    const heldVariants = [...live.variants.values(), ...retired.variants.values()];
    const heldOwnerKind = new Map<ItemKey, OwnerKind>([
        ...heldRoots.map((root): [ItemKey, OwnerKind] => [root.item, 'root']),
        ...heldVariants.map((variant): [ItemKey, OwnerKind] => [variant.item, 'variant']),
    ]);
    const stillHeld = new Set<ItemKey>([
        ...heldRoots.filter((root) => endsRetired(state.rootFate.get(root.seedKey))).map((root) => root.item),
        ...heldVariants.filter((variant) => endsRetired(state.variantFate.get(variant.item))).map((v) => v.item),
    ]);
    // Every owner whose nutrition this plan rewrites, read once: the nutrition writes are complete before the item pass,
    // and a scan of them per item was quadratic (23 s over the full baseline).
    const rewrittenOwners = new Set(state.nutrition.map((write) => ownerText(write.owner)));

    for (const key of unionOf(target.items.keys(), live.items.keys(), retired.items.keys())) {
        const wanted = target.items.get(key);
        const held = heldIn(live.items, retired.items, key);
        const id = ids.items.get(key);
        const owner = inputs.targetOwner.get(key);

        if (wanted === undefined || owner === undefined) {
            if (id !== undefined && !stillHeld.has(key)) {
                state.itemDelete.push({ id, key });
            }

            continue;
        }

        if (held === undefined || id === undefined) {
            state.itemInsert.push({ key, ownerKind: owner.kind });
            state.itemChildren.push(sortedItem(wanted));
            continue;
        }

        if (heldOwnerKind.get(key) !== owner.kind) {
            state.itemReown.push({ id, key, ownerKind: owner.kind });
        }

        if (!sameJson(sortedItem(wanted), sortedItem(held.row))) {
            state.itemChildren.push(sortedItem(wanted));
            state.changes.push({ kind: 'itemChanged', item: key });
            continue;
        }

        // A cited portion is deleted with its citation (0018: `citation_id` ON DELETE CASCADE), and rewriting the
        // owner's nutrition replaces that citation, so the item's children are written again with no change of their own.
        const rewritesCitation = rewrittenOwners.has(ownerText(owner));

        if (rewritesCitation && wanted.portions.some((portion) => 'citation' in portion)) {
            state.itemChildren.push(sortedItem(wanted));
        }
    }
}

/**
 * Claim every live, unauthored, non-seed food whose normalized name a seed root takes (KTD-12's one exception).
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 */
function planClaims(inputs: PlanInputs, state: PlanState): void {
    for (const root of inputs.target.roots.values()) {
        const id = inputs.snapshot.liveNames.get(normalizeName(root.name));

        if (id !== undefined) {
            const to: OwnerKey = { kind: 'root', key: root.seedKey };

            state.claims.push({ id, by: root.seedKey });
            state.destination.set(forwardSourceKey('root', id), to);
            state.forwardInsert.push({ sourceId: id, sourceKind: 'root', sourceKey: null, target: to });
            state.changes.push({ kind: 'liveFoodClaimed', id, seedKey: root.seedKey });
        }
    }
}

/**
 * Plan every forward the catalog holds: delete a restored row's, re-target one whose target leaves, re-insert one
 * whose target moves, and refuse one whose target the seed retires. Runs last.
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 */
function planForwards(inputs: PlanInputs, state: PlanState): void {
    const { ids } = inputs.snapshot;
    const ownerById = new Map<string, OwnerKey>([
        ...[...ids.roots].map(([key, id]): [string, OwnerKey] => [forwardSourceKey('root', id), { kind: 'root', key }]),
        ...[...ids.variants].map(([key, id]): [string, OwnerKey] => [
            forwardSourceKey('variant', id),
            { kind: 'variant', key },
        ]),
    ]);

    for (const forward of inputs.snapshot.forwards) {
        if (state.restoredForwards.has(forward.sourceId)) {
            state.forwardDelete.push(forward.sourceId);
            continue;
        }

        const targetId = forward.target;
        const destination = state.destination.get(forwardSourceKey(targetId.kind, targetId.id));
        const owner = ownerById.get(forwardSourceKey(targetId.kind, targetId.id));
        const fate = owner?.kind === 'root' ? state.rootFate.get(owner.key) : owner && state.variantFate.get(owner.key);
        const reinsertTo = destination ?? (fate === 'moved' ? owner : undefined);

        if (reinsertTo !== undefined) {
            // A moved target is deleted and re-inserted under its own id; the forward's key would block the delete.
            state.forwardDelete.push(forward.sourceId);
            state.forwardInsert.push({ ...forward, target: reinsertTo });
        } else if (owner !== undefined && fate === 'retired') {
            state.issues.push({
                where: owner.key,
                rule: 'forwardStranded',
                detail: `forward ${forward.sourceId} resolves to it, and the seed retires it`,
            });
        }
    }
}

/**
 * Refuse a source row a live, non-seed item holds (Q1).
 *
 * @param inputs - The indexed inputs.
 * @param state - The plan being built.
 */
function planLiveSources(inputs: PlanInputs, state: PlanState): void {
    for (const item of inputs.target.items.values()) {
        for (const source of item.sources) {
            if (inputs.snapshot.liveSourceKeys.has(sourceRefKey(source))) {
                state.issues.push({
                    where: item.key,
                    rule: 'liveSourceHeld',
                    detail: `${source.source} ${source.externalKey} is a source row of a live item the seed does not own`,
                });
            }
        }
    }
}

/**
 * Plan a seed against a catalog. Pure.
 *
 * @param target - The seed's content: every live row it describes.
 * @param snapshot - What the catalog holds.
 * @param changes - The seed's declared changes. They carry no planning authority: where each item goes is read off
 *   the target, because an older seed restoring a newer one's rows declares none of the reverse moves (R33). A
 *   declared split names the root a new root splits from, for the diff.
 * @returns The canonical plan.
 * @throws {CatalogPlanRefusedError} with every issue found.
 */
export function buildCatalogPlan(
    target: CatalogContent,
    snapshot: CatalogSnapshot,
    changes: CatalogChanges,
): CatalogPlan {
    const inputs = indexInputs(target, snapshot, changes);
    const state: PlanState = {
        issues: [],
        changes: [],
        claims: [],
        rootInsert: [],
        rootUpdate: [],
        rootRetire: [],
        rootDelete: [],
        variantInsert: [],
        variantRestore: [],
        variantRetire: [],
        variantDelete: [],
        itemInsert: [],
        itemReown: [],
        itemDelete: [],
        itemChildren: [],
        nutrition: [],
        parts: [],
        forwardDelete: [],
        forwardInsert: [],
        rootFate: new Map(),
        variantFate: new Map(),
        destination: new Map(),
        restoredForwards: new Set(),
    };

    planLiveSources(inputs, state);
    planRoots(inputs, state);
    planVariants(inputs, state);
    planItems(inputs, state);
    planClaims(inputs, state);
    planForwards(inputs, state);

    if (state.issues.length > 0) {
        throw new CatalogPlanRefusedError(sortedBy(state.issues, (issue) => `${issue.where}\u0000${issue.rule}`));
    }

    return {
        changes: sortedBy(state.changes, changeSortKey),
        rows: {
            claims: sortedBy(state.claims, (row) => row.id),
            roots: {
                insert: sortedBy(state.rootInsert, (row) => row.seedKey),
                update: sortedBy(state.rootUpdate, (row) => row.seedKey),
                retire: sortedBy(state.rootRetire, (row) => row.key),
                delete: sortedBy(state.rootDelete, (row) => row.key),
            },
            variants: {
                insert: sortedBy(state.variantInsert, (row) => row.item),
                restore: sortedBy(state.variantRestore, (row) => row.key),
                retire: sortedBy(state.variantRetire, (row) => row.key),
                delete: sortedBy(state.variantDelete, (row) => row.key),
            },
            items: {
                insert: sortedBy(state.itemInsert, (row) => row.key),
                reown: sortedBy(state.itemReown, (row) => row.key),
                delete: sortedBy(state.itemDelete, (row) => row.key),
            },
            itemChildren: sortedBy(state.itemChildren, (row) => row.key),
            nutrition: sortedBy(state.nutrition, (row) => ownerText(row.owner)),
            parts: sortedBy(state.parts, (row) => row.item),
            forwards: {
                delete: [...state.forwardDelete].sort(compareText),
                insert: sortedBy(state.forwardInsert, (row) => row.sourceId),
            },
        },
    };
}

/**
 * Whether a plan writes nothing. Pure.
 *
 * @param plan - A plan.
 * @returns `true` when every row list is empty.
 */
export function isEmptyPlan(plan: CatalogPlan): boolean {
    const { claims, roots, variants, items, itemChildren, nutrition, parts, forwards } = plan.rows;

    return [
        claims,
        roots.insert,
        roots.update,
        roots.retire,
        roots.delete,
        variants.insert,
        variants.restore,
        variants.retire,
        variants.delete,
        items.insert,
        items.reown,
        items.delete,
        itemChildren,
        nutrition,
        parts,
        forwards.delete,
        forwards.insert,
    ].every((rows) => rows.length === 0);
}
