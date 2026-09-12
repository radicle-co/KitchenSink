/**
 * What a seeded catalog holds, by natural key (curated catalog plan U5, KTD-8, KTD-11, KTD-19).
 *
 * @pattern Port — `CatalogSnapshotSource` is read by the planner; the database DAO and the seed projection are its
 *   two adapters, so the CI diff and the deploy apply plan against the same shape
 *
 * Every row is named by its natural key, never by its id: a root by its frozen seed key, a variant and an item by the
 * item's key (KTD-8). Ids appear only in {@link SnapshotIds} and {@link SnapshotForward}, which is how the planner
 * reuses an id instead of minting a second one for a key.
 *
 * ⚠️ Every value a planner compares is spelled ONE way, so two adapters cannot disagree about equal content:
 *
 * - a decimal is {@link canonicalDecimal}'s spelling (no trailing zeros, no exponent), because node-postgres returns
 *   `numeric` at its stored scale while the projection computes its own;
 * - a USDA external key is {@link usdaExternalKey}'s bare FDC id, the live adapter's spelling (`String(fdcId)`), in
 *   `food_sources` and in a USDA citation alike;
 * - every list is in {@link compareText} order of its natural key, except a root's synonyms and a variant's parts,
 *   whose order is content.
 */
import Decimal from 'decimal.js';

import type { RegisteredSourceId } from '../../../sources/sourceRegister.js';
import { fdcIdOf, type FdcKey, type ItemKey, type SeedKey } from '../catalogKey.js';
import type { CitationDataset } from '../citationDatasets.js';
import type { CitationMatch } from './citationPrecedence.js';
import type { CuratedPart } from './curatedSeedFormat.js';

/** One source row of an item: the source and that source's key for the item, in stored spelling. */
export interface ContentSource {
    readonly source: RegisteredSourceId;
    readonly externalKey: string;
}

/** One household measure of an item, from a source row of that item. */
export interface SourcePortion {
    readonly label: string;
    readonly gramWeight: string;
    readonly source: ContentSource;
}

/**
 * One household measure a citation states (OQ-1): a label's serving, or a Branded product's household serving, as a
 * portion of the item of the root or variant whose nutrition cites it. `citation` is that owner's citation, which
 * 0018's `food_portions.citation_id` names, so the portion is deleted with it.
 */
export interface CitedPortion {
    readonly label: string;
    readonly gramWeight: string;
    readonly citation: ContentCitation;
}

/** One household measure of an item: from a source row, or from a citation; never both (0018's one-provenance CHECK). */
export type ContentPortion = SourcePortion | CitedPortion;

/** An item's FNDDS consumption prior (R45). */
export interface ContentPopularity {
    readonly weight: string;
    readonly priorFraction: string;
    /** The survey cycle the weights come from (`sourcePins.json`'s `fnddsPrior.label`): `food_popularity.source`. */
    readonly source: string;
}

/** One classification of an item, and the source row that states it (`null` when no source row does). */
export interface ContentCategory {
    /** The `food_category` dictionary entry's name. */
    readonly name: string;
    readonly source: ContentSource | null;
}

/** One item: the unit sources, portions and popularity attach to (KTD-6). */
export interface ContentItem {
    readonly key: ItemKey;
    readonly sources: readonly ContentSource[];
    readonly portions: readonly ContentPortion[];
    /** In name order, then source order, a source-less category first. */
    readonly categories: readonly ContentCategory[];
    /** `null` when no source row carries a weight: the item has no `food_popularity` row. */
    readonly popularity: ContentPopularity | null;
}

/** A citation of a source's entry (a source item, a stand-in, a Branded product or a table line). */
export interface SourceEntryCitation {
    readonly dataset: Exclude<CitationDataset, 'label'>;
    readonly externalKey: string;
    readonly match: CitationMatch;
    /** The density R54's per-100-mL conversion used, or `null`. */
    readonly densityGPerMl: string | null;
    /** Whether energy was converted from kJ (R54). */
    readonly kcalFromKj: boolean;
}

/** A citation of a manufacturer's Nutrition Facts label (KTD-20). */
export interface LabelCitation {
    readonly dataset: 'label';
    readonly url: string;
    readonly retrievedOn: string;
    readonly manufacturer: string;
    readonly servingLabel: string;
    readonly servingGrams: string;
}

/** A nutrition header's one citation: which shape it is is read off `dataset`, as 0018's two CHECKs read it. */
export type ContentCitation = SourceEntryCitation | LabelCitation;

/** One value per 100 g under its `nutrient` dictionary entry. A trace mark has no amount (R53). */
export interface ContentValue {
    readonly name: string;
    readonly unit: string;
    /** `null` exactly when the source printed a trace mark. */
    readonly amount: string | null;
}

/** A root's or variant's nutrition: one header, its citation, and its values (KTD-19). */
export interface ContentNutrition {
    readonly citation: ContentCitation;
    readonly values: readonly ContentValue[];
}

/** One root. */
export interface ContentRoot {
    readonly seedKey: SeedKey;
    readonly name: string;
    /** In seed order, which is display order. */
    readonly synonyms: readonly string[];
    readonly item: ItemKey;
    /** `null` when the seed states no numbers for the root (GR-019). */
    readonly nutrition: ContentNutrition | null;
}

/** One variant, named by its item. */
export interface ContentVariant {
    readonly item: ItemKey;
    readonly root: SeedKey;
    /** In attribute order, then ordinal: the order is the label. */
    readonly parts: readonly CuratedPart[];
    readonly nutrition: ContentNutrition;
}

/** Catalog rows by natural key. */
export interface CatalogContent {
    readonly roots: ReadonlyMap<SeedKey, ContentRoot>;
    readonly variants: ReadonlyMap<ItemKey, ContentVariant>;
    /** Every item a root or variant of this content owns. */
    readonly items: ReadonlyMap<ItemKey, ContentItem>;
}

/** The id of every seed row, live or retired, by natural key. */
export interface SnapshotIds {
    readonly roots: ReadonlyMap<SeedKey, string>;
    readonly variants: ReadonlyMap<ItemKey, string>;
    readonly items: ReadonlyMap<ItemKey, string>;
}

/** Which table an owner id names. */
export type OwnerKind = 'root' | 'variant';

/** One `food_forward` row. */
export interface SnapshotForward {
    readonly sourceId: string;
    readonly sourceKind: OwnerKind;
    /** The deleted seed row's natural key; `null` for a forward the live path wrote (KTD-12). */
    readonly sourceKey: string | null;
    readonly target: { readonly kind: OwnerKind; readonly id: string };
}

/** What a catalog holds that a plan must respect. */
export interface CatalogSnapshot {
    /** The live seed rows. */
    readonly content: CatalogContent;
    /** The retired seed rows, and the items they own (KTD-8: a retired owner keeps its item). */
    readonly retired: CatalogContent;
    readonly ids: SnapshotIds;
    readonly forwards: readonly SnapshotForward[];
    /** Live catalog foods that are neither seeded nor authored, id by normalized name (KTD-12's exception). */
    readonly liveNames: ReadonlyMap<string, string>;
    /** {@link sourceRefKey} of every source row a live, non-seed item holds (Q1). */
    readonly liveSourceKeys: ReadonlySet<string>;
}

/** Reads a catalog snapshot. */
export interface CatalogSnapshotSource {
    /**
     * Read the snapshot.
     *
     * @sideEffect An adapter may read a database inside its caller's transaction.
     * @returns The snapshot.
     */
    read(): Promise<CatalogSnapshot>;
}

/**
 * Spell a decimal the one way the port compares it: plain notation, no trailing zeros. Pure.
 *
 * @param value - A decimal string.
 * @returns Its canonical spelling.
 * @throws {Error} from `decimal.js` for a string that is not a number.
 */
export function canonicalDecimal(value: string): string {
    return new Decimal(value).toFixed();
}

/**
 * A USDA item's external key in stored spelling: the bare FDC id, as the live adapter writes it. Pure.
 *
 * @param key - The item's natural key.
 * @returns `String(fdcId)`.
 */
export function usdaExternalKey(key: FdcKey): string {
    return String(fdcIdOf(key));
}

/**
 * The one string a source row's identity compares by. Pure.
 *
 * @param source - A source row.
 * @returns `source` and `externalKey`, joined by a NUL, which neither can contain.
 */
export function sourceRefKey(source: ContentSource): string {
    return `${source.source}\u0000${source.externalKey}`;
}

/**
 * Order two strings by UTF-16 code unit, never by locale, so every runtime sorts alike. Pure.
 *
 * @param left - A string.
 * @param right - A string.
 * @returns Negative, zero or positive.
 */
export function compareText(left: string, right: string): number {
    if (left === right) {
        return 0;
    }

    return left < right ? -1 : 1;
}

/**
 * Order categories by name, then source, a source-less one first: the one order both adapters and the planner use.
 * Pure.
 *
 * @param left - A category.
 * @param right - A category.
 * @returns Negative, zero or positive.
 */
export function compareCategories(left: ContentCategory, right: ContentCategory): number {
    const sourceOf = (category: ContentCategory): string =>
        category.source === null ? '' : sourceRefKey(category.source);

    return compareText(left.name, right.name) || compareText(sourceOf(left), sourceOf(right));
}

/**
 * The text a portion's provenance orders by: a source row by {@link sourceRefKey}, a citation by its dataset and key.
 * Pure.
 *
 * @param portion - A portion.
 * @returns The text.
 */
function portionProvenance(portion: ContentPortion): string {
    if ('citation' in portion) {
        const { citation } = portion;

        return `citation\u0000${citation.dataset}\u0000${citation.dataset === 'label' ? citation.url : citation.externalKey}`;
    }

    return `source\u0000${sourceRefKey(portion.source)}`;
}

/**
 * Order portions by provenance, then label, then grams: the one order both adapters and the planner use. Pure.
 *
 * @param left - A portion.
 * @param right - A portion.
 * @returns Negative, zero or positive.
 */
export function comparePortions(left: ContentPortion, right: ContentPortion): number {
    return (
        compareText(portionProvenance(left), portionProvenance(right)) ||
        compareText(left.label, right.label) ||
        compareText(left.gramWeight, right.gramWeight)
    );
}

/** An empty content. */
export const EMPTY_CONTENT: CatalogContent = { roots: new Map(), variants: new Map(), items: new Map() };

/** A snapshot of an empty catalog: what a `template0` database holds after migrate. */
export const EMPTY_SNAPSHOT: CatalogSnapshot = {
    content: EMPTY_CONTENT,
    retired: EMPTY_CONTENT,
    ids: { roots: new Map(), variants: new Map(), items: new Map() },
    forwards: [],
    liveNames: new Map(),
    liveSourceKeys: new Set(),
};
