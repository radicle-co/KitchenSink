/**
 * The ONE reader that maps a source item to the live catalog entry that stands for it (curated catalog plan U8 S4,
 * R19; ADR-0050 §4).
 *
 * A key resolves in this order:
 *
 * 1. The root or variant that OWNS the keyed item (`food_sources` → `food_item.owner_kind`).
 * 2. Else the live seed root that CITES the key on its own nutrition — a stand-in. An owner always beats a stand-in.
 * 3. Then a RETIRED ref's forwards are followed to a live ref; a live ref is its own answer. A chain past its bound,
 *    or a cycle, answers nothing and is recorded.
 *
 * Catalog only: an authored root is never an answer, because live search has no caller and the edge-cached batch
 * must not vary by one (ADR-0020). Search, live search, the resolver and the batch read through this one reader, so
 * "which entry stands for this item" has one answer.
 *
 * @pattern Facade — composes `FoodSourcesDao`, `FoodForwardDao`, `FoodVariantDao` and `FoodDao` behind one question
 * @module
 */
import { Injectable } from '@nestjs/common';

import { FoodMetrics } from '../observability/emfMetrics.js';
import type { FoodSourceId } from '../sources/foodSourceAdapter.js';
import { FoodDao, type FoodRefFacts } from './dao/food.dao.js';
import { FoodForwardDao, type ForwardOutcome } from './dao/foodForward.dao.js';
import { FoodSourcesDao } from './dao/foodSources.dao.js';
import { FoodVariantDao, type VariantFacts, type VariantPartFact } from './dao/foodVariant.dao.js';
import { refIdsToRead, refTargetOf, type RefFacts } from './domain/foodRefResolution.js';
import type { FoodRef } from './foods.schema.js';

/** The live catalog entry that stands for a source item. */
export interface CatalogOwner {
    readonly kind: 'root' | 'variant';
    /** The live root's or variant's id. */
    readonly id: string;
    /** Its root: itself for a root. */
    readonly rootId: string;
    /** The root's name. */
    readonly rootName: string | null;
    /** Whether the seed owns the entry the key first named. */
    readonly seedOwned: boolean;
    /** The variant's label; empty for a root. */
    readonly parts: readonly VariantPartFact[];
}

/** A reference before forwards are followed. */
interface RawRef {
    readonly kind: 'root' | 'variant';
    readonly id: string;
    readonly seedOwned: boolean;
}

@Injectable()
export class CatalogOwnerReader {
    public constructor(
        private readonly sources: FoodSourcesDao,
        private readonly forwards: FoodForwardDao,
        private readonly variants: FoodVariantDao,
        private readonly foods: FoodDao,
        private readonly metrics: FoodMetrics,
    ) {}

    /**
     * The live catalog entry standing for each keyed source item.
     *
     * @param source - The source.
     * @param externalKeys - That source's keys, as its adapter spells them.
     * @returns The owner by key; a key with no live catalog owner is absent.
     * @sideEffect Reads the crosswalk, the citations, the forwards, the variants and the roots; may emit a metric.
     */
    public async ownersOfKeys(
        source: FoodSourceId,
        externalKeys: readonly string[],
    ): Promise<Map<string, CatalogOwner>> {
        if (externalKeys.length === 0) {
            return new Map();
        }

        const owners = await this.liveByKey(
            new Map(
                (await this.sources.ownersOf(source, externalKeys)).map((owner) => [
                    owner.externalKey,
                    { kind: owner.kind, id: owner.id, seedOwned: owner.seedOwned },
                ]),
            ),
        );
        // After liveness, never before: an owner that retired with no forward is no owner, and must not hide the seed
        // root that cites the key (db-arch-1 U8 review, finding 4).
        const unowned = externalKeys.filter((key) => !owners.has(key));

        if (unowned.length > 0) {
            const citing = new Map<string, RawRef>();

            for (const [key, rootId] of await this.sources.citingSeedRoots(source, unowned)) {
                citing.set(key, { kind: 'root', id: rootId, seedOwned: true });
            }

            for (const [key, owner] of await this.liveByKey(citing)) {
                owners.set(key, owner);
            }
        }

        return owners;
    }

    /**
     * The live catalog owner each key's ref stands for, with `seedOwned` from the ref the key named.
     *
     * @param raw - The ref by key.
     * @returns The live owner by key; a key whose ref has no live end is absent.
     * @sideEffect Reads the forwards, the variants and the roots; may emit a metric.
     */
    private async liveByKey(raw: ReadonlyMap<string, RawRef>): Promise<Map<string, CatalogOwner>> {
        const live = await this.liveOwnersOf([...raw.values()]);
        const owners = new Map<string, CatalogOwner>();

        for (const [key, ref] of raw) {
            const owner = live.get(ref.id);

            if (owner !== undefined) {
                owners.set(key, { ...owner, seedOwned: ref.seedOwned });
            }
        }

        return owners;
    }

    /**
     * Everything `resolveFoodRefs` decides over for these refs (curated U8 S5): each named root and variant, retired
     * ones included; the forward outcome of each retired one; and the roots and variants those chains end at, with
     * every variant's root. Authorship stays the resolver's: an authored root is read here like any other.
     *
     * @param refs - The refs as the caller sent them.
     * @returns The facts.
     * @sideEffect Reads `food`, `food_variant`, `food_variant_part` and `food_forward`; may emit a metric.
     */
    public async refFacts(refs: readonly FoodRef[]): Promise<RefFacts> {
        const ids = refIdsToRead(refs);
        const roots = new Map<string, FoodRefFacts>();
        const variants = new Map<string, VariantFacts>();
        const [rootRows, variantRows] = await Promise.all([this.rootFacts(ids.roots), this.variantFacts(ids.variants)]);

        for (const row of rootRows) {
            roots.set(row.id, row);
        }

        for (const row of variantRows) {
            variants.set(row.id, row);
        }

        const retired = [...rootRows, ...variantRows].filter((row) => row.retired).map((row) => row.id);
        const forwards: ReadonlyMap<string, ForwardOutcome> =
            retired.length === 0 ? new Map() : await this.forwards.follow(retired);

        for (const outcome of forwards.values()) {
            if (!outcome.resolved) {
                this.metrics.recordForwardUnresolved();
            }
        }

        const ends = [...forwards.values()].flatMap((outcome) => (outcome.resolved ? [outcome] : []));
        const endVariants = ends.filter((end) => end.kind === 'variant' && !variants.has(end.id)).map((end) => end.id);

        for (const row of await this.variantFacts(endVariants)) {
            variants.set(row.id, row);
        }

        const missingRoots = [
            ...new Set([
                ...ends.filter((end) => end.kind === 'root').map((end) => end.id),
                ...[...variants.values()].map((variant) => variant.rootId),
            ]),
        ].filter((id) => !roots.has(id));

        for (const row of await this.rootFacts(missingRoots)) {
            roots.set(row.id, row);
        }

        return { roots, variants, forwards };
    }

    /**
     * The given roots' facts, with no read for none.
     *
     * @param ids - Root ids.
     * @returns Their facts.
     * @sideEffect Reads `food` when `ids` is not empty.
     */
    private async rootFacts(ids: readonly string[]): Promise<FoodRefFacts[]> {
        return ids.length === 0 ? [] : this.foods.readRefFacts(ids);
    }

    /**
     * The given variants' facts, with no read for none.
     *
     * @param ids - Variant ids.
     * @returns Their facts.
     * @sideEffect Reads `food_variant` and `food_variant_part` when `ids` is not empty.
     */
    private async variantFacts(ids: readonly string[]): Promise<VariantFacts[]> {
        return ids.length === 0 ? [] : this.variants.readFacts(ids);
    }

    /**
     * Each ref's live end, through the resolver's own {@link refTargetOf}: a live ref is itself, and only a retired
     * one follows its forward. A forward on a live ref is not an answer (KTD-12), so search and `GET /{id}` agree.
     *
     * @param refs - The refs.
     * @returns The live catalog owner by the REF's id.
     * @sideEffect Reads the roots, the variants and the retired refs' forwards; emits a metric per unresolved chain.
     */
    private async liveOwnersOf(refs: readonly RawRef[]): Promise<Map<string, CatalogOwner>> {
        const owners = new Map<string, CatalogOwner>();

        if (refs.length === 0) {
            return owners;
        }

        const facts = await this.refFacts(refs);

        for (const ref of refs) {
            const target = refTargetOf(ref, facts);
            const owner = target === undefined ? undefined : ownerOf(target, facts.variants, facts.roots);

            if (owner !== undefined) {
                owners.set(ref.id, owner);
            }
        }

        return owners;
    }
}

/**
 * The live catalog owner a chain ends at, or `undefined` when the end is retired, authored or unknown. Pure.
 *
 * @param target - The chain's end.
 * @param variantFacts - The variants read.
 * @param rootFacts - The roots read.
 * @returns The owner, before `seedOwned` is set from the ref the key first named.
 */
function ownerOf(
    target: { readonly kind: 'root' | 'variant'; readonly id: string },
    variantFacts: ReadonlyMap<string, VariantFacts>,
    rootFacts: ReadonlyMap<string, FoodRefFacts>,
): CatalogOwner | undefined {
    const variant = target.kind === 'variant' ? variantFacts.get(target.id) : undefined;

    if (target.kind === 'variant' && (variant === undefined || variant.retired)) {
        return undefined;
    }

    const root = rootFacts.get(variant?.rootId ?? target.id);

    if (root === undefined || root.retired || root.userId !== null || root.status === 'DELETING') {
        return undefined;
    }

    return {
        kind: target.kind,
        id: target.id,
        rootId: root.id,
        rootName: root.name,
        seedOwned: false,
        parts: variant?.parts ?? [],
    };
}
