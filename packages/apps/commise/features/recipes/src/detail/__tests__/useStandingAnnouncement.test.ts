/**
 * `useStandingAnnouncement` (KTD-6): the reason a private recipe stays private is said once, in the render where it goes
 * from NOTHING to a reason, and only after the page knew who was looking.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PublicRefusal } from '../../actions/publicRefusal.js';
import { recipeActionMessages } from '../../actions/messages.js';
import { useStandingAnnouncement } from '../useStandingAnnouncement.js';

const lines = recipeActionMessages.en.publicRefusal;

interface Props {
    readonly ready: boolean;
    readonly reason: PublicRefusal;
    readonly shown?: boolean;
}

function setup(initial: Props) {
    return renderHook(
        (props: Props) => useStandingAnnouncement(props.ready, props.shown ?? true, props.reason, lines),
        {
            initialProps: initial,
        },
    );
}

describe('useStandingAnnouncement', () => {
    it('says the line when the reason goes from nothing to a reason', () => {
        const { result, rerender } = setup({ ready: true, reason: 'none' });

        expect(result.current).toBeUndefined();

        rerender({ ready: true, reason: 'policy.book' });

        expect(result.current).toBe(lines.policyBook);
    });

    it('says nothing for a page that opens with the reason', () => {
        expect(setup({ ready: true, reason: 'policy.book' }).result.current).toBeUndefined();
    });

    it('says nothing until the page is ready, then nothing for a reason that was already there', () => {
        const { result, rerender } = setup({ ready: false, reason: 'none' });

        rerender({ ready: false, reason: 'policy.book' });
        expect(result.current).toBeUndefined();

        rerender({ ready: true, reason: 'policy.book' });
        expect(result.current).toBeUndefined();
    });

    it('says nothing while the reason is not shown, however the reason changes', () => {
        const { result, rerender } = setup({ ready: true, reason: 'none', shown: false });

        rerender({ ready: true, reason: 'policy.book', shown: false });
        expect(result.current).toBeUndefined();
    });

    it('clears when the reason changes to another reason, and is not said again', () => {
        const { result, rerender } = setup({ ready: true, reason: 'none' });

        rerender({ ready: true, reason: 'policy.book' });
        rerender({ ready: true, reason: 'fromPerson' });

        expect(result.current).toBeUndefined();
    });
});
