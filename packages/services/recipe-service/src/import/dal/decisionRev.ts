/**
 * The ONE spelling of "the cook decided something" on a bulk-import item (`decision_rev`, migration 0059).
 *
 * A decision does two things at once, and every write that makes one spreads this into its `SET`: it moves the fence a save
 * and a hold compare against, and it starts the count of unrecognised save failures again (`save_failures`, migration 0084),
 * because the cook may just have fixed what failed. A bump written inline once forgot the reset (the review mark), and an item
 * at four failures was held after one more. `decisionRevBumpOwner.test.ts` (repoGuards) refuses an inline bump anywhere else.
 *
 * It is a module of its own, not a member of either DAL, because the items DAL imports the imports DAL and the imports DAL
 * writes a decision too.
 */
import { sql } from 'drizzle-orm';

import { recipeImportItems } from '../../database/schema/recipeImports.js';

/** Moves an item's decision fence and resets its failure count, in one `SET`. */
export const BUMP_DECISION_REV = {
    decisionRev: sql`${recipeImportItems.decisionRev} + 1`,
    saveFailures: 0,
} as const;
