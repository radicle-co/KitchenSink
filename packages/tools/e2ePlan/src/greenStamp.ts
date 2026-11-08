/**
 * The policy for "the last fully passing local run" (ADR-0086, owner ruling 2026-11-07).
 *
 * A local run measures its change set from the tree of the last run that passed, stamped per branch and per
 * platform. Two pure decisions live here: which base a run measures from, and whether a finished run may move the
 * stamp. Nothing here touches git or the disk.
 *
 * @pattern Specification — `chooseBase` and `nextStamp` are predicates over plain evidence
 */

export type Platform = 'web' | 'android' | 'ios';

/** What the last fully passing run proved. */
export interface GreenStamp {
    readonly version: 1;
    readonly platform: Platform;
    readonly branch: string;
    /** The tree object of the working tree as it was when that run was planned. */
    readonly tree: string;
    readonly head: string;
    /**
     * What the run that wrote this stamp could not run here (sandbox-only flows, deployed-only specs). A report of that
     * run, printed so it is seen, not a ledger: nothing clears an item, so the next stamp replaces the list.
     */
    readonly owed: readonly string[];
    /** ISO 8601. */
    readonly at: string;
}

export type Base =
    | { readonly kind: 'ref'; readonly ref: string }
    | { readonly kind: 'stamp'; readonly stamp: GreenStamp }
    | { readonly kind: 'none'; readonly reason: string };

export interface BaseInput {
    /** `--base` or `TURBO_SCM_BASE`. */
    readonly explicitBase?: string | undefined;
    readonly ci: boolean;
    /** The platform whose suite the caller runs. A caller that names none cannot use a stamp. */
    readonly platform?: Platform | undefined;
    /** The current branch, or undefined on a detached HEAD. */
    readonly branch?: string | undefined;
    readonly stamp?: GreenStamp | undefined;
    /** Whether the stamp's tree object is still in the repository. */
    readonly stampTreeExists: boolean;
}

const DEFAULT_REF = 'origin/main';

/**
 * Chooses what a run measures its change from.
 *
 * An explicit base and CI keep today's rule (the ref). Only a bare local run for a named platform may use a stamp, and
 * every doubt about the stamp (missing, another branch or platform, tree gone) means the whole suite.
 *
 * @param input - The run's context.
 * @returns The base.
 */
export function chooseBase(input: BaseInput): Base {
    if (input.explicitBase !== undefined) {
        return { kind: 'ref', ref: input.explicitBase };
    }

    if (input.ci || input.platform === undefined) {
        return { kind: 'ref', ref: DEFAULT_REF };
    }

    if (input.branch === undefined) {
        return { kind: 'none', reason: 'HEAD is detached, so no branch can hold a green stamp' };
    }

    const { stamp } = input;

    if (stamp === undefined || stamp.platform !== input.platform || stamp.branch !== input.branch) {
        return { kind: 'none', reason: `no green run is recorded for ${input.branch} on ${input.platform}` };
    }

    if (!input.stampTreeExists) {
        return { kind: 'none', reason: `the tree of the last green run on ${input.branch} is gone` };
    }

    return { kind: 'stamp', stamp };
}

/**
 * What an empty change set means for a base. Against a ref it looks exactly like a wrong base ref, so it runs
 * everything. Against a stamp it is the answer: nothing changed since the last green run.
 *
 * @param base - A base that is a ref or a stamp.
 * @returns `full` or `nothing`.
 */
export const onEmptyOf = (base: Base): 'full' | 'nothing' => (base.kind === 'stamp' ? 'nothing' : 'full');

export interface RunEvidence {
    readonly platform: Platform;
    readonly branch: string | undefined;
    readonly head: string;
    readonly planTree: string;
    readonly endTree: string;
    readonly outcomes: { readonly passed: number; readonly failed: number; readonly skipped: number };
    /** Whether the recorder checks found nothing wrong. */
    readonly recorderClean: boolean;
    /** The stamp the run started from, if any. */
    readonly previous: GreenStamp | undefined;
    /** What this run could not run here (sandbox-only flows, deployed-only specs). */
    readonly dropped: readonly string[];
    readonly now: string;
}

/**
 * Decides whether a finished run may move the stamp, and to what.
 *
 * The selector must have chosen the set: a door keeps a `StampStart` only then, so a run whose tests a person named never
 * reaches this. Then every selected test must have passed, the recorder checks be clean, and the tree not have changed
 * while the run went on. The new stamp names the tree at PLAN time,
 * because that is the tree the tests ran against.
 *
 * @param evidence - What the run saw.
 * @returns The next stamp, or why the stamp stays where it is.
 */
export function nextStamp(evidence: RunEvidence): GreenStamp | { readonly refused: string } {
    if (evidence.branch === undefined) {
        return { refused: 'HEAD is detached, so no branch can hold the stamp' };
    }

    if (evidence.outcomes.failed > 0 || evidence.outcomes.skipped > 0) {
        return { refused: 'a selected test failed or was skipped' };
    }

    if (!evidence.recorderClean) {
        return { refused: 'the recorder checks found a problem' };
    }

    if (evidence.planTree !== evidence.endTree) {
        return { refused: 'the tree changed during the run, so the pass proves an older tree' };
    }

    return {
        version: 1,
        platform: evidence.platform,
        branch: evidence.branch,
        tree: evidence.planTree,
        head: evidence.head,
        owed: [...new Set(evidence.dropped)].sort(),
        at: evidence.now,
    };
}
