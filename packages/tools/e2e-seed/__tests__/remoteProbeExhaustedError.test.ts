/**
 * The error that fails PROVISION when no probe word answers right (owner ruling 2026-10-18). Its message is the only
 * thing an operator reads, so it must name the role, every rejected word with its reason, and the stage.
 */
import { describe, expect, it } from 'vitest';

import { RemoteProbeExhaustedError, isRemoteProbeExhaustedError } from '../src/remoteProbeExhaustedError.js';

const rejections = [
    { word: 'paneer', reason: 'too-few-usda-items' },
    { word: 'tahini', reason: 'first-item-lacks-word' },
] as const;

describe('RemoteProbeExhaustedError', () => {
    it('names the role, each rejected word with its reason, and the stage', () => {
        const message = new RemoteProbeExhaustedError('change', rejections, 'https://recipe-pr-91.commise.app').message;

        expect(message).toContain('"change"');
        expect(message).toContain('paneer (too-few-usda-items)');
        expect(message).toContain('tahini (first-item-lacks-word)');
        expect(message).toContain('https://recipe-pr-91.commise.app');
    });

    it('says the budget ran out, not that the candidates did, when that is what happened', () => {
        const message = new RemoteProbeExhaustedError('append', [], 'pr-91', 'search-budget').message;

        expect(message).toContain('search budget');
        expect(message).toContain('no word was judged');
    });

    it('is recognised by its guard, including after the prototype chain is rebuilt, and nothing else is', () => {
        const error = new RemoteProbeExhaustedError('append', rejections, 'pr-91');

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('RemoteProbeExhaustedError');
        expect(isRemoteProbeExhaustedError(error)).toBe(true);
        expect(isRemoteProbeExhaustedError(new Error('x'))).toBe(false);
        expect(isRemoteProbeExhaustedError(undefined)).toBe(false);
    });
});
