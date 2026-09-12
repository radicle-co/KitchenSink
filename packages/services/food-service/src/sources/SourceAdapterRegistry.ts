/**
 * `SourceAdapterRegistry` — the in-process registry of wired source adapters plus the static
 * source-priority order the merge engine consults (MOD-015).
 *
 * Populated once at bootstrap and read-only thereafter. Adding a source is additive — implement
 * {@link FoodSourceAdapter}, append the `food_source` enum value, and call `register` once
 * (FR-MRG-4/FR-ADP-1).
 */
import { DuplicateSourceError, UnknownSourceError } from './foodSource.errors.js';
import { SOURCE_PRIORITY, type FoodSourceAdapter, type FoodSourceId } from './foodSourceAdapter.js';

export class SourceAdapterRegistry {
    private readonly adaptersBySource = new Map<FoodSourceId, FoodSourceAdapter>();

    /**
     * Register an adapter for its source.
     *
     * @param adapter - The adapter to wire.
     * @throws {DuplicateSourceError} when a source already has a registered adapter.
     * @sideEffect Mutates the in-process registry map.
     */
    public register(adapter: FoodSourceAdapter): void {
        if (this.adaptersBySource.has(adapter.source)) {
            throw new DuplicateSourceError(adapter.source);
        }

        this.adaptersBySource.set(adapter.source, adapter);
    }

    /**
     * Whether a source has a registered adapter.
     *
     * @param source - The source.
     * @returns `true` when an adapter is registered for `source`.
     */
    public has(source: FoodSourceId): boolean {
        return this.adaptersBySource.has(source);
    }

    /**
     * Resolve the adapter for a source.
     *
     * @param source - The source.
     * @returns The registered adapter.
     * @throws {UnknownSourceError} when no adapter is registered for `source`.
     */
    public adapterFor(source: FoodSourceId): FoodSourceAdapter {
        const adapter = this.adaptersBySource.get(source);

        if (adapter === undefined) {
            throw new UnknownSourceError(source);
        }

        return adapter;
    }

    /**
     * All wired adapters, in priority order (highest priority first).
     *
     * @returns The registered adapters ordered by {@link SOURCE_PRIORITY}.
     */
    public adapters(): FoodSourceAdapter[] {
        return SOURCE_PRIORITY.filter((source) => this.adaptersBySource.has(source)).map((source) =>
            this.adapterFor(source),
        );
    }

    /**
     * The priority of a source (higher number = higher priority). Consulted by the merge engine for
     * higher-priority-source-wins scalar/nutrient conflicts (FR-MRG-2). `usda` (index 0) ranks highest.
     *
     * @param source - The source.
     * @returns The source's priority (≥ 1).
     * @throws {UnknownSourceError} when the source is not in {@link SOURCE_PRIORITY}.
     */
    public priorityOf(source: FoodSourceId): number {
        const index = SOURCE_PRIORITY.indexOf(source);

        if (index < 0) {
            throw new UnknownSourceError(source);
        }

        return SOURCE_PRIORITY.length - index;
    }
}
