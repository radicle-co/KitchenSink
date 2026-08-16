/**
 * The substrate's naming + ownership rules (plan U5/U6).
 *
 * Both rules here are the kind that fail LOUDLY in the wrong direction and SILENTLY in the right-looking
 * one: a name outside the teardown's delimiter boundary leaks a table per closed pull request, and an
 * ownership rule that lets two producers each create "the" table either collides on the name or splits one
 * group across two tables — where a consumer would simply never see half its messages.
 */
import { describe, it, expect } from 'vitest';

import {
    messageTableArnParameter,
    messageTableNameForStage,
    messageTableNameParameter,
    messageTableStageFor,
} from '../messageTableName.js';

describe('messageTableNameForStage', () => {
    it('names one table per stage', () => {
        expect(messageTableNameForStage('prod')).toBe('kitchensink-messages-prod');
        expect(messageTableNameForStage('pr-7')).toBe('kitchensink-messages-pr-7');
    });

    it('⛔ keeps pr-1 and pr-15 distinct under pr-scope`s DELIMITER rule', () => {
        // ADR-0005: the teardown has no denylist, so the token must appear as a complete trailing segment.
        expect(messageTableNameForStage('pr-1').endsWith('-pr-1')).toBe(true);
        expect(messageTableNameForStage('pr-15').endsWith('-pr-1')).toBe(false);
        expect(messageTableNameForStage('pr-15').includes('-pr-1-')).toBe(false);
    });

    it('never makes a base stage look per-PR to a teardown sweep', () => {
        expect(messageTableNameForStage('prod')).not.toMatch(/pr-\d/);
        expect(messageTableNameForStage('sandbox')).not.toMatch(/pr-\d/);
    });
});

describe('the SSM paths', () => {
    it('are stage-scoped, so a preview never reads the base stage`s table by accident', () => {
        expect(messageTableNameParameter('pr-7')).toBe('/kitchensink/pr-7/messaging/table-name');
        expect(messageTableArnParameter('prod')).toBe('/kitchensink/prod/messaging/table-arn');
    });
});

describe('messageTableStageFor — ONE table per stage, not one per producer', () => {
    it('points a base stage at itself, where MessageSubstrateStack owns the table', () => {
        expect(messageTableStageFor('prod', 'prod')).toBe('prod');
        expect(messageTableStageFor('sandbox', 'sandbox')).toBe('sandbox');
    });

    it('points every per-PR producer at the PREVIEW`s own stage, not the base stage', () => {
        // Both producers in a preview must land in the SAME table: a consumer queries a group, and a group
        // split across two tables is a consumer that silently sees half its messages.
        expect(messageTableStageFor('pr-7', 'sandbox')).toBe('pr-7');
    });

    it('gives both producers of one preview the identical answer', () => {
        // This is the property that makes "food owns it, recipe reads it" safe: neither stack can derive a
        // different table from the same inputs.
        expect(messageTableStageFor('pr-7', 'sandbox')).toBe(messageTableStageFor('pr-7', 'sandbox'));
        expect(messageTableNameForStage(messageTableStageFor('pr-7', 'sandbox'))).toBe('kitchensink-messages-pr-7');
    });
});
