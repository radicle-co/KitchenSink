/**
 * The database accepts exactly the lists the service writes from (migrations 0088 and 0091), asserted against a real
 * Docker PostgreSQL as the SERVICE role (ADR-0039).
 *
 * ⛔ WHY THIS TIER: a TypeScript list and the CHECK that mirrors it can drift apart, and nothing below the database can
 * see it. `importSchemaParity.test.ts` reads migration text and `schemaModelConformance.e2e.test.ts` checks columns only.
 * Here every value is INSERTED: the database must accept each member of the list and refuse one it does not know.
 *
 * What is asserted:
 *
 *  1. For every `ATTESTATION_CHOICES` value, an attestation of the right shape is accepted, and an unknown choice is refused.
 *  2. For every `RecipeSourceKind`, an `editorCitation` evidence row with a citation is accepted exactly for the kinds in
 *     `EDITOR_CITATION_SOURCE_KINDS`, and refused for the rest.
 *  3. An `editorCitation` row of an allowed kind with no citation is refused.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

import { RECIPE_SOURCE_KINDS } from '@kitchensink/recipe-core';

import { ATTESTATION_CHOICES } from '../../../src/database/schema/recipeStatementAttestations.js';
import { EDITOR_CITATION_SOURCE_KINDS } from '../../../src/database/schema/recipeSourceEvidence.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER_ID = '01JU7PARITY0000000000000OWNER';
const CHECK_VIOLATION = '23514';

/** The shape the mode and wording CHECKs need for one choice, so only the choice itself decides acceptance. */
function attestationOf(choice: string): { mode: string; wording: string | null; locale: string | null } {
    if (choice === 'publicConfirm') {
        return { mode: 'implicit', wording: 'publicConfirm.v1', locale: 'en' };
    }

    if (choice === 'cleared') {
        return { mode: 'explicit', wording: null, locale: null };
    }

    return {
        mode: 'explicit',
        wording: `statement${choice.charAt(0).toUpperCase()}${choice.slice(1)}.v1`,
        locale: 'en',
    };
}

describe('the TypeScript lists and the database CHECKs agree (migrations 0088 and 0091)', () => {
    let RECIPE_ID: string;
    let pool: pg.Pool;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    beforeEach(async () => {
        RECIPE_ID = randomUUID();
        await pool.query(
            `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                  total_time_minutes, servings, visibility, status)
             VALUES ($1, $2, 'Parity suite', '', 1, 1, 2, 4, 'private', 'draft')`,
            [RECIPE_ID, OWNER_ID],
        );
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM recipes WHERE id = $1`, [RECIPE_ID]);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function attest(choice: string): Promise<void> {
        const { mode, wording, locale } = attestationOf(choice);

        await pool.query(
            `INSERT INTO recipe_statement_attestations (recipe_id, recipe_ref, account_id, mode, choice, wording_version, locale, action)
             VALUES ($1, $1, $2, $3, $4, $5, $6, 'create')`,
            [RECIPE_ID, OWNER_ID, mode, choice, wording, locale],
        );
    }

    async function evidence(sourceKind: string, citation: string | null): Promise<void> {
        await pool.query(
            `INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
             VALUES ($1, 'editorCitation', $2, $3)`,
            [RECIPE_ID, sourceKind, citation],
        );
    }

    it.each([...ATTESTATION_CHOICES])('accepts an attestation of the choice %s', async (choice) => {
        await expect(attest(choice)).resolves.toBeUndefined();
    });

    it('refuses an attestation of a choice outside the list', async () => {
        await expect(attest('bogus')).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it.each([...RECIPE_SOURCE_KINDS])('decides an editorCitation row of source kind %s by the list', async (kind) => {
        const allowed = (EDITOR_CITATION_SOURCE_KINDS as readonly string[]).includes(kind);

        if (allowed) {
            await expect(evidence(kind, 'A citation')).resolves.toBeUndefined();
        } else {
            await expect(evidence(kind, 'A citation')).rejects.toMatchObject({ code: CHECK_VIOLATION });
        }
    });

    it.each([...EDITOR_CITATION_SOURCE_KINDS])(
        'refuses an editorCitation row of kind %s with no citation',
        async (kind) => {
            await expect(evidence(kind, null)).rejects.toMatchObject({ code: CHECK_VIOLATION });
        },
    );
});
