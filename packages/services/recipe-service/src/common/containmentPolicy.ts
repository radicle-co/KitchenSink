/**
 * The pure test-principal CONTAINMENT policy (ADR-0040).
 *
 * @pattern Specification — the sibling of `recipes/domain/provenancePolicy.ts` and `visibilityPolicy.ts`, and
 *   shaped like them on purpose: inputs only, decision out, no DB, no `Principal` object, no I/O, so the whole
 *   rule is an exhaustible truth table.
 *
 * ## The one question this answers
 *
 * "Does this write let TEST data reach REAL data here?" A test principal is a member of a fixed Clerk test pool,
 * marked by the signed claim `public_metadata.testPrincipal === true` (`@kitchensink/clerk-verify`). On a stage
 * that ENFORCES containment (production), such a principal may still read, create private recipes and exercise
 * every owner-scoped path — which is what load and end-to-end tiers need — but it may not perform any write whose
 * effect lands on data real users see or depend on:
 *
 *  - `publish` — a public recipe or collection enters community discovery and search;
 *  - `rate` — a rating moves a real recipe's `average_rating` for everyone;
 *  - `cloneForeign` — a clone of a real user's content ties a test row into that user's erasure provenance;
 *  - `promoteCorrection` — a pool of test accounts is a sock-puppet farm, and a promotion binds a phrase globally
 *    and can complete a PENDING catalog food;
 *  - `recordAnalytics` — `recipe_impact_signals` never decrements (ADR-0030 §1), so a test view or save is
 *    permanent: it can only be PREVENTED, never cleaned up;
 *  - `eraseAccount` — erasure deletes the pool user and its anti-resurrection keeps the slot unusable forever;
 *  - `requestVerification` — the ingredient-verification worker spends ADR-0024's shared $100/month production LLM
 *    pool and writes the GLOBAL `ingredient_resolution_memos` tier, which answers for every future cook and carries no
 *    user column the test purge could reach. Like analytics it can only be PREVENTED, and preventing it costs a test
 *    nothing: absence of a verdict means publish (migration 0023).
 *
 * ## ⛔ Why this is composed INTO the existing policies through a REQUIRED field, not a route Guard
 *
 * ADR-0023's reasoning, a third time: every one of those routes must stay open to every authenticated user, and
 * what is being authorized is a field value or an effect, not a route. Each owning policy (visibility, correction
 * scope, …) takes `principalKind` + `containment` as REQUIRED inputs so every call site failed to compile until it
 * decided what a test principal means there — the technique 015 records for `hasAvailablePrivateSlot`. A default
 * would let a call site that never thought about test principals silently keep leaking.
 *
 * ## ⛔ The claim alone decides containment; the purge also requires the registry — which is NOT a second witness
 *
 * Containment keys on the signed claim only. That direction is fail-CLOSED: a real user mis-marked by an operator
 * loses publish on production, which is noisy and harmless. The self-purge (`POST /api/v1/account/test-reset`)
 * DESTROYS data, so it additionally requires the service's own `test_principals` registry to hold the principal. The
 * registry is written FROM the claim (`AuthMiddleware`), so it is not an independent witness: it guards against a
 * process that never registered the principal, not against a mis-marked Clerk user. ADR-0040 makes a genuinely
 * independent witness a precondition of any production tenant. Do not "simplify" the claim-only and claim-plus-
 * registry rules into one — either merge breaks one direction.
 *
 * ## `off` contains nobody
 *
 * Sandbox and every `pr-{N}` run `off` (owner ruling 2026-09-13): every row there lives in a per-PR database with
 * no real users, and the co-author / discover-clone / rating flows need these writes. An unset value parses to
 * `enforce` in config, so a stage that forgets the variable is contained rather than leaking.
 */

/** The two kinds of authenticated principal. `test` is a signed test-pool member; everything else is `real`. */
export const PRINCIPAL_KINDS = ['real', 'test'] as const;

/** Whether a principal is a signed test-pool member. */
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/** The deploy-time switch (`TEST_PRINCIPAL_CONTAINMENT`). `enforce` is the default when unset. */
export const TEST_PRINCIPAL_CONTAINMENT_MODES = ['enforce', 'off'] as const;

/** Whether this stage contains test principals. */
export type TestPrincipalContainment = (typeof TEST_PRINCIPAL_CONTAINMENT_MODES)[number];

/** The writes a contained test principal may not perform. See the module docstring for why each is here. */
export const CONTAINED_ACTIONS = [
    'publish',
    'rate',
    'cloneForeign',
    'promoteCorrection',
    'recordAnalytics',
    'eraseAccount',
    'requestVerification',
] as const;

/** A write a contained test principal may not perform. */
export type ContainedAction = (typeof CONTAINED_ACTIONS)[number];

/** The published wire code a containment denial answers with (a `403`). */
export const TEST_PRINCIPAL_CONTAINED_CODE = 'TEST_PRINCIPAL_CONTAINED';

/** Who is acting, and whether this stage contains them — the two facts every composed policy now requires. */
export interface ContainmentSubject {
    /** Whether the acting principal is a signed test-pool member. */
    readonly principalKind: PrincipalKind;
    /** Whether this stage contains test principals. */
    readonly containment: TestPrincipalContainment;
}

/** The complete input to a containment decision. */
export interface ContainmentInput extends ContainmentSubject {
    /** The write being attempted. */
    readonly action: ContainedAction;
}

/**
 * The outcome of a containment decision.
 *
 * A DISCRIMINATED UNION for `ProvenanceDecision`'s reason: a denial carries the code it answers with, and an allow
 * has no code to misread.
 */
export type ContainmentDecision =
    | { readonly allowed: true; readonly reason: string }
    | { readonly allowed: false; readonly code: typeof TEST_PRINCIPAL_CONTAINED_CODE; readonly reason: string };

/**
 * The denial sentence per action. A `Record` over the closed union, so adding an action is a compile error until
 * its refusal is worded — and each is distinct, so a 403 tells an operator which door a test write came through.
 */
const DENIAL_REASONS: Readonly<Record<ContainedAction, string>> = {
    publish: 'A test principal may not publish content on this stage.',
    rate: 'A test principal may not rate recipes on this stage.',
    cloneForeign: 'A test principal may not clone content it does not own on this stage.',
    promoteCorrection: 'A test principal’s corrections bind only itself on this stage.',
    recordAnalytics: 'A test principal’s activity is not recorded as analytics on this stage.',
    eraseAccount: 'A test principal may not erase its account on this stage; use the test reset instead.',
    requestVerification: 'A test principal’s ingredient lines are not sent to the verification gate on this stage.',
};

/**
 * Whether a subject is contained at all, independent of the action. Pure.
 *
 * The boolean projection of {@link evaluateContainment} for call sites that NARROW rather than refuse (a
 * correction's reach, an analytics capture that is skipped). It is the same rule, not a second one — the unit
 * suite asserts the projection against the evaluator.
 *
 * @param subject - The principal kind and the stage's containment mode.
 * @returns `true` exactly when a test principal acts on an enforcing stage.
 */
export function isContained(subject: ContainmentSubject): boolean {
    return subject.principalKind === 'test' && stageContains(subject);
}

/**
 * Whether this STAGE contains test principals at all, whoever is acting. Pure.
 *
 * The stage half of {@link isContained}, for the rules that bind every caller on a containing stage rather than only
 * a test principal — a REAL user's correction on production must not count a test principal's row as a corroborator
 * either, which is the direction the caller's own containment cannot reach. One projection, so "`enforce` means the
 * stage contains" is spelled once.
 *
 * @param subject - The stage's containment mode (the principal kind is deliberately ignored).
 * @returns `true` exactly when the stage enforces containment.
 */
export function stageContains(subject: Pick<ContainmentSubject, 'containment'>): boolean {
    return subject.containment === 'enforce';
}

/**
 * Which corroborators a correction tier's write-facts reader may count (ADR-0040).
 *
 * ⛔ REQUIRED by both correction DALs, never defaulted: a default would let a caller that never thought about test
 * principals silently let a test pool corroborate — and promote — a real user's correction on production. It lives
 * here, not in either DAL, because both tiers take it and it is a containment projection, not a statement shape.
 */
export interface CorroboratorScope {
    /**
     * `true` on a stage that CONTAINS test principals: an author row whose `user_id` is in `test_principals` is not a
     * corroborator. Keyed on the stage, not on the caller — see {@link stageContains}.
     */
    readonly excludeTestPrincipals: boolean;
}

/**
 * The corroborator scope for a stage. Pure.
 *
 * @param subject - The stage's containment mode.
 * @returns The scope both correction DALs require.
 */
export function corroboratorScopeFor(subject: Pick<ContainmentSubject, 'containment'>): CorroboratorScope {
    return { excludeTestPrincipals: stageContains(subject) };
}

/**
 * Evaluate whether a principal may perform a write that could reach real data. Pure — inputs only.
 *
 * @param input - The principal kind, the stage's containment mode, and the write being attempted.
 * @returns An allow, or a denial carrying {@link TEST_PRINCIPAL_CONTAINED_CODE} and a per-action reason.
 */
export function evaluateContainment(input: ContainmentInput): ContainmentDecision {
    if (!isContained(input)) {
        return {
            allowed: true,
            reason:
                input.principalKind === 'real'
                    ? 'A real principal is never contained.'
                    : 'This stage does not contain test principals.',
        };
    }

    return { allowed: false, code: TEST_PRINCIPAL_CONTAINED_CODE, reason: DENIAL_REASONS[input.action] };
}
