// @vitest-environment node
/**
 * Repo-wide guard: **exactly one production file may issue `DROP DATABASE`** — the per-PR reaper.
 *
 * ## Why
 *
 * A `DROP DATABASE` is the one statement in this repository that destroys data with no way back (ADR-0002: no
 * automatic snapshot). The role split (ADR-0039) deleted the per-service migration runners' `action: 'drop'` doors
 * so that the reaper — non-prod only, scope-checked twice, and able to drop only because the master INHERITs each
 * owner outside prod — is the ONLY thing that drops a per-PR database. The role split's one-shot legacy recreate was
 * the second door until it ran on sandbox and prod and the disarm commit deleted it. A second file acquiring the
 * statement is a new destructive door, and it must be argued in review, not discovered in an incident.
 *
 * Asserted by EXACT EQUALITY, so the list also cannot keep an entry for a door that no longer exists.
 */
import { describe, expect, it } from 'vitest';

import { productionScripts, readSource } from './roleSplitSources.js';
import { withoutComments } from './sourceComments.js';

/** The production files that may drop a database. */
const DROP_AUTHORITY: readonly string[] = [
    // The per-PR reaper (ADR-0031): non-prod only, per-PR names only.
    'packages/infra/global/src/db-reaper/handler.ts',
];

/** The keywords, in any case — SQL does not care, so neither may the guard. */
const DROP_KEYWORDS = /\bdrop\s+database\s+(?:if\s+exists\s+)?/giu;

/** What follows the keywords in a STATEMENT: a quoted, interpolated or snake_case name — never an English word. */
const DATABASE_NAME = /^(?:"|\$\{|\$[A-Za-z_]|[a-z0-9]+_[a-z0-9_]+)/u;

/**
 * Whether `text` issues a `DROP DATABASE` STATEMENT — the keywords followed by a database name — rather than prose
 * ("an interrupted DROP DATABASE left it invalid" is a refusal message, not a door).
 *
 * @param text - Source with its comments removed.
 * @returns The verdict. Pure.
 */
function issuesDropDatabase(text: string): boolean {
    return [...text.matchAll(DROP_KEYWORDS)].some((match) =>
        DATABASE_NAME.test(text.slice((match.index ?? 0) + match[0].length)),
    );
}

describe('who may DROP DATABASE', () => {
    it('recognises a statement in any case, and not prose — so the verdict below is about doors', () => {
        expect(issuesDropDatabase('`DROP DATABASE "${database}" WITH (FORCE)`')).toBe(true);
        expect(issuesDropDatabase('`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`')).toBe(true);
        expect(issuesDropDatabase("'DROP DATABASE kitchensink_food WITH (FORCE)'")).toBe(true);
        expect(issuesDropDatabase('drop database kitchensink_recipes_pr_7')).toBe(true);
        expect(issuesDropDatabase('Drop Database "x"')).toBe(true);
        expect(issuesDropDatabase('psql -c "DROP DATABASE $DB"')).toBe(true);
        expect(issuesDropDatabase('an interrupted DROP DATABASE left it invalid')).toBe(false);
    });

    it('is exactly the reaper — across TypeScript, JavaScript, shell and SQL', () => {
        const droppers = productionScripts().filter((path) =>
            issuesDropDatabase(withoutComments(path, readSource(path))),
        );

        expect(droppers).toEqual([...DROP_AUTHORITY].sort());
    });
});
