/**
 * What a version restore does with each line of the snapshot (plan 002 R52; owner ruling 2026-11-03).
 *
 * A restore binds what the version DEFINED. A snapshot stores each line's binding id and the name the saving cook could
 * share. At restore time the binding may still stand, may point at a food that is gone or withdrawn, or may be gone
 * itself:
 *
 * - A binding that still stands is restored exactly, whether it is a food, a variant, a declared name or a failure that
 *   was still unresolved: the line comes back as the version had it.
 * - A food that is gone or withdrawn, or a binding that is gone, comes back UNBOUND under its frozen name (declared), so
 *   the cook picks a food through the lookup like any other unbound line. ⛔ It is never resolved again: neither the
 *   resolution cascade nor food is asked for a stand-in, because that would pick another food for the cook with no
 *   choice made.
 * - A line with no binding and no name cannot be restored. The restore refuses the whole version (409), because
 *   restoring the rest would silently drop a line from the recipe the cook asked to get back.
 *
 * ⚠️ A food that could not be asked about keeps its binding: an outage is not evidence that the food is gone.
 *
 * @pattern Policy — pure decision over the snapshot line and the binding's current identity
 */
import { canonicalIngredientName, type CanonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { IngredientLineIdentity } from '../../ingredients/domain/ingredientLineIdentity.js';

/** The facts a snapshot line carries that the decision reads. */
export interface SnapshotLineFacts {
    /** The line's binding id when the version was saved. */
    readonly ingredientId: string;
    /** The name the saving cook could share, frozen into the version. */
    readonly ingredientName?: string;
    /** Whether the cook declared the line's name. */
    readonly isUserEntered: boolean;
}

/** What the restore does with one line. */
export type RestoreLineDecision =
    | { readonly kind: 'reuse'; readonly lookupId: string }
    | { readonly kind: 'declare'; readonly name: CanonicalIngredientName }
    | { readonly kind: 'unrestorable' };

/**
 * The frozen name in canonical form, or `undefined` when there is none with visible content.
 *
 * @param line - The snapshot line.
 * @returns The name. Pure.
 */
function frozenNameOf(line: SnapshotLineFacts): CanonicalIngredientName | undefined {
    return line.ingredientName === undefined ? undefined : canonicalIngredientName(line.ingredientName);
}

/**
 * Decide what the restore does with one snapshot line.
 *
 * @param line - The snapshot line.
 * @param identity - The line's binding as it stands now, or `undefined` when the binding is gone.
 * @returns The decision. Pure.
 */
export function decideRestoreLine(
    line: SnapshotLineFacts,
    identity: IngredientLineIdentity | undefined,
): RestoreLineDecision {
    const frozen = frozenNameOf(line);

    if (identity === undefined) {
        if (frozen === undefined) {
            return { kind: 'unrestorable' };
        }

        return { kind: 'declare', name: frozen };
    }

    const reuse: RestoreLineDecision = { kind: 'reuse', lookupId: identity.arm.lookupId };

    if (identity.arm.kind === 'unresolved') {
        return reuse;
    }

    switch (identity.presence) {
        case 'withdrawn':
        case 'gone':
            return frozen === undefined ? reuse : { kind: 'declare', name: frozen };
        case 'present':
        case 'unreachable':
        case 'unbound':
            return reuse;
    }
}
