/**
 * SyncNoticeStack (web): the column both notices sit in. On web it adds nothing: the notices flow at the top of
 * `<main>`, below the sticky bar, so there is no inset to take (`offlineNotice.md` §7).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SyncNoticeStack } from '../SyncNoticeStack.js';

afterEach(cleanup);

describe('SyncNoticeStack (web)', () => {
    it.each([true, false])('renders its children in order and adds no wrapper, active=%s', (active) => {
        const { container } = render(
            <SyncNoticeStack active={active}>
                <p>first</p>
                <p>second</p>
            </SyncNoticeStack>,
        );

        expect(container.children).toHaveLength(2);
        expect(screen.getByText('first').nextElementSibling).toBe(screen.getByText('second'));
    });
});
