/**
 * The row's one rule, tested once for both platforms. Mutation lens: a wrong glyph, order or callback, or a Cancel on a
 * done row, each fails a row here.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TimerRowAction } from '../props.js';
import { timerRowActions } from '../timerRowActions.js';

const action = (label: string): TimerRowAction => ({ label, onPress: vi.fn<() => void>() });

describe('timerRowActions', () => {
    it('running: Pause then Cancel', () => {
        const pause = action('Pause');
        const cancel = action('Cancel');

        expect(timerRowActions({ kind: 'running', pause, cancel })).toStrictEqual([
            { slot: 'primary', icon: 'pause', action: pause },
            { slot: 'secondary', icon: 'x', action: cancel },
        ]);
    });

    it('paused: Resume then Cancel', () => {
        const resume = action('Resume');
        const cancel = action('Cancel');

        expect(timerRowActions({ kind: 'paused', resume, cancel })).toStrictEqual([
            { slot: 'primary', icon: 'play', action: resume },
            { slot: 'secondary', icon: 'x', action: cancel },
        ]);
    });

    it('keeps one slot for Pause and Resume, so the button is the same one', () => {
        const slotOf = (state: Parameters<typeof timerRowActions>[0]): string | undefined =>
            timerRowActions(state)[0]?.slot;
        const a = action('a');

        expect(slotOf({ kind: 'running', pause: a, cancel: a })).toBe('primary');
        expect(slotOf({ kind: 'paused', resume: a, cancel: a })).toBe('primary');
    });

    it('done: Stop alone', () => {
        const stop = action('Stop');

        expect(timerRowActions({ kind: 'done', stop })).toStrictEqual([{ slot: 'primary', icon: 'x', action: stop }]);
    });
});
