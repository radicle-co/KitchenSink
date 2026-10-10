/**
 * @module @commise/features-recipes/hooks — carries one pick onto one ingredient line on the recipe form
 * (`docs/design/rowEditorBlueprint.md` decision 7). The read view offers no row action
 * (`docs/design/ingredientSpecialization.md` §S5), so it has no commit port.
 *
 * `commitRouteFor` chooses the route; this hook runs it.
 *
 * - **The command**, for a line the server STORES: the rebind request, run through the editor's command port
 *   (`useRecipeEditor`'s `lineCommand`), which sends it after the editor's earlier writes and adopts the version it
 *   returns (ADR-0045, lines 265-269). On a published recipe the port HOLDS it until Save changes (owner D1): the pick
 *   is admitted here, so the line shows its food at once, and the editor sends the rebind when the cook saves.
 * - **The draft**, for every other line: the pick is admitted (the draft's wire sends only `ingredientId`, so a food
 *   needs a binding first), then the line is re-pointed by key, or appended under a newly minted key. An `UNRESOLVED`
 *   admission is committed as it is; its row offers the choice.
 *
 * - **A remote pick** (ADR-0055 point 10) is one command too: food adopts the hit into a catalog root, and the line is
 *   then committed with that root as a `catalogFood` pick, by whichever route above it takes. Its refusals are their own
 *   outcomes, because the row says each one differently (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P8).
 *   While the session's limit stands it makes no request and settles `limited` again, so the row says it again (item 10,
 *   R8); a refusal for the limit holds it.
 *
 * One commit per target at a time: a second pick on a target whose first is in flight is refused as `busy`.
 *
 * @pattern Strategy — `commitRouteFor` selects the command or the draft for one pick
 * @pattern Command — each route runs as TanStack mutations, a remote pick's adopt first
 */
import { useAdoptRemoteFood } from '@kitchensink/food-service-client/hooks';
import type { Ingredient } from '@kitchensink/recipe-core';
import {
    useAddIngredientByFood,
    useAddIngredientByFoodVariant,
    useAddIngredientByName,
    useCreateIngredient,
    useRebindIngredientLine,
} from '@kitchensink/recipe-service-client/hooks';
import { useState } from 'react';

import { mintLineKey } from '../form/mintLineKey.js';
import type { DraftAction } from '../form/draftAction.js';
import {
    adoptRefusalOf,
    commitRouteFor,
    lineBindingOf,
    rebindRequestOf,
    toIngredientLine,
    withLineMeasure,
    type BoundPick,
    type IngredientPick,
    type LineCommandOutcome,
    type LineCommandPort,
    type LineCommitOutcome,
    type LineCommitTarget,
    type RebindTarget,
} from './lineCommit.js';
import { isSourceLimited } from './sourceLimit.model.js';
import type { SourceLimit } from './useSourceLimit.js';

/** The form the picks are made on: which strategies it can run. */
export type LineCommitSurface =
    /** Nothing is stored yet, so every pick is a draft transition. */
    | { readonly kind: 'createForm'; readonly dispatch: (action: DraftAction) => void }
    /** A stored line moves through the editor's command; any other line is a draft transition. */
    | {
          readonly kind: 'editForm';
          readonly dispatch: (action: DraftAction) => void;
          readonly command: LineCommandPort;
      };

/** The last commit that settled, for the row's announcement, with the tag its caller named it with. */
export interface SettledLineCommit<Origin> {
    readonly origin: Origin;
    readonly target: LineCommitTarget;
    readonly pick: IngredientPick;
    readonly outcome: LineCommitOutcome;
}

/** What a form wires. `Origin` is the caller's tag for which surface made a pick; this hook only carries it. */
export interface LineCommit<Origin> {
    readonly commit: (pick: IngredientPick, target: LineCommitTarget, origin: Origin) => Promise<LineCommitOutcome>;
    /** The pick in flight on `target`, or `undefined`: its row reads busy and says what it is doing. */
    readonly inFlightPick: (target: LineCommitTarget) => IngredientPick | undefined;
    /** The last commit that settled; `undefined` before one. A refused (`busy`) commit is not one. */
    readonly settled: SettledLineCommit<Origin> | undefined;
    /**
     * A request a commit made is waiting for a connection: mutations pause offline and resume on reconnect, so a row
     * can say it is offline rather than busy.
     */
    readonly paused: boolean;
    /** The remote picks the session's limit refused before asking: each one says the limit again (R8). */
    readonly limitRefusals: number;
}

/** A target's identity among those in flight. A line key never spells `newLine` (`isIngredientLineKey`). */
const targetIdOf = (target: LineCommitTarget): string => (target.kind === 'line' ? target.key : target.kind);

/** The command's answer, as a line commit reports it. Pure. */
const commitOutcomeOf = (
    outcome: LineCommandOutcome,
    target: LineCommitTarget & { kind: 'line' },
): LineCommitOutcome =>
    outcome.kind === 'committed' ? { kind: 'committed', key: target.key, binding: outcome.binding } : outcome;

/**
 * Carries picks onto lines, on one form.
 *
 * @param surface - The form and its ports.
 * @param sourceLimit - The session's one source limit (`useSourceLimit`): it stops a remote pick, and a refusal holds it.
 * @returns The commit port, and which targets are committing.
 */
export function useLineCommit<Origin>(surface: LineCommitSurface, sourceLimit: SourceLimit): LineCommit<Origin> {
    const addByFood = useAddIngredientByFood();
    const addByFoodVariant = useAddIngredientByFoodVariant();
    const addByName = useAddIngredientByName();
    const createFreeform = useCreateIngredient();
    const rebind = useRebindIngredientLine();
    const adopt = useAdoptRemoteFood();
    const [inFlight, setInFlight] = useState<ReadonlyMap<string, IngredientPick>>(() => new Map());
    const [settled, setSettled] = useState<SettledLineCommit<Origin> | undefined>(undefined);
    const [limitRefusals, setLimitRefusals] = useState(0);

    /**
     * The binding a pick names, admitted.
     *
     * @sideEffect Admits the food (a POST).
     */
    const admit = (pick: BoundPick): Promise<Ingredient> => {
        switch (pick.kind) {
            case 'catalogFood':
                return addByFood.mutateAsync(pick.foodId);
            case 'catalogVariant':
                return addByFoodVariant.mutateAsync(pick.foodVariantId);
            case 'name':
                return addByName.mutateAsync(pick.text);
            case 'declared':
                return createFreeform.mutateAsync(pick.text);
        }
    };

    /**
     * The draft strategy.
     *
     * @sideEffect Admits the food, then applies a draft transition through the form's `dispatch`.
     */
    const commitToDraft = async (pick: BoundPick, target: LineCommitTarget): Promise<LineCommitOutcome> => {
        // A refused admission changes nothing.
        const line = await admit(pick).then(toIngredientLine, () => undefined);

        if (line === undefined) {
            return { kind: 'failed' };
        }

        const binding = lineBindingOf(line);

        if (target.kind === 'newLine') {
            const key = mintLineKey();

            surface.dispatch({
                kind: 'appendResolvedIngredient',
                key,
                line: withLineMeasure(line, target.measure),
                ...(target.placement === undefined ? {} : { placement: target.placement }),
            });

            return { kind: 'committed', key, binding };
        }

        surface.dispatch({ kind: 'rebindIngredient', key: target.key, binding });

        return { kind: 'committed', key: target.key, binding };
    };

    /**
     * The command, held until Save changes: the pick is admitted so the line can show it, and the editor keeps the
     * rebind's target to send when the cook saves.
     *
     * @sideEffect Admits the food (a POST, which makes no recipe version), then hands the rebind to the editor.
     */
    const holdCommand = async (
        pick: BoundPick,
        target: LineCommitTarget & { kind: 'line' },
        command: LineCommandPort,
        rebindTarget: RebindTarget,
    ): Promise<LineCommitOutcome> => {
        const line = await admit(pick).then(toIngredientLine, () => undefined);

        if (line === undefined) {
            return { kind: 'failed' };
        }

        const binding = lineBindingOf(line);

        command.hold({ lineKey: target.key, target: rebindTarget }, binding);

        return { kind: 'committed', key: target.key, binding };
    };

    /** Run the route `commitRouteFor` chooses. */
    const route = (pick: BoundPick, target: LineCommitTarget): Promise<LineCommitOutcome> => {
        const command = surface.kind === 'editForm' ? surface.command : undefined;
        const route = commitRouteFor(pick, target, command?.persistedKeys ?? []);

        if (route.route === 'command' && command !== undefined && target.kind === 'line') {
            if (command.holdsRebinds) {
                return holdCommand(pick, target, command, route.target);
            }

            return command
                .run(target.key, (address) => rebind.mutateAsync(rebindRequestOf(address, route.target)))
                .then((outcome) => commitOutcomeOf(outcome, target));
        }

        return commitToDraft(pick, target);
    };

    /**
     * Run one pick: a remote food is adopted first, and its root then takes the line's route.
     *
     * @sideEffect Adopts a remote food (a POST), then commits through the chosen route.
     */
    const run = async (pick: IngredientPick, target: LineCommitTarget): Promise<LineCommitOutcome> => {
        if (pick.kind !== 'remoteFood') {
            return route(pick, target);
        }

        const adopted = await adopt.mutateAsync(pick.reference).then(
            (root) => root,
            (error: unknown) => adoptRefusalOf(error, Date.now()),
        );

        return 'id' in adopted ? route({ kind: 'catalogFood', foodId: adopted.id, name: pick.name }, target) : adopted;
    };

    return {
        commit: (pick, target, origin) => {
            const id = targetIdOf(target);

            if (inFlight.has(id)) {
                return Promise.resolve({ kind: 'busy' });
            }

            // Item 10: while the cook's limit stands, a remote pick asks nothing and says the limit again.
            if (
                pick.kind === 'remoteFood' &&
                sourceLimit.retryAt !== undefined &&
                isSourceLimited(sourceLimit, Date.now())
            ) {
                const outcome: LineCommitOutcome = { kind: 'limited', retryAt: sourceLimit.retryAt };

                setLimitRefusals((count) => count + 1);
                setSettled({ origin, target, pick, outcome });

                return Promise.resolve(outcome);
            }

            setInFlight((current) => new Map([...current, [id, pick]]));

            // A request that throws ends the commit like a refusal: the field must not read busy for good.
            return run(pick, target)
                .catch((): LineCommitOutcome => ({ kind: 'failed' }))
                .then((outcome) => {
                    setInFlight((current) => new Map([...current].filter(([each]) => each !== id)));
                    setSettled({ origin, target, pick, outcome });

                    if (outcome.kind === 'limited') {
                        sourceLimit.hold(outcome.retryAt);
                    }

                    return outcome;
                });
        },
        inFlightPick: (target) => inFlight.get(targetIdOf(target)),
        settled,
        paused: [addByFood, addByFoodVariant, addByName, createFreeform, rebind, adopt].some(
            (request) => request.isPaused,
        ),
        limitRefusals,
    };
}
