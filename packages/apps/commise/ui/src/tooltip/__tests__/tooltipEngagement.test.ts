import { describe, expect, it } from 'vitest';

import { IDLE, isOpen, reduceEngagement, type Engagement, type EngagementEvent } from '../tooltipEngagement.js';

/** Fold a list of events from rest. */
const run = (...events: readonly EngagementEvent[]): Engagement => events.reduce(reduceEngagement, IDLE);

describe('tooltip engagement', () => {
    it('is closed at rest', () => {
        expect(isOpen(IDLE)).toBe(false);
    });

    it.each([['hoverStart'], ['focusStart']] as const)('opens on %s and closes when it ends', (start) => {
        const end = start === 'hoverStart' ? 'hoverEnd' : 'focusEnd';

        expect(isOpen(run(start))).toBe(true);
        expect(isOpen(run(start, end))).toBe(false);
    });

    it('stays open while either of hover and focus remains', () => {
        expect(isOpen(run('hoverStart', 'focusStart', 'hoverEnd'))).toBe(true);
        expect(isOpen(run('hoverStart', 'focusStart', 'focusEnd'))).toBe(true);
        expect(isOpen(run('hoverStart', 'focusStart', 'hoverEnd', 'focusEnd'))).toBe(false);
    });

    it('is dismissed by Escape and stays dismissed while the engagement that was dismissed goes on', () => {
        expect(isOpen(run('hoverStart', 'escape'))).toBe(false);
        // A repeated hover event is not a new engagement.
        expect(isOpen(run('hoverStart', 'escape', 'hoverStart'))).toBe(false);
    });

    it('stays dismissed while the OTHER of hover and focus is still engaged', () => {
        expect(isOpen(run('focusStart', 'hoverStart', 'escape', 'hoverEnd'))).toBe(false);
        expect(isOpen(run('focusStart', 'hoverStart', 'escape', 'focusEnd'))).toBe(false);
    });

    it('re-arms once neither hover nor focus remains', () => {
        expect(isOpen(run('hoverStart', 'escape', 'hoverEnd', 'hoverStart'))).toBe(true);
        expect(isOpen(run('focusStart', 'hoverStart', 'escape', 'hoverEnd', 'focusEnd', 'focusStart'))).toBe(true);
    });

    it('ignores Escape when nothing is showing, so a stray key does not pre-dismiss the next show', () => {
        expect(isOpen(run('escape', 'hoverStart'))).toBe(true);
    });
});
