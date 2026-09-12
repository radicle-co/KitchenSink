/**
 * VariantDetailsDialog (native) — every state of the details dialog, rendered through react-native-web (curated U14;
 * `docs/design/ingredientSpecialization.md` §S8, §S10, §S12 rows 17 to 29).
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BEEF_BRISKET, BONELESS_SKINLESS_CHICKEN_THIGHS } from '../__fixtures__/seedVariants.js';
import { editEntry, loadedRead, makeDetailsModel } from '../__fixtures__/detailsModel.js';
import type { DetailsDialogEntry } from '../detailsDialogMachine.js';
import type { VariantDetailsDialogModel } from '../useVariantDetailsDialog.js';
import { VariantDetailsDialog } from '../VariantDetailsDialog.native.js';

/** The platform and the text size a case stands in for: react-native-web is always `'web'` at font scale 1. */
const device = vi.hoisted(() => ({ os: 'web' as 'web' | 'ios' | 'android', fontScale: 1 }));

// react-native-web implements neither `sendAccessibilityEvent` (the error case reads the calls) nor iOS's announce.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return device.os;
            },
        },
        AccessibilityInfo: {
            ...actual.AccessibilityInfo,
            sendAccessibilityEvent: vi.fn(),
            announceForAccessibilityWithOptions: vi.fn(),
        },
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), fontScale: device.fontScale }),
    };
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    device.os = 'web';
    device.fontScale = 1;
});

const ADD: DetailsDialogEntry = { mode: 'add' };
const THIGH = BONELESS_SKINLESS_CHICKEN_THIGHS[0]!;
const RETIRED = { id: 'V-retired', parts: [{ attribute: 'cut', text: 'gone cut' }] };

/** Render the dialog open over `details`. */
function renderDialog(details: VariantDetailsDialogModel, foodName = 'beef brisket') {
    return render(<VariantDetailsDialog open foodName={foodName} details={details} />);
}

describe('the frame', () => {
    it('is titled by the mode, and shows the food name capitalised', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: ADD }));

        expect(screen.getByRole('heading', { name: 'Add details' })).toBeTruthy();
        expect(screen.getByText('Beef brisket')).toBeTruthy();
    });

    it('Close reports a dismissal', () => {
        const details = makeDetailsModel({ read: { kind: 'loading' }, entry: ADD });

        renderDialog(details);
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }));

        expect(details.onClose).toHaveBeenCalledTimes(1);
    });

    it('renders nothing while closed, and the same dialog opened shows its heading', () => {
        const details = makeDetailsModel({ read: { kind: 'loading' }, entry: ADD });
        const { rerender } = render(<VariantDetailsDialog open={false} foodName="beef brisket" details={details} />);

        expect(screen.queryByRole('heading', { name: 'Add details' })).toBeNull();

        rerender(<VariantDetailsDialog open foodName="beef brisket" details={details} />);

        expect(screen.getByRole('heading', { name: 'Add details' })).toBeTruthy();
    });
});

describe('read states', () => {
    it('loading: the status text, and no search', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: ADD }));

        // Shown, and spoken through the one polite region that is mounted before it speaks.
        const copies = screen.getAllByText('Loading details…');

        expect(copies).toHaveLength(2);
        expect(copies.filter((node) => node.closest('[aria-live="polite"]') !== null)).toHaveLength(1);
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('error: an alert and Try again; entering it moves the reading cursor to the alert', () => {
        const loading = makeDetailsModel({ read: { kind: 'loading' }, entry: ADD });
        const failed = makeDetailsModel({ read: { kind: 'failed' }, entry: ADD });
        const { rerender } = renderDialog(loading);

        // The Sheet moves the cursor to its own title when it shows; only the move entering `error` is under test.
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
        rerender(<VariantDetailsDialog open foodName="beef brisket" details={failed} />);

        const alert = screen.getByRole('alert');

        expect(alert.textContent).toBe('We couldn’t load the details. Your ingredient hasn’t changed.');
        expect(vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls).toEqual([[alert, 'focus']]);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(failed.onRetry).toHaveBeenCalledTimes(1);
    });

    it('offline: the shared offline slot, with no retry', () => {
        renderDialog(makeDetailsModel({ read: { kind: 'parked' }, entry: ADD }));

        expect(screen.getByText('Waiting for a connection. This loads on its own.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('noVariants: says so with the food name, with no removal', () => {
        renderDialog(makeDetailsModel({ read: loadedRead([]), entry: ADD }), 'ground lamb');

        expect(
            screen.getByText('There are no details to pick for ground lamb right now. Your ingredient hasn’t changed.'),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Remove details' })).toBeNull();
    });
});

describe('the short list', () => {
    it('add: every row as a button named by its parts and calories, none selected, no footer', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD }));

        const row = screen.getByRole('button', { name: 'with added solution, 110 cal' });

        expect(row).toBeTruthy();
        expect(screen.getByText('110 cal')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /, Current, /u })).toBeNull();
        expect(row.getAttribute('aria-selected')).not.toBe('true');
        expect(screen.queryByRole('button', { name: 'Remove details' })).toBeNull();
    });

    it('a tap commits the row', () => {
        const details = makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: ADD });

        renderDialog(details);
        fireEvent.click(screen.getByRole('button', { name: 'braised, 176 cal' }));

        expect(details.onPick).toHaveBeenCalledWith(expect.objectContaining({ shownParts: ['braised'] }));
    });

    it('edit: the current line, the Current row selected, and Remove details', () => {
        const details = makeDetailsModel({
            read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS),
            entry: editEntry(THIGH),
        });

        renderDialog(details);
        const current = screen.getByRole('button', { name: /, Current, /u });

        expect(current.getAttribute('aria-selected')).toBe('true');
        expect(within(current).getByText('Current')).toBeTruthy();
        expect(screen.getByLabelText(/^Current: /u)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Remove details' }));
        expect(details.onRemove).toHaveBeenCalledTimes(1);
    });

    it('edit, current variant retired: the cost of a change, and no row marked', () => {
        renderDialog(
            makeDetailsModel({ read: loadedRead(BONELESS_SKINLESS_CHICKEN_THIGHS), entry: editEntry(RETIRED) }),
        );

        expect(
            screen.getByLabelText(
                'Current: gone cut. It’s no longer listed, so if you change it, you can’t pick it again.',
            ),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: /, Current, /u })).toBeNull();
    });

    it('a row with no calorie figure says so, and never 0', () => {
        renderDialog(
            makeDetailsModel({
                read: loadedRead([{ id: 'V1', parts: [{ attribute: 'grade', text: 'select' }] }]),
                entry: ADD,
            }),
        );

        expect(screen.getByText('no figure')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'select, no calorie figure' })).toBeTruthy();
    });
});

describe('the long list', () => {
    it('a labelled search, and groups under header-role titles', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD }));

        expect(screen.getByLabelText('Search 40 options')).toBeTruthy();
        expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
            'Add details',
            'Flat half',
            'Navel end',
            'Point end',
            'Point half',
            'Whole',
        ]);
    });

    it('a grouped row shows its parts without the group part, and its name ends with it', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD }));

        expect(screen.getByRole('button', { name: 'lean only, 0-inch trim, select, 124 cal, flat half' })).toBeTruthy();
    });

    it('typing reports the query, and the settled count is spoken', () => {
        const details = makeDetailsModel(
            { read: loadedRead(BEEF_BRISKET), entry: ADD, query: 'navel' },
            { announcedCount: { kind: 'matches', shown: 4, total: 40 } },
        );

        renderDialog(details);
        fireEvent.change(screen.getByLabelText('Search 40 options'), { target: { value: 'navel e' } });

        expect(details.onQueryChange).toHaveBeenCalledWith('navel e');
        expect(screen.getByText('4 of 40 options')).toBeTruthy();
        expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
            'Add details',
            'Navel end',
        ]);
    });

    it('noMatches: says so, and Clear search is the way out', () => {
        const details = makeDetailsModel(
            { read: loadedRead(BEEF_BRISKET), entry: ADD, query: 'zzz' },
            { announcedCount: { kind: 'noMatches', query: 'zzz', total: 40 } },
        );

        renderDialog(details);

        const copies = screen.getAllByText('Nothing matches “zzz”. Clear the search to see all 40.');

        expect(copies.filter((node) => node.closest('[aria-live="polite"]') !== null)).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(details.onClearQuery).toHaveBeenCalledTimes(1);
    });

    // Shown at once, said once typing stops (§S8.5, `docs/design/readSurfacesEvaluation.md` D4).
    it('noMatches, still typing: shows the text, and the polite region says nothing yet', () => {
        renderDialog(makeDetailsModel({ read: loadedRead(BEEF_BRISKET), entry: ADD, query: 'zzz' }));

        const copies = screen.getAllByText('Nothing matches “zzz”. Clear the search to see all 40.');

        expect(copies).toHaveLength(1);
        expect(copies[0]?.closest('[aria-live="polite"]')).toBeNull();
    });
});

/**
 * §S12 row 17: the loading text is said once (`docs/design/readSurfacesEvaluation.md` D5). The polite region holds it
 * for speech, and `LiveRegion` exposes that node to TalkBack on Android and hides it from VoiceOver on iOS, so the
 * visible line is the one a screen reader reaches on iOS and is hidden on Android.
 */
describe('loading: the text reaches a screen reader once', () => {
    /** The nodes holding `text` that a screen reader can reach. */
    const exposed = (text: string): HTMLElement[] =>
        screen.getAllByText(text).filter((node) => node.closest('[aria-hidden="true"]') === null);

    it('Android: through the live region only', () => {
        device.os = 'android';
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: ADD }));

        const reached = exposed('Loading details…');

        expect(reached).toHaveLength(1);
        expect(reached[0]?.closest('[aria-live="polite"]')).not.toBeNull();
    });

    it('iOS: through the visible line only', () => {
        device.os = 'ios';
        renderDialog(makeDetailsModel({ read: { kind: 'loading' }, entry: ADD }));

        const reached = exposed('Loading details…');

        expect(reached).toHaveLength(1);
        expect(reached[0]?.closest('[aria-live]')).toBeNull();
    });
});

/**
 * §S8.2 "Row": the parts' basis is 12rem, so it follows text size with no breakpoint. React Native has no rem, so the
 * basis is 12 body sizes times the font scale (`docs/design/readSurfacesEvaluation.md` D7).
 */
describe('a row’s parts basis follows the text size', () => {
    const FRIED = { id: 'V-fried', parts: [{ attribute: 'cookingMethod', text: 'fried' }], caloriesPer100g: 187 };

    /** The flex basis of the parts column in the row named `name`. */
    const partsBasis = (name: string): string => {
        // The dotted line is one `Text`; the parts column holds it.
        const parts = within(screen.getByRole('button', { name })).getByText('fried').parentElement;

        return parts === null || parts === undefined ? '' : window.getComputedStyle(parts).flexBasis;
    };

    it('is 12 body sizes at the default text size', () => {
        renderDialog(makeDetailsModel({ read: loadedRead([FRIED]), entry: ADD }));

        expect(partsBasis('fried, 187 cal')).toBe('192px');
    });

    it('grows with the font scale', () => {
        device.fontScale = 2;
        renderDialog(makeDetailsModel({ read: loadedRead([FRIED]), entry: ADD }));

        expect(partsBasis('fried, 187 cal')).toBe('384px');
    });
});

describe('detailsNoneLeft', () => {
    it('shows the current line and the consequence, with Close then Remove details', () => {
        const details = makeDetailsModel({ read: loadedRead([]), entry: editEntry(RETIRED) });

        renderDialog(details);

        expect(screen.getByText(/There are no other details for beef brisket now\./u)).toBeTruthy();
        const close = screen.getByRole('button', { name: 'Close' });
        const remove = screen.getByRole('button', { name: 'Remove details' });

        expect(close.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(close);
        expect(details.onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(remove);
        expect(details.onRemove).toHaveBeenCalledTimes(1);
    });
});

describe('the host’s moment to move on', () => {
    it('reports onDismissed once the dialog is gone after a close, and never while it is open', () => {
        const details = makeDetailsModel({ read: { kind: 'loading' }, entry: ADD });
        const onDismissed = vi.fn();
        const { rerender } = render(
            <VariantDetailsDialog open foodName="beef brisket" details={details} onDismissed={onDismissed} />,
        );

        expect(onDismissed).not.toHaveBeenCalled();
        rerender(
            <VariantDetailsDialog open={false} foodName="beef brisket" details={details} onDismissed={onDismissed} />,
        );

        expect(onDismissed).toHaveBeenCalledTimes(1);
    });
});
