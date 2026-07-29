/**
 * Unit tests for the ONE authoritative recipe logical-database naming rule (ADR-0006).
 *
 * The reason this lives in `@kitchensink/recipe-core` rather than in either CDK stack is a shipped
 * defect (#119): the derivation lived inside `recipe-service`'s stack, the `recipe-workers` stack could
 * not reach it, and so the workers defaulted to the SHARED base database while the API used the per-PR
 * one. Every assertion below is therefore a cross-package contract, not local trivia.
 */
import { describe, expect, it } from 'vitest';

import { BASE_RECIPE_DATABASE_NAME, recipeDatabaseNameForStage } from '../recipeDatabaseName.js';

describe('recipeDatabaseNameForStage', () => {
    it('returns the imported base name unchanged when the deploy IS the platform base stage', () => {
        // The base stages own the shared database; the name is imported (a CFN export token in CDK), so it
        // must pass through untouched rather than being re-derived from the constant.
        expect(recipeDatabaseNameForStage('prod', 'prod', 'kitchensink_recipes')).toBe('kitchensink_recipes');
        expect(recipeDatabaseNameForStage('sandbox', 'sandbox', 'some_imported_token')).toBe('some_imported_token');
    });

    it('derives an isolated SUFFIXED database for a per-PR stage riding a base platform', () => {
        // SUFFIX form, matching food's `kitchensink_food_pr_7` and the migration runner's
        // `^kitchensink_recipes(_[a-z0-9_]+)?$` validator. A PREFIX form would fail that validator and be
        // refused by `ensureDatabaseExists`, so a preview would have no database at all.
        expect(recipeDatabaseNameForStage('pr-73', 'sandbox', 'kitchensink_recipes')).toBe('kitchensink_recipes_pr_73');
        expect(recipeDatabaseNameForStage('pr-1', 'sandbox', 'kitchensink_recipes')).toBe('kitchensink_recipes_pr_1');
    });

    it('ignores the imported base name on the per-PR branch, deriving from the constant instead', () => {
        // Load-bearing for #119: on a per-PR stage the name is built from BASE_RECIPE_DATABASE_NAME, NOT
        // from the caller's token. That is what lets the workers (which receive a resolved literal from CI)
        // and the service (which receives an unresolved `Fn.importValue` token) agree on ONE name.
        expect(recipeDatabaseNameForStage('pr-73', 'sandbox', 'anything_else')).toBe(
            `${BASE_RECIPE_DATABASE_NAME}_pr_73`,
        );
    });

    it('sanitizes a stage into a legal postgres identifier suffix', () => {
        expect(recipeDatabaseNameForStage('Team-Feature.X', 'sandbox', 'kitchensink_recipes')).toBe(
            'kitchensink_recipes_team_feature_x',
        );
        // Leading/trailing separators are stripped, never left as a double underscore or a trailing one.
        expect(recipeDatabaseNameForStage('--edge--', 'sandbox', 'kitchensink_recipes')).toBe(
            'kitchensink_recipes_edge',
        );
    });

    it('always produces a name the migration runner will accept', () => {
        // The runner quotes the name straight into `CREATE DATABASE "<name>"` after checking this pattern,
        // so a name outside it is not merely rejected — it is the one thing that must be impossible here.
        const pattern = /^kitchensink_recipes(_[a-z0-9_]+)?$/;

        for (const stage of ['prod', 'pr-1', 'pr-73', 'pr-9999', 'team-feature-x', 'A.B-c']) {
            const baseStage = stage === 'prod' ? 'prod' : 'sandbox';

            expect(recipeDatabaseNameForStage(stage, baseStage, BASE_RECIPE_DATABASE_NAME)).toMatch(pattern);
        }
    });

    it('throws rather than emitting a bare base name when a stage sanitizes to nothing', () => {
        // Returning `kitchensink_recipes` here would silently point an ephemeral deploy at the SHARED
        // database — exactly the #119 blast radius (destructive sweepers on the wrong data).
        expect(() => recipeDatabaseNameForStage('---', 'sandbox', 'kitchensink_recipes')).toThrow(/empty suffix/);
    });

    it('pins the base database name', () => {
        expect(BASE_RECIPE_DATABASE_NAME).toBe('kitchensink_recipes');
    });
});
