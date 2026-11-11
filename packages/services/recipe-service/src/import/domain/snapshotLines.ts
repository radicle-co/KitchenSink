/**
 * Building an item's snapshot of match lines from its parse job and the stored matches (ADR-0072 §4).
 *
 * DESIGN PATTERN: **Mapper**, pure. The parse job and its match rows are deleted with the job a day after it is made, but a
 * review wizard over five hundred recipes outlives that, so the first complete read of an item COPIES what the import needs
 * into its own rows (`recipe_import_lines`) and the import reads the copy: the line digest, the parsed phrase and the measure,
 * the proposed food with its tier, rung and margin, the candidates with their default mark, and the verification key. It holds
 * ids and the cook's own words and never a food name (ADR-0045), and never the verdict (read by key on every view).
 *
 * ⛔ THE ROW IS THE ONE THE EDITOR SAVES (`pastedLineRowOf`, migration 0067): the cook's own words win, only the first food of
 * a line carries the measure, a leading size word is the unit, a dimension in parentheses is the note, and the cook's words are
 * the shown name when the parse chose them (owner ruling 2026-11-08). The recipe line the import saves therefore reads as the
 * cook wrote it and has the measure the proposal was judged under, so the saved line's verdict key equals the proposal's and
 * the save path does not pay the gate again for a judgement on record. A pasted line saves no restatement, so the `stated_*`
 * columns are NULL.
 *
 * ⛔ `undefined` when a parsed food has no CURRENT match: the item is not ready, and a snapshot with a hole in it would turn a
 * transient outage into a permanent "no match" (ADR-0071 rule 4).
 */
import type { HexDigest } from '@kitchensink/recipe-core/resolution/verification-key';
import { parseStoredLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { pastedLineRowOf } from '@kitchensink/recipe-core/parsing/pasted-line-measure';

import { quantityColumns } from '../../recipes/dal/quantityColumns.js';
import { isDefaultRung, matchJudgementDigestOf } from '../../recipes/domain/matchProposal.js';
import { isCurrentMatch, slotKey, type ParseJobMatch } from '../../recipes/domain/parseJobMatch.js';
import { projectProposal, type ParseJobRecord } from '../../recipes/parseJobs.service.js';
import type { ImportLine, NewImportLine } from '../dal/recipeImportLines.dal.js';

/**
 * The name a snapshot line's food is saved and shown under: the row's name (migration 0067), or its phrase for a line
 * snapshotted before the row was kept. The one reading of that fallback, for the save and the wizard alike. Pure.
 */
export function savedNameOf(line: Pick<ImportLine, 'name' | 'phrase'>): string {
    return line.name ?? line.phrase;
}

/**
 * The snapshot lines of a parsed job.
 *
 * @param job - The job, as the service reads it.
 * @param matches - The job's stored matches.
 * @param digest - The hex digest (`sha256Hex`).
 * @returns One line per (line, food), or `undefined` when a parsed food has no current match. Pure.
 */
export function snapshotLinesOf(
    job: ParseJobRecord,
    matches: readonly ParseJobMatch[],
    digest: HexDigest,
): readonly NewImportLine[] | undefined {
    const bySlot = new Map(matches.map((match) => [slotKey(match), match] as const));
    const snapshot: NewImportLine[] = [];

    for (const line of job.lines) {
        if (line.status !== 'parsed' || line.proposal === null) {
            continue;
        }

        const proposal = projectProposal(line.proposal);
        const lineDigest = parseStoredLineDigest(line.lineDigest);

        for (const [foodIndex, food] of proposal.foods.entries()) {
            const parse = {
                sourceLine: line.sourceLine,
                quantity: proposal.quantity,
                unit: proposal.unit,
                statedMeasure: proposal.statedMeasure,
            };
            const judgementDigest = matchJudgementDigestOf(
                { lineDigest, line: parse, foodIndex, phrase: food.name },
                digest,
            );
            const match = bySlot.get(slotKey({ lineIndex: line.lineIndex, foodIndex }));

            if (match === undefined || !isCurrentMatch(match, { lineDigest, judgementDigest })) {
                return undefined;
            }

            // `display` is the parse's answer for THIS food (ADR-0026 §11); it decides only the shown name, never the key.
            const row = pastedLineRowOf({ ...parse, display: food.display ?? null }, foodIndex, food.name);
            const { proposal: proposed } = match;
            const prep = food.prep?.trim() ?? '';

            snapshot.push({
                lineIndex: line.lineIndex,
                foodIndex,
                sourceLine: line.sourceLine,
                lineDigest: line.lineDigest,
                judgementDigest,
                phrase: food.name,
                ...quantityColumns(row.quantity),
                unit: row.unit,
                statedQuantity: null,
                statedQuantityHigh: null,
                statedUnit: null,
                preparation: prep === '' ? null : prep,
                name: row.name,
                displayText: row.displayText ?? null,
                note: row.note ?? null,
                matchedBy: proposed?.matchedBy ?? null,
                foodId: proposed?.food.kind === 'root' ? proposed.food.id : null,
                foodVariantId: proposed?.food.kind === 'variant' ? proposed.food.id : null,
                rung: proposed?.rung ?? null,
                margin: proposed?.margin ?? null,
                candidates: match.candidates.map((candidate) => ({
                    kind: candidate.kind,
                    id: candidate.id,
                    rung: candidate.rung,
                    isDefault: isDefaultRung(candidate.rung),
                })),
                verificationKey: match.verificationKey,
                review: match.review,
            });
        }
    }

    return snapshot;
}
