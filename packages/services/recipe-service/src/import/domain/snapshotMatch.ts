/**
 * A snapshot line read back as the paste matcher's `ParseJobMatch` (ADR-0072 §4).
 *
 * DESIGN PATTERN: **Adapter**, pure. The import copies each line's match out of the one-day parse job into its own rows
 * (`recipe_import_lines`), because the job and its match rows are deleted with it. The view reads those copies, and projects
 * them through the SAME function the paste screen uses (`projectMatch`), so the closed `MatchState` and every reason have one
 * definition and the wizard and the lists cannot read a verdict differently from the paste.
 *
 * ⛔ A stored line this build cannot read is a THROWN error, not a silently absent match: the writer is this service, so an
 * unreadable row is a defect to surface (the posture of `ParseJobMatchesDal`).
 */
import { z } from 'zod';
import { parseStoredLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { isMatchProposingTier } from '../../database/schema/parseJobMatches.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import { rankTierOf } from '../../recipes/domain/matchProposal.js';
import type { MatchCandidate, ParseJobMatch, ProposalReview } from '../../recipes/domain/parseJobMatch.js';
import type { ImportLine } from '../dal/recipeImportLines.dal.js';

/** The stored candidate list: ids and rungs, no names and no verdicts. */
const storedCandidatesSchema = z.array(
    z.object({
        kind: z.enum(['root', 'variant']),
        id: z.string().min(1),
        rung: z.string().nullable(),
        isDefault: z.boolean().optional(),
    }),
);

/** The food the line proposed, or `undefined` for a line that found nothing. */
function proposedFoodOf(line: ImportLine): FoodRef | undefined {
    if (line.foodVariantId !== null) {
        return { kind: 'variant', id: line.foodVariantId };
    }

    return line.foodId === null ? undefined : { kind: 'root', id: line.foodId };
}

/** The proposal, its review and its key, as ONE of the three shapes the table's CHECKs allow. */
function reviewOf(line: ImportLine): ProposalReview {
    const food = proposedFoodOf(line);

    if (food === undefined) {
        return { proposal: null, verificationKey: null, review: null };
    }

    if (line.matchedBy === null || !isMatchProposingTier(line.matchedBy)) {
        throw new Error(`import line ${line.id} proposes a food with no known tier`);
    }

    const proposal = { matchedBy: line.matchedBy, food, rung: rankTierOf(line.rung), margin: line.margin };

    if (line.review === 'owed' && line.verificationKey !== null) {
        return { proposal, verificationKey: line.verificationKey, review: 'owed' };
    }

    if (line.review === 'refused' && line.verificationKey === null) {
        return { proposal, verificationKey: null, review: 'refused' };
    }

    throw new Error(`import line ${line.id} proposes a food with no coherent review`);
}

/**
 * The paste matcher's view of a snapshot line.
 *
 * @param line - The stored snapshot line.
 * @returns The match, as `projectMatch` reads it. Pure.
 * @throws {Error} on a stored line the table's CHECKs would have refused.
 */
export function matchOfSnapshotLine(line: ImportLine): ParseJobMatch {
    const candidates: MatchCandidate[] = storedCandidatesSchema
        .parse(line.candidates)
        .map((candidate) => ({ kind: candidate.kind, id: candidate.id, rung: rankTierOf(candidate.rung) }));
    const digest = parseStoredLineDigest(line.lineDigest);

    return {
        lineIndex: line.lineIndex,
        foodIndex: line.foodIndex,
        lineDigest: digest,
        judgementDigest: line.judgementDigest,
        candidates,
        ...reviewOf(line),
        enqueuedAt: null,
        lineDigestNow: digest,
    };
}
