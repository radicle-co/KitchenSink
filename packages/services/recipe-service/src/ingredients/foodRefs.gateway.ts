/**
 * The recipe service's read path to food's answer about a referenced food: its NAME, lifecycle status and
 * whether it is the caller's private food (plan 002 R9, R10, R51; curated plan U8's `POST /api/v1/foods/refs/resolve`).
 *
 * The recipe database stores no food names, so every bound line's name comes from here, asked AS THE CALLER so
 * food's authorship policy decides what they may see. It is also the anti-corruption layer: food's wire entry
 * becomes the recipe domain's {@link FoodRefAnswer}, with the name parsed into canonical form.
 *
 * ## Two doors, two failure contracts
 *
 * - {@link FoodRefsGateway.resolve} is the READ: total, never rejects. Every transport failure — including a
 *   `404` for the route itself, which is a deploy skew between parallel previews (ADR-0036) and never "no such
 *   food" — becomes `unreachable` for the refs it covered. `absent` is only ever food's own definite answer.
 * - {@link FoodRefsGateway.resolveForBind} is the BIND check (R51): a bind is never made on no answer, so a
 *   transport failure throws `SOURCE_UNAVAILABLE` (502) instead.
 *
 * ⛔ No name cache. Plan 002 R9 allows no fallback name: when food cannot be asked, a line has no name and says
 * so (`FOOD_UNREACHABLE`). The nutrition gateway's stale cache serves NUMBERS, a different contract.
 *
 * ## Where a ref's food lives (curated U9)
 *
 * The answer names the TARGET — `forwardedTo`, else the ref — as its live root and, when the target is a variant, the
 * variant with its parts. An entry food could not have meant (a variant target with no variant facts, or a root target
 * carrying them) is a contract breach, read as `unreachable` and logged: never a guessed root. A variant with no parts
 * never gets here: food's contract refuses one, so the client's parse rejects the whole response.
 *
 * @pattern Gateway + Anti-Corruption Layer over `@kitchensink/food-service-client`
 */
import { Logger } from '@nestjs/common';
import type { FoodRef, FoodRefEntry } from '@kitchensink/food-service-client';
import { MAX_FOOD_REFS } from '@kitchensink/schema-food';

import type { CallerToken } from '../auth/CallerToken.js';
import { apiError } from '../common/apiError.js';
import { foodRefKey } from '../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from './domain/foodRefAnswer.js';
import { canonicalIngredientName } from './domain/ingredientName.js';
import type { FoodServiceClients } from './FoodServiceClients.factory.js';
import { MAX_CONCURRENT_CHUNKS, type NutritionReadBudget } from './foodNutrition.gateway.js';

/** The outcome of one read. Total: it never rejects. */
export interface FoodRefLookup {
    /** Food's answer for every distinct ref asked, keyed by `foodRefKey`. */
    readonly answers: ReadonlyMap<string, FoodRefAnswer>;
    /** Whether any ref could not be asked — for logging and metrics. */
    readonly degraded: boolean;
}

const UNREACHABLE: FoodRefAnswer = { outcome: 'unreachable' };

/** A found entry, as food's contract states it. */
type FoundEntry = Extract<FoodRefEntry, { outcome: 'found' }>;

/**
 * Where a found entry's food lives: its live root and, for a variant target, the variant. Pure.
 *
 * @param entry - Food's found entry.
 * @returns The root and variant, or why food's entry breaches its own contract.
 */
function targetOf(
    entry: FoundEntry,
): Pick<Extract<FoodRefAnswer, { outcome: 'found' }>, 'rootId' | 'variant'> | string {
    const target = entry.forwardedTo ?? entry.ref;

    if (target.kind === 'root') {
        return entry.variant === undefined ? { rootId: target.id } : 'a root target carries variant facts';
    }

    if (entry.variant === undefined) {
        return 'a variant target carries no variant facts';
    }

    return { rootId: entry.variant.rootId, variant: { id: target.id, parts: [...entry.variant.parts] } };
}

/**
 * Translate food's wire entry into the recipe domain's answer.
 *
 * @param entry - Food's entry for one ref.
 * @param onBreach - Told why, when food's entry breaches its contract.
 * @returns The answer; `unreachable` for a breach.
 */
function toAnswer(entry: FoodRefEntry, onBreach: (reason: string, ref: FoodRef) => void): FoodRefAnswer {
    if (entry.outcome === 'absent') {
        return { outcome: 'absent' };
    }

    const target = targetOf(entry);

    if (typeof target === 'string') {
        onBreach(target, entry.ref);

        return UNREACHABLE;
    }

    return {
        outcome: 'found',
        name: entry.name === null ? undefined : canonicalIngredientName(entry.name),
        status: entry.status,
        isPrivate: entry.visibility === 'private',
        ...target,
    };
}

export class FoodRefsGateway {
    private readonly logger = new Logger(FoodRefsGateway.name);

    /** @param clients - The per-caller food client factory. */
    public constructor(private readonly clients: FoodServiceClients) {}

    /**
     * Log a contract breach in food's entry.
     *
     * @sideEffect One warning.
     */
    private readonly breach = (reason: string, ref: FoodRef): void => {
        this.logger.warn('food refs entry breaches its contract; read as unreachable', {
            reason,
            ref: foodRefKey(ref),
        });
    };

    /**
     * Ask food about many refs in as few calls as possible. Never rejects.
     *
     * @param caller - The requesting user's credential, forwarded to food. `undefined` sends nothing: every ref
     *   is `unreachable`, because no other credential may be substituted.
     * @param refs - The refs a recipe (or a batch of them) binds. Order and repeats are irrelevant.
     * @param budget - The latency contract the read runs under, shared with the nutrition lookup.
     * @returns An answer for every distinct ref.
     * @sideEffect Performs batched food-service HTTP requests.
     */
    public async resolve(
        caller: CallerToken | undefined,
        refs: readonly FoodRef[],
        budget: NutritionReadBudget,
    ): Promise<FoodRefLookup> {
        const byKey = new Map(refs.map((ref) => [foodRefKey(ref), { kind: ref.kind, id: ref.id }] as const));
        const wanted = [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref);
        const answers = new Map<string, FoodRefAnswer>();

        if (wanted.length === 0) {
            return { answers, degraded: false };
        }

        if (caller === undefined) {
            this.logger.warn('food refs not asked: no caller credential to forward', { refs: wanted.length });
            wanted.forEach((ref) => answers.set(foodRefKey(ref), UNREACHABLE));

            return { answers, degraded: true };
        }

        const chunks: FoodRef[][] = [];

        for (let offset = 0; offset < wanted.length; offset += MAX_FOOD_REFS) {
            chunks.push(wanted.slice(offset, offset + MAX_FOOD_REFS));
        }

        const client = this.clients.readClient(caller, budget);
        const deadlineMs = this.clients.readDeadlineMs(budget);
        const deadline = AbortSignal.timeout(deadlineMs);
        let degraded = false;

        for (let wave = 0; wave < chunks.length; wave += MAX_CONCURRENT_CHUNKS) {
            if (deadline.aborted) {
                // A spent budget is not spent again on food; the unsent refs degrade exactly as a failed chunk's do.
                const unsent = chunks.slice(wave).flat();

                degraded = true;
                unsent.forEach((ref) => answers.set(foodRefKey(ref), UNREACHABLE));
                this.logger.warn('food refs deadline passed before every chunk was requested', {
                    deadlineMs,
                    unsentRefs: unsent.length,
                    budget,
                });
                break;
            }

            const inFlight = chunks.slice(wave, wave + MAX_CONCURRENT_CHUNKS);
            const settled = await Promise.allSettled(
                inFlight.map((chunk) => client.resolveRefs(chunk, { signal: deadline })),
            );

            settled.forEach((outcome, index) => {
                const chunk = inFlight[index] ?? [];

                if (outcome.status === 'rejected') {
                    degraded = true;
                    chunk.forEach((ref) => answers.set(foodRefKey(ref), UNREACHABLE));
                    this.logger.warn('food refs chunk failed', {
                        reason: outcome.reason instanceof Error ? outcome.reason.message : 'unknown error',
                        refs: chunk.length,
                        budget,
                    });

                    return;
                }

                const answered = new Map(
                    outcome.value.entries.map((entry) => [foodRefKey(entry.ref), toAnswer(entry, this.breach)]),
                );

                for (const ref of chunk) {
                    // Food answers every distinct ref it was sent; a missing one is a contract breach, reported as
                    // unreachable rather than guessed at.
                    answers.set(foodRefKey(ref), answered.get(foodRefKey(ref)) ?? UNREACHABLE);
                }
            });
        }

        return { answers, degraded };
    }

    /**
     * Ask food about ONE food before binding it (R51). Unlike {@link resolve}, a failure to ask throws: a bind
     * is never made on no answer.
     *
     * @param caller - The requesting user's credential.
     * @param ref - The food to bind.
     * @returns Food's answer.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food cannot be asked.
     * @sideEffect One food-service HTTP request.
     */
    public async resolveForBind(caller: CallerToken | undefined, ref: FoodRef): Promise<FoodRefAnswer> {
        try {
            const { entries } = await this.clients.standard(caller).resolveRefs([ref]);
            const entry = entries.find((candidate) => foodRefKey(candidate.ref) === foodRefKey(ref));

            if (entry === undefined) {
                throw new Error(`food answered no entry for ${foodRefKey(ref)}`);
            }

            const answer = toAnswer(entry, this.breach);

            if (answer.outcome === 'unreachable') {
                throw new Error(`food's entry for ${foodRefKey(ref)} breaches its contract`);
            }

            return answer;
        } catch (error) {
            this.logger.warn('food refs bind check failed', {
                reason: error instanceof Error ? error.message : 'unknown error',
            });

            throw apiError('SOURCE_UNAVAILABLE', 'The food service did not answer; the ingredient was not added.');
        }
    }
}
