/**
 * @module @commise/features-recipes/editor — the ways out of a blocked save or publish (heldPublicSave U2, KTD-1).
 *
 * One pure policy returns the ways, in the fixed order DH24 and DH25 set, and the lines that are not ways. It is
 * flag-agnostic: the toggle, the slot standing, the plan, `SUBSCRIPTION_ENTRY_POINTS_ON` and the rewrite answer all
 * come in as data. The sheet renders through an exhaustive switch over `WayOut`, so a new way is one union member, one
 * clause here and one render case. The Save and hide way (U6) is not built yet.
 *
 * @pattern Policy — `waysOutOf` is the one rule for what the cook may pick
 * @pattern Visitor — a discriminated union and an exhaustive switch render each way
 */
import type { BlockCause, RewriteWayAnswer, RewriteWayLineKey } from './rewriteWay.js';

/** A way out the cook can pick. */
export type WayOut =
    | { readonly kind: 'rewrite'; readonly wayLineKey: RewriteWayLineKey; readonly host?: string }
    | { readonly kind: 'discard' }
    | { readonly kind: 'makePrivate' }
    | { readonly kind: 'publishPrivate' };

/** A line the sheet shows that is not a way. */
export type WayLine = 'draftKept' | 'slotsFull' | 'pro';

/** Everything the policy decides on. */
export interface WaysOutFacts {
    /** Why it is blocked. Not branched on yet: 020 adds causes, and their facts, without changing this shape. */
    readonly cause: BlockCause;
    readonly door: 'save' | 'publish';
    readonly slots: 'free' | 'none';
    readonly plan: 'free' | 'pro';
    readonly subscriptionEntryPointsOn: boolean;
    readonly rewrite: RewriteWayAnswer;
}

/** The ways, in order, and the lines. `ways` may be empty on the publish door. */
export interface WaysOut {
    readonly ways: readonly WayOut[];
    readonly lines: readonly WayLine[];
}

/** @returns the ways and lines for one blocked save or publish. */
export function waysOutOf(facts: WaysOutFacts): WaysOut {
    const { door, slots, rewrite } = facts;
    const free = slots === 'free';
    const ways: WayOut[] = [];

    if (rewrite.kind === 'available') {
        ways.push({
            kind: 'rewrite',
            wayLineKey: rewrite.wayLineKey,
            ...(rewrite.host === undefined ? {} : { host: rewrite.host }),
        });
    }

    if (door === 'save') {
        ways.push({ kind: 'discard' });

        if (free) {
            ways.push({ kind: 'makePrivate' });
        }
    } else if (free) {
        ways.push({ kind: 'publishPrivate' });
    }

    const lines: WayLine[] = [];

    if (door === 'publish' && !free) {
        lines.push('draftKept');
    }

    if (!free) {
        lines.push('slotsFull');
    }

    if (facts.plan === 'free' && facts.subscriptionEntryPointsOn) {
        lines.push('pro');
    }

    return { ways, lines };
}
