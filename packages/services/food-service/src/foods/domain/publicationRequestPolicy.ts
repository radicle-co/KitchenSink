/**
 * The publication-request rules (ADR-0029 §5 and §7): which edits apply at once and which go to staff, whether an
 * author may ask, and whether staff may approve.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `evaluateAuthorship` — each question is answered
 * from the facts passed in, with no database and no I/O, so the DAO that runs the transaction decides nothing itself.
 *
 * @pattern Specification — pure decisions over facts the DAO read under lock
 */

/** The 0013 visibility. */
type Visibility = 'public' | 'private' | 'promoted';

/** What an edit does. `apply` rewrites the live row; `openRequest` files a pending request at the new version. */
export interface EditDecision {
    readonly apply: boolean;
    readonly openRequest: boolean;
}

/**
 * Decide what one edit of an authored food does.
 *
 * A private food's edit applies now, and moves a pending request onto the new version so staff only ever see the
 * newest one. A promoted food's edit never touches the live row: every reader keeps the approved version until staff
 * approve the new one.
 *
 * @param input - The food's visibility and whether a request was pending when the edit arrived.
 * @returns The edit decision.
 */
export function decideEdit(input: { readonly visibility: Visibility; readonly hadPending: boolean }): EditDecision {
    if (input.visibility === 'promoted') {
        return { apply: false, openRequest: true };
    }

    return { apply: true, openRequest: input.hadPending };
}

/** Why an author's request is refused. */
export type RequestRefusal = 'withdrawn' | 'notPrivate' | 'declined';

/** The verdict on an author's request. `existing` is the idempotent answer for a request already pending. */
export type RequestDecision =
    | { readonly kind: 'open' }
    | { readonly kind: 'existing' }
    | { readonly kind: 'refused'; readonly reason: RequestRefusal };

/** The facts a request is decided over. */
export interface RequestFacts {
    readonly visibility: Visibility;
    /** The food's lifecycle status; anything but `RESOLVED` is gone as far as publication goes. */
    readonly status: string;
    readonly newestVersion: number;
    /** The version of the pending request, when one is open. */
    readonly pendingVersion: number | undefined;
    /** Versions staff declined. A declined version cannot be asked again; an edit makes a new one. */
    readonly declinedVersions: readonly number[];
}

/**
 * Decide whether an author may ask for publication.
 *
 * @param facts - The food's facts, read under its row lock.
 * @returns Open a request, answer the pending one, or refuse with a reason.
 */
export function decideRequest(facts: RequestFacts): RequestDecision {
    if (facts.status !== 'RESOLVED') {
        return { kind: 'refused', reason: 'withdrawn' };
    }

    if (facts.visibility !== 'private') {
        return { kind: 'refused', reason: 'notPrivate' };
    }

    if (facts.pendingVersion !== undefined) {
        return { kind: 'existing' };
    }

    if (facts.declinedVersions.includes(facts.newestVersion)) {
        return { kind: 'refused', reason: 'declined' };
    }

    return { kind: 'open' };
}

/** Why staff cannot approve. */
export type ApprovalRefusal = 'closed' | 'withdrawn' | 'notNewest';

/** The verdict on an approval. */
export type ApprovalDecision =
    { readonly kind: 'approve' } | { readonly kind: 'refused'; readonly reason: ApprovalRefusal };

/**
 * Decide whether staff may approve a request. Run under the request and food locks, so the answer cannot go stale.
 *
 * @param facts - The request and food facts.
 * @returns Approve, or refuse with a reason.
 */
export function decideApproval(facts: {
    readonly requestStatus: string;
    readonly requestVersion: number;
    readonly newestVersion: number;
    readonly foodStatus: string;
}): ApprovalDecision {
    if (facts.requestStatus !== 'pending') {
        return { kind: 'refused', reason: 'closed' };
    }

    if (facts.foodStatus !== 'RESOLVED') {
        return { kind: 'refused', reason: 'withdrawn' };
    }

    if (facts.requestVersion !== facts.newestVersion) {
        return { kind: 'refused', reason: 'notNewest' };
    }

    return { kind: 'approve' };
}

/** What the author reads about a food: the one word the list, the food page and the badge all show. */
export type PublicationState =
    'private' | 'asked' | 'notApproved' | 'public' | 'editWaiting' | 'editNotApproved' | 'withdrawn';

/**
 * Derive the author's publication state from the food and its newest request. The ONE statement of the mapping, so
 * the list route and the food page cannot disagree (revision 4, F19).
 *
 * A declined request speaks only for the version it names: once the author edits again there is no open ask and the
 * food reads as it did before. A closed or approved request is history, not a state.
 *
 * @param facts - The food's visibility and status, its newest version, and its newest request of any status.
 * @returns The state.
 */
export function publicationStateOf(facts: {
    readonly visibility: Visibility;
    readonly status: string;
    readonly newestVersion: number;
    readonly newestRequest: { readonly status: string; readonly versionNumber: number } | undefined;
}): PublicationState {
    if (facts.status !== 'RESOLVED') {
        return 'withdrawn';
    }

    if (facts.visibility === 'public') {
        return 'public';
    }

    const promoted = facts.visibility === 'promoted';
    const newest = facts.newestRequest;

    if (newest?.status === 'pending') {
        return promoted ? 'editWaiting' : 'asked';
    }

    if (newest?.status === 'declined' && newest.versionNumber === facts.newestVersion) {
        return promoted ? 'editNotApproved' : 'notApproved';
    }

    return promoted ? 'public' : 'private';
}
