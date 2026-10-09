/**
 * @module identityAlignment — give each pool user, in the LOCAL identity database, the app-user id its Clerk
 * `external_id` already names.
 *
 * ⛔ ONE CLERK INSTANCE, TWO IDENTITY DATABASES. The local sandbox signs in the sandbox Clerk instance's fixed
 * pool users. Their `external_id` was written by the SANDBOX identity webhook and is the sandbox database's
 * `users.id`. Recipe-service takes a recipe's owner from that claim; the app's "me" is the local identity's
 * `/v1/users/me` `user.id`, which read-through creation mints fresh for a `sub` it has not seen. The two then
 * disagree, and the app hides every owner-gated control on the cook's own recipes.
 *
 * The fix is local STATE, so it is established here, on every run, rather than by hand. It never writes to
 * Clerk: the instance is shared with CI's deployed Maestro tier, whose ownership depends on the `external_id`
 * staying what the sandbox database holds.
 *
 * @pattern Functional core, imperative shell — {@link planIdentityAlignment} decides, the ports act
 */
import { judgePoolSlot, type LeasePort } from '@kitchensink/e2e-fixtures/lease';
import type { PoolSlot } from '@kitchensink/e2e-fixtures/testPool';

/** A local `users` row, reduced to what the decision reads. */
export interface IdentityRow {
    readonly id: string;
    readonly identityId: string;
    readonly status: string;
}

/** What one pool user needs. */
export type AlignmentPlan =
    | { readonly kind: 'aligned' }
    | { readonly kind: 'provision' }
    | { readonly kind: 'replace'; readonly staleId: string };

/** A state the planner will not repair, because repairing it would destroy or reassign an account. */
export class IdentityAlignmentRefusal extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IdentityAlignmentRefusal';
        Object.setPrototypeOf(this, IdentityAlignmentRefusal.prototype);
    }
}

/** Type guard for {@link IdentityAlignmentRefusal}. */
export function isIdentityAlignmentRefusal(error: unknown): error is IdentityAlignmentRefusal {
    return error instanceof IdentityAlignmentRefusal;
}

/** The lifecycle states provisioning never revives (identity-utils' R10). */
const NON_REVIVABLE = new Set(['tombstoned', 'erased']);

/**
 * Decide what one pool user needs. Pure.
 *
 * @param target - The Clerk `sub` and the `external_id` it carries.
 * @param rows - Every local `users` row holding that `sub` OR that id.
 * @returns The plan.
 * @throws IdentityAlignmentRefusal when the id belongs to another identity, or the stale row is a closed account.
 */
export function planIdentityAlignment(
    target: { readonly identityId: string; readonly externalId: string },
    rows: readonly IdentityRow[],
): AlignmentPlan {
    const foreign = rows.find((row) => row.id === target.externalId && row.identityId !== target.identityId);

    if (foreign !== undefined) {
        throw new IdentityAlignmentRefusal(
            `local identity row ${foreign.id} belongs to ${foreign.identityId}, not ${target.identityId} — two Clerk ` +
                'users carry one external_id; reset the local identity database rather than reassign it',
        );
    }

    const own = rows.find((row) => row.identityId === target.identityId);

    if (own === undefined) {
        return { kind: 'provision' };
    }

    if (own.id === target.externalId) {
        return { kind: 'aligned' };
    }

    if (NON_REVIVABLE.has(own.status)) {
        throw new IdentityAlignmentRefusal(
            `local identity row ${own.id} for ${target.identityId} is ${own.status} — a closed account is not ` +
                'replaced, because replacing it would resurrect it',
        );
    }

    return { kind: 'replace', staleId: own.id };
}

/** The boundaries alignment crosses: Clerk's user lookup and the local identity database. */
export interface AlignmentPorts {
    readonly findUsers: LeasePort['findUsers'];
    /** Every local `users` row whose `identity_id` is `identityId` or whose `id` is `externalId`. */
    readonly rowsFor: (identityId: string, externalId: string) => Promise<readonly IdentityRow[]>;
    /** Delete the row holding `identityId`, and with it the rows that depend on it. */
    readonly removeRow: (identityId: string) => Promise<void>;
    /** Provision the complete user under `externalId`; resolves to the id the row actually has. */
    readonly provision: (input: {
        readonly identityId: string;
        readonly externalId: string;
        readonly email: string;
    }) => Promise<string>;
}

/** What alignment did for one slot. `absent` is a consumed slot no Clerk user holds. */
export interface AlignmentOutcome {
    readonly slot: string;
    readonly kind: AlignmentPlan['kind'] | 'absent';
}

/**
 * Align every slot, in order.
 *
 * @param slots - The pool slots this run signs in.
 * @param ports - The Clerk and database boundaries.
 * @returns One outcome per slot.
 * @throws When a slot is not leasable for a reason other than absence, when the planner refuses, or when the
 *   provisioned row does not carry the `external_id`.
 * @sideEffect Reads Clerk; deletes and provisions local identity rows.
 */
export async function alignPoolIdentities(
    slots: readonly PoolSlot[],
    ports: AlignmentPorts,
): Promise<readonly AlignmentOutcome[]> {
    const outcomes: AlignmentOutcome[] = [];

    for (const slot of slots) {
        // The SAME judgement a lease makes, so this never aligns a user the run would refuse to sign in.
        const verdict = judgePoolSlot(slot, await ports.findUsers(slot.email));

        if ('refusal' in verdict) {
            if (verdict.absent) {
                outcomes.push({ slot: slot.id, kind: 'absent' });
                continue;
            }

            throw new Error(verdict.refusal);
        }

        // `judgePoolSlot` refuses an empty `external_id`, so this is the claim the services authorize on.
        const target = { identityId: verdict.user.id, externalId: verdict.user.externalId ?? '' };
        const plan = planIdentityAlignment(target, await ports.rowsFor(target.identityId, target.externalId));

        if (plan.kind === 'replace') {
            await ports.removeRow(target.identityId);
        }

        if (plan.kind !== 'aligned') {
            const id = await ports.provision({ ...target, email: slot.email });

            if (id !== target.externalId) {
                throw new Error(
                    `${slot.email} was provisioned as ${id}, not its external_id ${target.externalId} — the app ` +
                        'and recipe-service would still disagree about who owns its recipes',
                );
            }
        }

        outcomes.push({ slot: slot.id, kind: plan.kind });
    }

    return outcomes;
}
