/**
 * The timer dock on the native cooking screen: the offer under a step that has a length, the row it starts, and where
 * the screen-reader cursor goes after Start, Cancel, Undo and Stop. Real store, real snackbar, real copy; only the
 * screen-reader focus event is doubled, because react-native-web does not implement it.
 * Mutation lens: a Start that leaves the cursor where it was, a Cancel that sends it to Undo, or a ring that leaves it
 * off Stop each fail a row here.
 */
import { stepDigestsOf } from '@kitchensink/cooking-core';
import { render } from '@commise/ui/testing/tamagui';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessibilityInfo } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookingRecipe } from '../__fixtures__/makeCookingRecipe.js';
import { DockHeightContext } from '../dockHeightContext.js';
import { makeCookingWrapper } from '../__fixtures__/makeCookingWrapper.native.js';
import { CookingScreen } from '../CookingScreen.native.js';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

const MINUTE = 60_000;
const STEPS = [
    { stepNumber: 1, instruction: 'Chop the onion.' },
    { stepNumber: 2, instruction: 'Roast for 20 min.', timerSeconds: 1200 },
    { stepNumber: 3, instruction: 'Serve.' },
];
const user = userEvent.setup({ delay: null });

function setup(reportFoot: (height: number) => void = vi.fn()) {
    const { Wrapper, store } = makeCookingWrapper();
    const read = {
        kind: 'ready' as const,
        recipe: makeCookingRecipe({ id: 'r1', status: RecipeStatus.PUBLISHED, steps: STEPS }),
        viewerIsOwner: true,
    };

    render(
        <DockHeightContext value={reportFoot}>
            <CookingScreen read={read} recipeId="r1" onLeave={vi.fn()} onEdit={vi.fn()} onHome={vi.fn()} />
        </DockHeightContext>,
        { wrapper: Wrapper },
    );

    return { store };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const undo = () => screen.findByRole('button', { name: 'Undo' });
const press = (name: string | RegExp) => user.click(button(name));

/** A layout handler, as react-native-web keeps it on a View's node. */
const isLayoutHandler = (value: unknown): value is (event: unknown) => void => typeof value === 'function';

/** Fires the foot's layout the way the native host does: react-native-web keeps the handler on the foot's View. */
function layOutFoot(height: number): void {
    const foot = screen.getByTestId('cooking-foot').parentElement;

    const handler: unknown = foot === null ? undefined : Reflect.get(foot, '__reactLayoutHandler');

    if (!isLayoutHandler(handler)) {
        throw new Error('The foot carries no layout handler.');
    }

    act(() => {
        handler({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
    });
}

const cursor = () => vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.at(-1)?.[0];

beforeEach(() => {
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

afterEach(() => {
    cleanup();
});

describe('CookingScreen (native): the timer dock', () => {
    it('offers no timer on a step with no length', () => {
        setup();

        expect(screen.queryByRole('button', { name: /^Time / })).toBeNull();
    });

    it('starts the offered timer and moves the cursor to its Pause control', async () => {
        setup();
        await press(/^Next step, step 2/u);
        await press('Time 20 min');

        expect(cursor()).toBe(button(/^Pause /));
        expect(screen.queryByRole('button', { name: /^Time / })).toBeNull();
    });

    it('Cancel returns the offer and moves the cursor to it, never to Undo', async () => {
        setup();
        await press(/^Next step, step 2/u);
        await press('Time 20 min');
        await press(/^Cancel /);

        expect(cursor()).toBe(button('Time 20 min'));
        expect(cursor()).not.toBe(await undo());
    });

    it('Undo brings the timer back and moves the cursor to its Pause control', async () => {
        setup();
        await press(/^Next step, step 2/u);
        await press('Time 20 min');
        await press(/^Cancel /);
        await user.click(await undo());

        expect(cursor()).toBe(button(/^Pause /));
    });

    it('keeps the foot reported, and not reported as 0, after the only timer is cancelled and Undo shows', async () => {
        const report = vi.fn();
        setup(report);
        await press(/^Next step, step 2/u);
        await press('Time 20 min');
        layOutFoot(150);
        await press(/^Cancel /);
        await undo();
        layOutFoot(96);

        expect(report.mock.calls).toEqual([[150], [96]]);
    });

    it('a ring shows Done with Stop, and Stop takes the row away', () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        const { store } = setup();
        const disconnect = store.connect();

        act(() => {
            store.start({
                recipeId: 'r1',
                stepIndex: 1,
                stepDigest: stepDigestsOf(STEPS)[1] ?? '',
                label: undefined,
                origin: { kind: 'added' },
                durationMs: MINUTE,
            });
        });
        act(() => {
            vi.advanceTimersByTime(2 * MINUTE);
        });

        expect(screen.getByText('Done')).toBeTruthy();

        fireEvent.click(button(/^Stop /));

        expect(store.getSnapshot().timers).toEqual([]);
        disconnect();
        vi.useRealTimers();
    });
});

describe('CookingScreen (native): the cursor on Done', () => {
    const toDone = async () => {
        await press(/^Next step, step 2/u);
        await press('Time 20 min');
        await press(/^Next step, step 3/u);
        await press(/^Finish/u);
    };

    // The title remounts, so each move goes to a new node: count the moves, then read where the last one went.
    const moves = () => vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.length;

    const titleIsLast = () => {
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(
            screen.getByRole('heading', { name: /steps? done/iu }),
            'focus',
        );
    };

    it('moves the cursor to the title again when Cancel takes the last row away on Done', async () => {
        setup();
        await toDone();
        const opened = moves();

        await press(/^Cancel /);

        expect(moves()).toBe(opened + 1);
        titleIsLast();
    });

    it('moves the cursor to the title when Stop takes the ringing row away on Done', async () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        const { store } = setup();
        const disconnect = store.connect();
        const click = (name: RegExp) => fireEvent.click(button(name));

        click(/^Next step, step 2/u);
        click(/^Time 20 min/u);
        click(/^Next step, step 3/u);
        click(/^Finish/u);
        act(() => {
            vi.advanceTimersByTime(21 * MINUTE);
        });
        const opened = moves();

        click(/^Stop /);

        expect(moves()).toBe(opened + 1);
        titleIsLast();
        disconnect();
        vi.useRealTimers();
    });
});
