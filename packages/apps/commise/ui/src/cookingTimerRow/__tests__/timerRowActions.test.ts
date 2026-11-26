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
            { icon: 'pause', action: pause },
            { icon: 'x', action: cancel },
        ]);
    });

    it('paused: Resume then Cancel', () => {
        const resume = action('Resume');
        const cancel = action('Cancel');

        expect(timerRowActions({ kind: 'paused', resume, cancel })).toStrictEqual([
            { icon: 'play', action: resume },
            { icon: 'x', action: cancel },
        ]);
    });

    it('done: Stop alone', () => {
        const stop = action('Stop');

        expect(timerRowActions({ kind: 'done', stop })).toStrictEqual([{ icon: 'x', action: stop }]);
    });
});
