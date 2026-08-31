/**
 * WHICH LINES THE VERIFICATION GATE IS ASKED ABOUT (plan U11 / ADR-0024 layer 0) — the pure half of the
 * producer.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `provenancePolicy.ts` and
 * `transcriptionCarryForward.ts`, and the pure `decide` of the decide/evaluate split this repository already
 * uses in `deploy-gate.sh` and in `evaluateProvenance` vs `RecipesService.create`. It answers ONE question —
 * "for this saved recipe, which lines does the model need to see?" — from its inputs alone: no database, no
 * queue, no clock (`requestedAt` is injected for exactly that reason).
 *
 * ## ⛔ WHY THE PRODUCER LIVES ON THE RECIPE WRITE PATH AND NOT IN THE CASCADE
 *
 * The obvious home looks like a fourth `ResolutionTier`, and both `resolutionCascade.ts` and plan U11 point
 * there. It cannot work, for a reason that is about the gate rather than about wiring. KTD-3 is titled
 * "the verification gate, NOT a residual fallback": "a tier-4-as-residual design never sees a confidently
 * wrong answer, and every one of the ~900 bad `food_id`s was confidently wrong — so the model verifies what
 * is about to be PUBLISHED." A cascade tier is consulted precisely when tiers 1–3 have all PASSED, i.e. when
 * there is no resolution to verify, no `foodId`, and no identity evidence. The message contract says the same
 * thing structurally: `foodId` is `min(1)` and `evidenceKind` is closed over the three identity-establishing
 * tiers, with no member for "nothing resolved".
 *
 * `IngredientsService.addByName` is the next candidate and is also wrong: it is per-PHRASE, and five of the
 * message's fields — `recipeId`, `sourceLine`, `quantityLow`, `quantityHigh`, `unit`, `statedMeasure` — do not exist
 * there. They exist in exactly one place, which is where this module is called from: `RecipesService.create`
 * and `RecipesService.update`, after the ingredient rows are persisted.
 *
 * `0024_ingredient_source_line.sql` says the same thing from the data side: it added `source_line` to
 * `recipe_ingredients` — the RECIPE junction — and its header opens "⛔ THIS COLUMN IS WHY U11'S VERIFICATION
 * GATE SHIPPED INERT".
 *
 * ## ⛔ EVERY LINE VERIFIES BOTH ASPECTS, AND THAT IS NOT A PLACEHOLDER
 *
 * The evidence declared is `unattributed` (see the policy's own member docstring). Nothing persists which
 * cascade tier resolved a catalog row — `resolveThroughCascade` keeps only the `foodId` — so by the time a
 * line is saved against a recipe, the provenance is genuinely unrecoverable rather than merely unread. That
 * evidence opens no skip door, so `decideVerification` asks about identity AND quantity. This is KTD-3's own
 * default ("everything else verifies") and the safe direction: over-verifying costs money at ~370x headroom,
 * under-verifying publishes nutrition nothing checked. It is also free against the plan's cost basis, which
 * is stated "under KTD-3's verify-everything policy".
 *
 * ## ⛔ THE ALREADY-REQUESTED FILTER IS A SPEND CONTROL, NOT A TIDINESS ONE
 *
 * `RecipeIngredientsDal.replaceForRecipe` deletes every ingredient row of a recipe and re-inserts the whole
 * set on EVERY save. Without this filter, editing one word of a title re-enqueues — and re-PAYS for — every
 * line in the recipe, which is the exact failure `verificationKey.ts` says content-keying removes. Content
 * keying made the verdict WRITE idempotent; nothing makes the CALL idempotent. ⚠️ This is not that, and an
 * earlier wording here overclaimed that it was: it deduplicates within ONE recipe, across ONE save, and only
 * if the previous save's enqueue actually happened. Across recipes it does nothing, and a second create of
 * the same content asks again. The exact answer is a keyed read of `recipe_ingredient_verifications` — see
 * {@link VerificationRequestInput.alreadyRequested}.
 *
 * The comparison defers to {@link verificationKeyPreimage} rather than comparing fields locally, because that
 * function is the ONE authoritative answer to "what is this judgement about" — it is what the verdict table
 * is keyed on. Two implementations of that rule would drift, and the drift would be invisible: it would show
 * up only as a bill.
 */
import { z } from 'zod';

import type { IngredientQuantity, StatedMeasure } from '@kitchensink/recipe-core';
import {
    curatedExactEvidence,
    decideVerification,
    rankedEvidence,
    rememberedEvidence,
    unattributedEvidence,
    type IdentityEvidence,
    type VerificationThresholds,
} from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import { bandKeyText, type BandKey } from '@kitchensink/recipe-core/resolution/band-authority-store';
import { marginBandOf, type BandAuthority } from '@kitchensink/recipe-core/resolution/band-policy';
import { verificationKeyPreimage } from '@kitchensink/recipe-core/resolution/verification-key';
import {
    MAX_VERIFICATION_SHORTLIST,
    scoredCandidateSchema,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

import type { LatestResolution } from '../../ingredients/resolution/ingredientResolutions.dal.js';

import { verifiedLineIdentity } from './lineVerification.js';
import type { VerifiedLineIdentity } from '@kitchensink/recipe-core/resolution/verification-key';

/**
 * One persisted recipe ingredient line, adapted for the gate.
 *
 * Deliberately NOT `ResolvedIngredientLine` or `RecipeIngredientRow`: those are persistence shapes carrying
 * sort order, display overrides and per-line nutrition overrides that the gate must never see. This is the
 * projection of a line onto the question "is our reading of this source text right?", and nothing else.
 */
export interface VerifiableLine {
    /**
     * The raw line the cook's SOURCE stated, or `undefined` when the line was AUTHORED.
     *
     * ⛔ `undefined` is a statement, not missing data: there is no source for our parse to disagree with, so
     * there is nothing to ask. `decideVerification` reads it as `skip: 'no-source-text'`.
     */
    readonly sourceLine: string | undefined;
    /**
     * The opaque food-service id, or `undefined` for a user-entered ingredient.
     *
     * A user-entered ingredient carries its own nutrition (FR-007a) and references no catalog row, so there
     * is no identity for the model to check and no `candidateFoodName` that would mean anything.
     */
    readonly foodId: string | undefined;
    /** The catalog's name for that food — what the model is asked to judge identity against. */
    readonly candidateFoodName: string;
    /** What the line states: one value, two bounds, or nothing (U8/KTD-6). */
    readonly quantity: IngredientQuantity;
    /** The parsed unit. `''` is the persistence layer's "none" — projected to `null` on the wire. */
    readonly unit: string;
    /**
     * What the SOURCE printed, when {@link quantity}/{@link unit} are a RESTATEMENT of it (migration 0027).
     *
     * ⛔ THE FIELD THAT STOPS THIS PRODUCER MANUFACTURING A FALSE DISAGREE. The lines here are PERSISTED rows,
     * and a historical measure was already restated before it reached them — `one gill of milk` is stored as
     * `0.5 cup`. Building the message from the stored pair alone showed the model a source line beside a
     * number that source never printed, and it correctly disagreed with a line we had parsed right.
     *
     * ⛔ A REQUIRED KEY carrying `undefined`, like {@link sourceLine} beside it. A stated measure genuinely
     * does not exist for most lines, so the VALUE is optional while the KEY is not — which is what makes
     * every projection site a compile error rather than a silent reversion to the old question.
     */
    readonly statedMeasure: StatedMeasure | undefined;
    /**
     * The latest recorded resolution EVENT for this line's ingredient, or `undefined` when none is
     * recorded (plan U2/U4). A REQUIRED key carrying `undefined`, like {@link sourceLine} — every
     * projection site must decide, and absence is a statement ("nothing attributed"), never missing data.
     * The full event, not the tier name alone: the stored shortlist is what an honest `ranked` claim
     * requires, and the band fields are what authority is consulted under.
     */
    readonly resolution: LatestResolution | undefined;
    /**
     * U11/R20: the bound food is the OWNER's private authored one (`ingredients.food_owner_id` matched
     * the recipe's owner). Rides to the worker as the message's `privateFood` — no memo, no band.
     */
    readonly privateFood?: boolean;
}

/**
 * A line the gate will never be asked about, and why.
 *
 * ⛔ EXISTS BECAUSE `reject` AND `skip` ARE NOT THE SAME OUTCOME. `recipeRequestBounds.ts` states the
 * intent for an over-cap line: it should resolve "as unresolved and be surfaced for correction, which is
 * precisely the outcome that branch exists to produce". Silently dropping it alongside an authored line
 * makes a line the system has permanently decided never to check invisible in every log there is — and it
 * renders `verifyLine.ts`'s own over-cap branch unreachable from BOTH sides, since no message ever gets far
 * enough to hit it.
 *
 * Reporting is the interim (the gate ships observe-only, so there is no `unresolved` state to write yet);
 * `RecipesService` logs these, which is what makes the rate visible at all.
 */
export interface UnaskedLine {
    /**
     * Why the line was not asked about.
     *
     *  - `authored` — the cook wrote it; there is no source for our parse to disagree with.
     *  - `no-catalog-identity` — a user-entered ingredient; no food to check identity against.
     *  - `blank-source` — a source line with no visible content.
     *  - `over-cap` — ⛔ REJECTED, never truncated (ADR-0024 §2). Reachable for a real cookbook line:
     *    `MAX_RECIPE_INGREDIENT_SOURCE_LINE_LENGTH` admits 1000 characters and this gate caps at 400.
     */
    readonly reason: 'authored' | 'no-catalog-identity' | 'blank-source' | 'over-cap';
    /** How long the source line was, for an `over-cap` line. Absent otherwise. */
    readonly observedChars?: number;
}

/** One identity settlement granted by band authority, recorded for revocation's drain (plan U3, R14). */
export interface BandSkipRecord {
    readonly band: BandKey;
    /** The authority epoch the settlement happened under. */
    readonly epoch: number;
    /** The message as SENT, verbatim — what the drain re-sends if the band is revoked. */
    readonly message: VerifyIngredientLineMessage;
}

/** One withholding line's judgement identity and its ready message, for the re-drive substrate (0037). */
export interface PendingRedriveRecord {
    readonly judgement: VerifiedLineIdentity;
    readonly message: VerifyIngredientLineMessage;
}

/** What the producer decided: the messages to send, and every line it will never ask about. */
export interface VerificationRequestPlan {
    readonly requests: readonly VerifyIngredientLineMessage[];
    /**
     * Identity settlements granted by band authority this save (⚠️ these lines' messages are STILL in
     * {@link requests} — quantity is never skippable). The impure half persists each into
     * `resolution_band_skips`; revocation's drain re-sends from there.
     */
    readonly bandSkips: readonly BandSkipRecord[];
    /**
     * The WITHHOLDING lines' judgements + ready messages (plan U4c, KTD-A): every ranked line that will
     * render `pending-verification` until its verdict lands. The impure half stores each in the re-drive
     * substrate (0037) under the verdict store's content key, so a lost or DLQ'd verification is
     * re-driven by the scheduled drain rather than pending forever.
     */
    readonly pendingRedrives: readonly PendingRedriveRecord[];
    /**
     * Lines that will never be verified.
     *
     * ⚠️ NOT an error list — `authored` is the dominant, entirely normal case. It is here so `over-cap`, the
     * one entry that means "we permanently gave up on a line a cook can see", is not invisible.
     */
    readonly unasked: readonly UnaskedLine[];
}

/** One band's loaded authority plus the shadow coin's outcome, as the impure half supplies them. */
export interface BandConsultation {
    readonly authority: BandAuthority | undefined;
    readonly shadow: boolean;
}

/** Everything the plan needs. Total: every input produces a plan, and nothing here throws. */
export interface VerificationRequestInput {
    /** The recipe the lines belong to. Correlation only — a verdict is keyed on content, not on this. */
    readonly recipeId: string;
    /** The lines as they are now persisted, in the author's order. */
    readonly lines: readonly VerifiableLine[];
    /**
     * The lines a request was already made for — on an UPDATE, the recipe's previously stored lines.
     *
     * Empty on a create. A list of LINES rather than of keys because the caller holds rows, not digests, and
     * because the identity of a judgement is derived here in exactly one place.
     *
     * ⚠️ IT IS A PROXY, and the two ways it is imprecise both matter — named here rather than discovered:
     *
     *  - **It ASSUMES the previous save asked.** True for every recipe written after this producer shipped;
     *    false for one written before it, whose unchanged lines will never be asked about by an edit. The
     *    backfill for those is plan U15's re-import, which goes through CREATE (where this list is empty),
     *    not through an edit.
     *  - **It is scoped to THIS RECIPE.** Two recipes quoting the same source line each pay, which
     *    contradicts `0023_line_verifications.sql`'s claim to verify such a line "once". Closing that needs
     *    a read of `recipe_ingredient_verifications` by key — an exact answer where this is an approximation,
     *    and the follow-up that would also cover the first case.
     *
     * Both directions of imprecision cost MONEY, never correctness: the worst outcome is a duplicate
     * question whose verdict write is idempotent by primary key.
     */
    readonly alreadyRequested: readonly VerifiableLine[];
    /** The gate's bands, injected — R17 makes them measured, so calibration is a value change. */
    readonly thresholds: VerificationThresholds;
    /**
     * Band consultations by {@link bandKeyText}, loaded by the impure half for the bands this save's
     * ranked lines fall in. An absent entry means NO authority — the day-one state, in which every ranked
     * line verifies identity. `shadow: true` is the impure half's coin: ask identity anyway and flag the
     * message so the worker records the observation under `shadow`.
     */
    readonly bands: ReadonlyMap<string, BandConsultation>;
    /** ISO-8601 instant of this request. Injected so this module has no clock. */
    readonly requestedAt: string;
}

/**
 * The canonical identity of the judgement this line would ask for, or `undefined` when it would ask for none.
 *
 * ⛔ DELEGATES BOTH HALVES, and that is the point. The SERIALIZATION is `verificationKeyPreimage` — the same
 * one the verdict table is keyed on. The COLUMN→TUPLE MAPPING is `verifiedLineIdentity`
 * (`./lineVerification.ts`), which is also what U14's read side uses to look a verdict UP. Two answers to
 * "what is this judgement about" would drift, and the drift would be invisible — the reader would report
 * "the gate has judged nothing" while the gate judged, and was billed for, everything.
 *
 * ⚠️ It used to derive the tuple here, with a local `boundsOf` and `unitOf`. That was one derivation too
 * many and it HAD already diverged from the reader's by the time both shipped (a whitespace-only unit, which
 * `recipeIngredientUnitSchema` admits). The reasoning those helpers carried is preserved where the mapping
 * now lives: an EXACT quantity reports `quantityHigh: null` rather than a repeat of its value — which is why
 * recipe-core's `quantityUpperBound` is deliberately not used, since it answers a different question ("the
 * largest amount the line admits") whose right answer for an exact quantity is the wrong one for this
 * contract.
 *
 * @param line - The line.
 * @returns The preimage, or `undefined` for a line that carries no judgement (authored, or user-entered).
 */
function judgementIdentity(line: VerifiableLine): string | undefined {
    const identity = verifiedLineIdentity(line, line.foodId);

    return identity === undefined ? undefined : verificationKeyPreimage(identity);
}

/**
 * Decide which of a saved recipe's lines the verification gate is asked about, and build those messages.
 *
 * ⛔ TOTAL AND NON-THROWING. It is called after the recipe is already persisted, so a throw here would fail a
 * save that had already succeeded. Every line that cannot be asked about is simply absent from the result.
 *
 * @param input - The recipe, its lines, what was already asked, the bands and the instant.
 * @returns The messages to enqueue in the author's line order, deduplicated by judgement, and every line
 *   that will never be asked about. Pure.
 */
/** The wire's own bound applied to the STORED snapshot — a row nothing validates cannot claim `ranked`. */
const storedShortlistSchema = z.array(scoredCandidateSchema).max(MAX_VERIFICATION_SHORTLIST);

/**
 * The identity evidence a persisted resolution event honestly supports (plan U2/U4).
 *
 * ⛔ `lexical` claims `ranked` ONLY through a shortlist the wire schema accepts: the stored jsonb is
 * zod-parsed here, and a legacy or mangled row degrades to `unattributed` — which opens no skip door and
 * verifies both aspects, the safe direction. `llm` stays unattributed (no tier ships it yet).
 *
 * @param resolution - The recorded event, or `undefined` when none exists.
 * @returns The evidence the gate policy may act on. Pure.
 */
function evidenceFor(resolution: LatestResolution | undefined): IdentityEvidence {
    if (resolution?.tier === 'curated') {
        return curatedExactEvidence();
    }

    if (resolution?.tier === 'memo') {
        return rememberedEvidence();
    }

    if (resolution?.tier === 'lexical') {
        const parsed = storedShortlistSchema.safeParse(resolution.shortlist);

        if (parsed.success) {
            return rankedEvidence(parsed.data);
        }
    }

    return unattributedEvidence();
}

/**
 * The band a ranked resolution's confidence shape belongs to, or `undefined` when the event does not
 * carry a complete key (non-ranking tiers, and legacy rows).
 *
 * @param resolution - The recorded event.
 * @returns The full band key, or `undefined`. Pure.
 */
export function bandKeyOf(resolution: LatestResolution | undefined): BandKey | undefined {
    if (
        resolution === undefined ||
        resolution.tier !== 'lexical' ||
        resolution.rung === null ||
        resolution.queryShape === null ||
        resolution.rankerVersion === null ||
        // U11/R20: an author-augmented shortlist's margins describe ONE user's private catalog. No band is
        // consulted (no skip, no shadow) and none is fed — the line simply verifies, every time.
        resolution.authorAugmented
    ) {
        return undefined;
    }

    return {
        rung: resolution.rung,
        marginBand: marginBandOf(resolution.margin ?? undefined),
        queryShape: resolution.queryShape,
        rankerVersion: resolution.rankerVersion,
    };
}

export function buildVerificationRequests(input: VerificationRequestInput): VerificationRequestPlan {
    const seen = new Set<string>();

    for (const previous of input.alreadyRequested) {
        const identity = judgementIdentity(previous);

        if (identity !== undefined) {
            seen.add(identity);
        }
    }

    const requests: VerifyIngredientLineMessage[] = [];
    const unasked: UnaskedLine[] = [];
    const bandSkips: BandSkipRecord[] = [];
    const pendingRedrives: PendingRedriveRecord[] = [];

    for (const line of input.lines) {
        const { sourceLine, foodId } = line;

        // Two lines the gate structurally cannot be asked about, and they are DIFFERENT facts: an AUTHORED
        // line has no source for our parse to disagree with, while a USER-ENTERED ingredient has no catalog
        // identity (and a message with an empty `foodId` could not satisfy the consumer's schema, so emitting
        // one would manufacture DLQ poison). Destructured so the narrowing is the guard, not a later
        // assertion.
        if (sourceLine === undefined) {
            unasked.push({ reason: 'authored' });
            continue;
        }

        if (foodId === undefined) {
            unasked.push({ reason: 'no-catalog-identity' });
            continue;
        }

        // ⛔ ADR-0024 layer 0. The pure policy decides whether there is anything to ask BEFORE anything is
        // sent — `skip` for a blank line, `reject` for an over-cap one (which is never truncated).
        const evidence = evidenceFor(line.resolution);
        const bandKey = bandKeyOf(line.resolution);
        const consultation = bandKey === undefined ? undefined : input.bands.get(bandKeyText(bandKey));
        // A shadow-sampled line hides its authority from the policy ON PURPOSE — the coin's whole job is
        // to make the gate ask identity anyway, so the band's measured record keeps accruing.
        const shadow = consultation?.shadow === true;
        const decision = decideVerification({
            sourceLine,
            evidence,
            thresholds: input.thresholds,
            bandAuthority: shadow ? undefined : consultation?.authority,
        });

        if (decision.kind === 'skip') {
            unasked.push({ reason: 'blank-source' });
            continue;
        }

        if (decision.kind === 'reject') {
            // ⛔ REPORTED, not silently dropped. This is a line a cook can see that the system has decided it
            // will never check; collapsing it into the authored case makes that decision invisible everywhere.
            unasked.push({ reason: 'over-cap', observedChars: decision.observedChars });
            continue;
        }

        // ⛔ ONE derivation feeds BOTH the dedup key and the message's own fields. Deriving them separately
        // is how a message could be sent describing a judgement other than the one the dedup set recorded —
        // and, worse, other than the one U14's reader will look the resulting verdict up under.
        const judgement = verifiedLineIdentity(line, foodId);

        if (judgement === undefined) {
            continue;
        }

        const identity = verificationKeyPreimage(judgement);

        if (seen.has(identity)) {
            continue;
        }

        seen.add(identity);

        const message: VerifyIngredientLineMessage = {
            recipeId: input.recipeId,
            sourceLine,
            foodId,
            candidateFoodName: line.candidateFoodName,
            quantityLow: judgement.quantityLow,
            quantityHigh: judgement.quantityHigh,
            unit: judgement.unit,
            // ⛔ From the SAME `verifiedLineIdentity` call as the three above, never re-derived beside them.
            // The stated pair is IN the verdict key (`v2`), so a message describing a different stated pair
            // from the one the dedup set recorded would be billed for, answered, and then stored under a key
            // U14's reader never looks up. `null` on the identity means "not restated"; the wire spells that
            // by omitting the key, which is why this is a spread rather than an assignment.
            ...(judgement.statedMeasure === null ? {} : { statedMeasure: judgement.statedMeasure }),
            // U2: the PERSISTED tier, mapped through `evidenceFor` — the same evidence the decision above
            // was made from, so the worker's re-run judges what this producer judged.
            evidenceKind: evidence.kind,
            // U4: the SAME validated shortlist the evidence was built from — never re-read from the row.
            shortlist: evidence.kind === 'ranked' ? [...evidence.shortlist] : [],
            requestedAt: input.requestedAt,
            ...(shadow ? { shadowSample: true } : {}),
            // U11/R20 — see the message schema: author-augmented margins feed no band; a private bound
            // food writes no memo. Spread so an ordinary line's wire bytes are unchanged.
            ...(line.resolution?.authorAugmented ? { authorAugmented: true } : {}),
            ...(line.privateFood ? { privateFood: true } : {}),
        };

        requests.push(message);

        // KTD-A: an AUTHORIZED band whose line also met the floors settled identity — the decision above
        // excused the aspect. Record the settlement with the message VERBATIM: the drain re-sends exactly
        // this if the band is ever revoked, and the content-keyed verdict store makes the re-ask cheap.
        if (
            bandKey !== undefined &&
            consultation?.authority?.state === 'authorized' &&
            !shadow &&
            decision.kind === 'verify' &&
            !decision.aspects.includes('identity')
        ) {
            bandSkips.push({ band: bandKey, epoch: consultation.authority.epoch, message });
        }

        // KTD-A: a RANKED line still being asked about identity is the withholding class — it renders
        // `pending-verification` until this very message's verdict lands, so its judgement + message go to
        // the re-drive substrate. Shadow is excluded (a shadow line's band is authorized, so it settled
        // instantly and does not pend); curated/memo/unattributed keep absence-means-publish and need no
        // re-drive.
        if (
            evidence.kind === 'ranked' &&
            !shadow &&
            decision.kind === 'verify' &&
            decision.aspects.includes('identity')
        ) {
            pendingRedrives.push({ judgement, message });
        }
    }

    return { requests, unasked, bandSkips, pendingRedrives };
}
