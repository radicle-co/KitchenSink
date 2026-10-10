/**
 * The remote search service's stages: `prod` and a copy per pull request (`pr-{N}`), the stages food-service runs
 * at and reads it from. Every other stage is refused at the app's boundary.
 */
import { describe, expect, it } from 'vitest';

import { baseStageOf, isPreviewStage, parseRemoteSearchStage } from '../lib/remoteSearchStage.js';

describe('parseRemoteSearchStage', () => {
    it.each(['prod', 'pr-1', 'pr-91', 'pr-1234'] as const)('accepts %s', (stage) => {
        expect(parseRemoteSearchStage(stage)).toBe(stage);
    });

    it.each([
        ['the shared sandbox tier, which food never runs at', 'sandbox'],
        ['a preview with no number', 'pr-'],
        ['a preview numbered zero', 'pr-0'],
        ['a preview with a leading zero', 'pr-091'],
        ['a preview with a name for a number', 'pr-abc'],
        ['a preview with a suffix', 'pr-91-x'],
        ['the local sandbox', 'local'],
        ['the default developer stage', 'dev'],
        ['a different case', 'Prod'],
        ['a padded value', ' prod'],
        ['an empty value', ''],
        ['an absent value', undefined],
        ['a non-string value', 7],
    ])('refuses %s', (_label, raw) => {
        expect(() => parseRemoteSearchStage(raw)).toThrow(/prod.*pr-\{N\}/u);
    });
});

describe('isPreviewStage', () => {
    it.each([
        ['pr-91', true],
        ['prod', false],
        ['sandbox', false],
        ['pr-0', false],
    ] as const)('reads %s as %s', (value, expected) => {
        expect(isPreviewStage(value)).toBe(expected);
    });
});

describe('baseStageOf', () => {
    it.each([
        ['prod', 'prod'],
        ['pr-91', 'sandbox'],
    ] as const)('rides %s on %s', (stage, base) => {
        expect(baseStageOf(stage)).toBe(base);
    });
});
