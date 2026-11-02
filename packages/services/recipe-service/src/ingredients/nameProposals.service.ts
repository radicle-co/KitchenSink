/**
 * THE NAME PROPOSALS — what the editor's add-by-name field offers for a typed phrase (ADR-0071 as amended).
 *
 * A typed name used to run the binding chain and bind whatever a settled tier remembered, silently. That let a memo one
 * cook's save taught become another cook's binding with no choice made (devil's advocate M2). The owner ruled that the
 * cook's own correction, a staff ruling, two cooks agreeing and a memo all PROPOSE. This service is the read that
 * produces those proposals. The cook picks one in the field's list, and the pick binds through `by-food` or
 * `by-food-variant`, which check admission again at bind time. So a proposal is a hint and can bind nothing by itself.
 *
 * ⛔ IT WRITES NOTHING. It is built from the settled tiers and the refs reader, neither of which writes: no lookup row,
 * no resolution event, no failure record, no binding. Do not add a writer here; a proposal that leaves a row behind is
 * a binding by another name.
 *
 * ⛔ IT LEAKS NOTHING. A memo or mapping can name only a shared food, or the cook's own private one (a private food's
 * mapping never reaches beyond its author, `mappingScopePolicy`). Names still come from food, as the caller, so food
 * decides what the caller may see. Anything food refuses, hides or cannot answer about is DROPPED and the answer stays a
 * `200` list: an empty list cannot tell "nothing remembered" from "a concealed food". One residual side channel: each
 * candidate costs one food read, so latency can show that a mapping exists. The phrase is the caller's own and carries
 * no personal data, so that is accepted.
 *
 * DESIGN PATTERN: **Imperative Shell** around the pure {@link nameProposalDraftsOf} policy and the read-only
 * {@link consultEveryTier} loop.
 */
import { Injectable, Logger } from '@nestjs/common';

import type { CallerToken } from '../auth/CallerToken.js';
import type { FoodRef } from '../database/schema/foodLookupArm.js';
import { admitResolvedRef, admittedRefOf, isAdmission } from './domain/foodAdmission.js';
import type { CanonicalIngredientName } from './domain/ingredientName.js';
import { nameProposalDraftsOf } from './domain/nameProposalPolicy.js';
import type { FoodRefsGateway } from './foodRefs.gateway.js';
import type { IngredientNameProposal, IngredientNameProposalsResponse } from './ingredients.schema.js';
import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';
import { consultEveryTier, type ResolutionTier } from './resolution/resolutionCascade.js';

@Injectable()
export class NameProposalsService {
    private readonly logger = new Logger(NameProposalsService.name);

    /**
     * @param tiers - The settled tiers, in precedence order (`createBindingRegistry`): curated mappings, then memos.
     * @param refs - Food's refs reader, which names a food as the caller.
     */
    public constructor(
        private readonly tiers: readonly ResolutionTier[],
        private readonly refs: Pick<FoodRefsGateway, 'resolveForBind'>,
    ) {}

    /**
     * The foods to offer for a typed phrase.
     *
     * @param caller - The caller's credential, so food names each food as the caller.
     * @param name - The typed phrase, already canonical.
     * @param userId - The caller. A cook sees their own corrections here and nobody else's.
     * @returns The phrase and the proposals, strongest source first. Never throws for a food or a tier that failed.
     * @sideEffect Reads the settled tiers, then one food ref read per candidate. Writes nothing.
     */
    public async propose(
        caller: CallerToken | undefined,
        name: CanonicalIngredientName,
        userId: string | undefined,
    ): Promise<IngredientNameProposalsResponse> {
        const key = normalizedIngredientKey(name);

        if (key === undefined) {
            return { phrase: name, proposals: [] };
        }

        const heard = await consultEveryTier(
            this.tiers,
            { key, phrase: name },
            { userId, caller, signal: undefined },
            {
                onTierFailure: (tier, error) =>
                    this.logger.warn(
                        `Name proposals: tier '${tier}' could not be read; offering the others.`,
                        error instanceof Error ? error.stack : String(error),
                    ),
            },
        );
        const named = await Promise.all(
            nameProposalDraftsOf(heard.outcomes).map((draft) => this.named(caller, draft.food, draft.source, userId)),
        );

        return { phrase: name, proposals: named.filter((proposal) => proposal !== undefined) };
    }

    /**
     * One draft, named by food as the caller, or `undefined` when food will not let the caller bind it.
     *
     * @sideEffect One food ref read.
     */
    private async named(
        caller: CallerToken | undefined,
        food: FoodRef,
        source: string,
        userId: string | undefined,
    ): Promise<IngredientNameProposal | undefined> {
        const admission = admitResolvedRef(await this.refs.resolveForBind(caller, food), userId);

        if (!isAdmission(admission)) {
            return undefined;
        }

        const live = admittedRefOf(admission);

        return { kind: live.kind, id: live.id, name: admission.name, source };
    }
}
