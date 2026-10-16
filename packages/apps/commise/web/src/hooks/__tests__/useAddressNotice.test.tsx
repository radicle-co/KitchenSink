/**
 * Unit tests for {@link useAddressNotice}: a notice carried across a navigation in a one-shot query parameter (E8). A
 * snackbar raised before `router.push` dies with the old page, because every route mounts its own `AppShell` and with it
 * the snackbar host; so the page that leaves puts the outcome in the address and the page it lands on says it once.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAddressNotice } from '../useAddressNotice';

const { searchState, pushMock } = vi.hoisted(() => ({ searchState: { value: '' }, pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
    useSearchParams: () => new URLSearchParams(searchState.value),
}));

/** Reads `?seen=` and says "Seen it" for the one value it knows. */
const Probe: FC = () => {
    useAddressNotice('seen', (value) => (value === 'yes' ? 'Seen it' : undefined));

    return null;
};

/** The same, handing the value it consumed to `onSeen` (the recipe page keeps the refusal it carries). */
const SeenProbe: FC<{ readonly onSeen: (value: string) => void }> = ({ onSeen }) => {
    useAddressNotice('seen', (value) => (value === 'yes' ? 'Seen it' : undefined), onSeen);

    return null;
};

/** Arrive at a page with `query` in the address and in what `useSearchParams` reads. */
function arriveWith(query: string): void {
    searchState.value = query;
    window.history.replaceState(null, '', `/en/page${query === '' ? '' : `?${query}`}`);
}

afterEach(() => {
    searchState.value = '';
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
});

describe('useAddressNotice', () => {
    it('says the notice as a status', async () => {
        arriveWith('seen=yes');

        render(
            <SnackbarHost>
                <Probe />
            </SnackbarHost>,
        );

        expect((await screen.findByText('Seen it')).closest('[role="status"]')).not.toBeNull();
    });

    it('takes its parameter off the address without a navigation, keeping any other', async () => {
        const replace = vi.spyOn(window.history, 'replaceState');
        arriveWith('tab=2&seen=yes');

        render(
            <SnackbarHost>
                <Probe />
            </SnackbarHost>,
        );

        await screen.findByText('Seen it');
        expect(window.location.search).toBe('?tab=2');
        expect(replace).toHaveBeenCalledWith(null, '', '/en/page?tab=2');
        expect(pushMock).not.toHaveBeenCalled();
    });

    it('says it once: a re-render with the parameter gone from the address says nothing again', async () => {
        arriveWith('seen=yes');
        const { rerender } = render(
            <SnackbarHost>
                <Probe />
            </SnackbarHost>,
        );
        await screen.findByText('Seen it');

        rerender(
            <SnackbarHost>
                <Probe />
            </SnackbarHost>,
        );

        expect(screen.getAllByText('Seen it')).toHaveLength(1);
    });

    it.each(['', 'seen=', 'seen=no', 'other=yes'])(
        'says nothing for the address “?%s”, and leaves it as it is',
        (query) => {
            arriveWith(query);

            render(
                <SnackbarHost>
                    <Probe />
                </SnackbarHost>,
            );

            expect(screen.queryByText('Seen it')).not.toBeInTheDocument();
            expect(window.location.search).toBe(query === '' ? '' : `?${query}`);
        },
    );
});

describe('useAddressNotice — onSeen', () => {
    it('hands the consumed value to onSeen once, in the effect that takes the parameter off the address', async () => {
        const onSeen = vi.fn();
        arriveWith('seen=yes');
        const { rerender } = render(
            <SnackbarHost>
                <SeenProbe onSeen={onSeen} />
            </SnackbarHost>,
        );
        await screen.findByText('Seen it');

        rerender(
            <SnackbarHost>
                <SeenProbe onSeen={onSeen} />
            </SnackbarHost>,
        );

        expect(onSeen).toHaveBeenCalledTimes(1);
        expect(onSeen).toHaveBeenCalledWith('yes');
    });

    it('does not call onSeen for a value the page does not know, which is left in the address', () => {
        const onSeen = vi.fn();
        arriveWith('seen=no');

        render(
            <SnackbarHost>
                <SeenProbe onSeen={onSeen} />
            </SnackbarHost>,
        );

        expect(onSeen).not.toHaveBeenCalled();
        expect(window.location.search).toBe('?seen=no');
    });
});
