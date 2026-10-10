/**
 * What a version restore does with each line of the snapshot (plan 002 R52).
 *
 * A snapshot stores each line's binding id and the name the saving cook could share. At restore time the binding
 * may still stand, may point at a food that is gone or withdrawn, or may be gone itself:
 *
 * - A binding that still stands is restored exactly, with two exceptions. A food that is gone or withdrawn goes
 *   by the frozen name, so the restore finds what stands in for it now. An unresolved line other than a declared
 *   one resolves its own name again, which may succeed now.
 * - A binding that is gone goes by the frozen name: a declared line is declared again, any other line resolves.
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
    | { readonly kind: 'byName'; readonly name: CanonicalIngredientName }
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

        return line.isUserEntered ? { kind: 'declare', name: frozen } : { kind: 'byName', name: frozen };
    }

    const reuse: RestoreLineDecision = { kind: 'reuse', lookupId: identity.arm.lookupId };

    if (identity.arm.kind === 'unresolved') {
        if (identity.arm.failure.reasonCode === 'author_declared') {
            return reuse;
        }

        const failureName = canonicalIngredientName(identity.arm.failure.name);

        return failureName === undefined ? reuse : { kind: 'byName', name: failureName };
    }

    switch (identity.presence) {
        case 'withdrawn':
        case 'gone':
            return frozen === undefined ? reuse : { kind: 'byName', name: frozen };
        case 'present':
        case 'unreachable':
        case 'unbound':
            return reuse;
    }
}
