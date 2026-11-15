/**
 * The native cooking screen: the orchestration over the real cooking-core reducers
 * (through `useCookingSession`), the real copy (`cookingMessages` through `cookingCopy`) and the real loading clock.
 * Only three seams are wrapped, each over its real implementation (spy the seam, never replace the module): the
 * keep-awake hooks, the window width (the under-360 rule), and the screen-reader focus event, which react-native-web
 * does not implement.
 *
 * It mirrors the web screen's suite case for case, minus the web's arrow keys, plus native's own rules: the under-360
 * layout read once from the window, the body that scrolls between a pinned top bar and nav
 * at the largest text, screen-reader focus on Done's title, and the rule that the focus-line face and the large-title
 * face never share a screen.
 */
import { nativeTokens } from '@commise/ui/native';
import { render } from '@commise/ui/testing/tamagui';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookingScreen } from '../CookingScreen.native.js';
import type { CookingScreenProps, CookingScreenRead } from '../cookingViewProps.js';
import { FOCUS_LINE_TYPE } from '../focusLineType.js';
import { pillOf } from './utils/buttonPill.js';

const keepAwake = vi.hoisted(() => ({ available: false, calls: [] as boolean[] }));
const viewport = vi.hoisted(() => ({ width: 390, height: 844, fontScale: 1 }));

vi.mock('@commise/ui/keep-awake', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/ui/keep-awake')>();

    return {
        ...actual,
        useKeepAwake: (on: boolean) => {
            keepAwake.calls.push(on);
            actual.useKeepAwake(on);
        },
        useKeepAwakeAvailable: () => keepAwake.available,
    };
});

// The window width the screen reads for the under-360 rule; react-native-web does not implement the focus event.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({
            ...actual.useWindowDimensions(),
            width: viewport.width,
            height: viewport.height,
            fontScale: viewport.fontScale,
        }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

const TITLE = 'Weeknight roast';

/** Six steps with text and one blank one: a blank step is not a step for the cook, so it is not counted. */
const STEPS = [
    { stepNumber: 1, instruction: 'Heat 1.5 tbsp. oil. Add the onion and cook 5 min.' },
    { stepNumber: 2, instruction: 'Add 2 tbsp. butter. Stir well. Season.' },
    { stepNumber: 3, instruction: '   ' },
    { stepNumber: 4, instruction: 'Roast for 40 min.' },
    { stepNumber: 5, instruction: 'Rest the meat.' },
    { stepNumber: 6, instruction: 'Carve.' },
    { stepNumber: 7, instruction: 'Serve.' },
];

const ready = (over: Partial<Extract<CookingScreenRead, { kind: 'ready' }>> = {}): CookingScreenRead => ({
    kind: 'ready',
    recipe: { id: 'r1', title: TITLE, status: RecipeStatus.PUBLISHED, steps: STEPS },
    viewerIsOwner: true,
    ...over,
});

function setup(read: CookingScreenRead = ready()) {
    const props: CookingScreenProps = { read, onLeave: vi.fn(), onEdit: vi.fn(), onHome: vi.fn() };
    const view = render(<CookingScreen {...props} />);

    return { ...props, ...view };
}

const nav = () => within(screen.getByRole('navigation'));
const forward = () => nav().getAllByRole('button')[1] as HTMLElement;
const back = () => nav().getAllByRole('button')[0] as HTMLElement;
const fill = (button: HTMLElement) => getComputedStyle(pillOf(button)).backgroundColor;
// The filled tier paints a different surface from the quiet pair; Back is always quiet, so it is the reference.
const isFilled = (button: HTMLElement) => fill(button) !== fill(back());
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const tick = (text: string) => fireEvent.click(screen.getByRole('checkbox', { name: text }));
const isDisabled = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true';

/** Every element whose computed face and size are a type role's. */
function inFace(root: HTMLElement, face: { readonly fontFamily: string; readonly fontSize: number }): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
        const style = getComputedStyle(el);

        return style.fontFamily === face.fontFamily && style.fontSize === `${String(face.fontSize)}px`;
    });
}

interface Face {
    readonly fontFamily: string;
    readonly fontSize: number;
}

/** A role's face, read at the regular class when the role has one style per container class. */
const faceOf = (style: Face | { readonly regular: Face }): Face => ('regular' in style ? style.regular : style);

const LARGE_TITLE = faceOf(nativeTokens.type.largeTitle);
const FOCUS_LINE = faceOf(nativeTokens.type[FOCUS_LINE_TYPE.nativeTypeRole]);

beforeEach(() => {
    keepAwake.available = false;
    keepAwake.calls = [];
    viewport.width = 390;
    viewport.height = 844;
    viewport.fontScale = 1;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('CookingScreen (native): loading', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('shows no skeleton before 300 ms, then the skeleton, then the label after 1 s', () => {
        setup({ kind: 'pending', retry: vi.fn() });

        expect(screen.queryByTestId('cooking-loading-skeleton')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(screen.getByTestId('cooking-loading-skeleton')).toBeTruthy();
        expect(screen.queryByText('Opening the recipe…')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(700);
        });
        expect(screen.getByText('Opening the recipe…')).toBeTruthy();
    });

    it('is busy, with the place muted, Back and Next drawn disabled, and Exit live', () => {
        const { onLeave } = setup({ kind: 'pending', retry: vi.fn() });

        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Step –')).toBeTruthy();
        expect(isDisabled(back())).toBe(true);
        expect(isDisabled(forward())).toBe(true);

        press('Exit cooking mode');
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('offers Try again after 10 s, and it reads again', () => {
        const retry = vi.fn();
        setup({ kind: 'pending', retry });

        act(() => {
            vi.advanceTimersByTime(10_000);
        });
        press('Try again');

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t open this recipe');
        expect(retry).toHaveBeenCalledTimes(1);
    });
});

describe('CookingScreen (native): load error', () => {
    it('alerts with the online body, Try again and a way back', () => {
        const retry = vi.fn();
        const { onLeave } = setup({ kind: 'failed', offline: false, retry });

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t open this recipe');
        expect(screen.getByText('Check your connection, then try again.')).toBeTruthy();

        press('Try again');
        expect(retry).toHaveBeenCalledTimes(1);
        press('Back to the recipe');
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('says the offline body when the device is offline', () => {
        setup({ kind: 'failed', offline: true, retry: vi.fn() });

        expect(screen.getByText('You’re offline, and this recipe isn’t saved on this device yet.')).toBeTruthy();
    });
});

describe('CookingScreen (native): no steps', () => {
    const blank = {
        id: 'r1',
        title: TITLE,
        status: RecipeStatus.PUBLISHED,
        steps: [{ stepNumber: 1, instruction: '  ' }],
    };

    it('offers its owner Edit recipe', () => {
        const { onEdit } = setup(ready({ recipe: blank, viewerIsOwner: true }));

        expect(screen.getByRole('alert').textContent).toBe('This recipe has no steps yet');
        expect(screen.getByText(/Add some to cook from it here\./u)).toBeTruthy();
        press('Edit recipe');
        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('tells another cook its cook has added none, with no Edit recipe', () => {
        setup(ready({ recipe: blank, viewerIsOwner: false }));

        expect(screen.getByText('Its cook hasn’t added any steps.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Edit recipe' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Back to the recipe' })).toBeTruthy();
    });
});

describe('CookingScreen (native): recipe gone', () => {
    it('says the title and Go to Home, and never why', () => {
        const { onHome, container } = setup({ kind: 'gone' });

        expect(screen.getByRole('alert').textContent).toBe('This recipe isn’t available any more');
        expect(container.textContent).toBe('This recipe isn’t available any moreGo to Home');
        press('Go to Home');
        expect(onHome).toHaveBeenCalledTimes(1);
    });
});

describe('CookingScreen (native): where a cook link goes', () => {
    const draft = { id: 'r1', title: TITLE, status: RecipeStatus.DRAFT, steps: STEPS };

    it('sends the owner of a draft to the editor, painting only the loading frame, never the recipe', () => {
        const { onEdit, container } = setup(ready({ recipe: draft, viewerIsOwner: true }));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        expect(container.textContent).not.toContain(TITLE);
        expect(container.textContent).not.toContain('Heat 1.5 tbsp');
        expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('tells another cook a draft is not available, and never why', () => {
        const { onEdit, container } = setup(ready({ recipe: draft, viewerIsOwner: false }));

        expect(screen.getByRole('alert').textContent).toBe('This recipe isn’t available any more');
        expect(container.textContent).not.toMatch(/draft/iu);
        expect(onEdit).not.toHaveBeenCalled();
    });

    it('cooks another cook’s published recipe', () => {
        setup(ready({ viewerIsOwner: false }));

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });
});

describe('CookingScreen (native): a step', () => {
    it('opens on step 1, counting only the steps with text', () => {
        setup();

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByRole('region', { name: 'Step 1 of 6' })).toBeTruthy();
    });

    it('shows the focus line with its line count, and the rest as Then lines', () => {
        setup();

        expect(screen.getByText('Line 1 of 2')).toBeTruthy();
        expect(screen.getAllByRole('checkbox').map((box) => box.textContent)).toEqual([
            'Heat 1.5 tbsp. oil.',
            'Add the onion and cook 5 min.',
        ]);
    });

    it('previews the next step’s first line in the pinned foot, outside the scrolling body', () => {
        setup();

        const body = screen.getByTestId('cooking-scroll');
        const preview = screen.getByText('Add 2 tbsp. butter.');

        expect(screen.getByText('Next · step 2')).toBeTruthy();
        expect(screen.queryByText('Stir well.')).toBeNull();
        expect(body.contains(preview)).toBe(false);
        expect(
            preview.compareDocumentPosition(screen.getByRole('navigation')) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('cuts the preview to one line under 700 tall, and keeps the whole line in its text', () => {
        viewport.height = 699;
        const { unmount } = setup();
        expect(getComputedStyle(screen.getByText('Add 2 tbsp. butter.')).textOverflow).toBe('ellipsis');
        unmount();

        viewport.height = 700;
        setup();
        const line = screen.getByText('Add 2 tbsp. butter.');
        expect(getComputedStyle(line).textOverflow).not.toBe('ellipsis');
        expect(line.textContent).toBe('Add 2 tbsp. butter.');
    });

    // The cut is measured in text, not pixels: at twice the text size an 844-tall phone holds 422 of the 700, so it cuts.
    it('cuts the preview at the largest text on a phone that is tall enough at the normal size', () => {
        viewport.fontScale = 2;
        const { unmount } = setup();
        expect(getComputedStyle(screen.getByText('Add 2 tbsp. butter.')).textOverflow).toBe('ellipsis');
        unmount();

        viewport.fontScale = 1;
        setup();
        expect(getComputedStyle(screen.getByText('Add 2 tbsp. butter.')).textOverflow).not.toBe('ellipsis');
    });

    it('shows neither the preview nor Up next on the last step', () => {
        setup();

        for (let move = 0; move < 5; move += 1) {
            fireEvent.click(forward());
        }

        expect(screen.getByText('Step 6 of 6')).toBeTruthy();
        expect(screen.queryByText(/^Next · step/u)).toBeNull();
        expect(screen.queryByText(/^Up next/u)).toBeNull();
    });

    it('names Back for the recipe on step 1, and leaves with it', () => {
        const { onLeave } = setup();

        expect(back().getAttribute('aria-label')).toBe('Back to the recipe');
        expect(back().textContent).toContain('Back');
        fireEvent.click(back());
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('names Next by the step it opens, quiet and last', () => {
        setup();

        expect(forward().getAttribute('aria-label')).toBe('Next step, step 2');
        expect(isFilled(forward())).toBe(false);
    });

    it('moves the focus to the next unticked line when the focus line is ticked', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');

        expect(screen.getByText('Line 2 of 2')).toBeTruthy();
        expect(screen.getByText('You ticked 1 line')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe('false');
        expect(screen.getAllByRole('checkbox').map((box) => box.textContent)).toEqual([
            'Add the onion and cook 5 min.',
        ]);
    });

    it('keeps Next quiet and working with lines unticked (ticking is never required)', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        expect(isFilled(forward())).toBe(false);
        fireEvent.click(forward());

        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });

    it('opens the ticked lines with Show, and an unticked line above the focus becomes the focus again', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        press('Show');
        expect(screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' }).getAttribute('aria-checked')).toBe('true');

        tick('Heat 1.5 tbsp. oil.');

        expect(screen.getByText('Line 1 of 2')).toBeTruthy();
        expect(screen.queryByText(/You ticked/u)).toBeNull();
    });

    it('says the plural once two lines are ticked', () => {
        setup();
        fireEvent.click(forward());

        tick('Add 2 tbsp. butter.');
        tick('Stir well.');

        expect(screen.getByText('You ticked 2 lines')).toBeTruthy();
    });

    it('shows Up next in the body, with no preview, and a filled Start step n once every line is ticked', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        tick('Add the onion and cook 5 min.');

        const body = screen.getByTestId('cooking-scroll');
        expect(body.contains(screen.getByText('Up next · step 2'))).toBe(true);
        expect(body.contains(screen.getByText('Stir well.'))).toBe(true);
        expect(screen.queryByText('Next · step 2')).toBeNull();
        expect(screen.queryByText(/^Line \d/u)).toBeNull();
        expect(forward().textContent).toContain('Start step 2');
        expect(isFilled(forward())).toBe(true);

        fireEvent.click(forward());
        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });

    it('keeps a step’s ticks when the cook goes on and comes back', () => {
        setup();

        tick('Heat 1.5 tbsp. oil.');
        fireEvent.click(forward());
        expect(back().getAttribute('aria-label')).toBe('Back to step 1');
        fireEvent.click(back());

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByText('You ticked 1 line')).toBeTruthy();
        expect(screen.getByText('Line 2 of 2')).toBeTruthy();
    });

    it('hides the line count for a one-line step', () => {
        setup();
        fireEvent.click(forward());
        fireEvent.click(forward());

        expect(screen.getByText('Step 3 of 6')).toBeTruthy();
        expect(screen.queryByText(/^Line \d/u)).toBeNull();
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    });

    it('makes the last step’s forward Finish, quiet until its line is ticked, then filled', () => {
        setup();

        for (let step = 1; step < 6; step++) {
            fireEvent.click(forward());
        }

        expect(screen.getByText('Step 6 of 6')).toBeTruthy();
        expect(forward().textContent).toContain('Finish');
        expect(isFilled(forward())).toBe(false);
        expect(screen.queryByText(/Next · step/u)).toBeNull();

        tick('Serve.');
        expect(isFilled(forward())).toBe(true);
    });

    it('announces a step change politely with the place and the focus line', () => {
        const { container } = setup();

        fireEvent.click(forward());

        const polite = Array.from(container.querySelectorAll('[aria-live="polite"]'));
        expect(polite.some((region) => region.textContent === 'Step 2 of 6. Add 2 tbsp. butter.')).toBe(true);
    });

    it('says nothing in the live region on opening, only after a move', () => {
        const { container } = setup();

        const polite = Array.from(container.querySelectorAll('[aria-live="polite"]'));
        // The region is mounted empty before there is anything to say (LiveRegion's Android rule).
        expect(polite.length).toBeGreaterThan(0);
        expect(polite.every((region) => region.textContent === '')).toBe(true);
    });

    it('starts Show closed again on every step', () => {
        setup();
        tick('Heat 1.5 tbsp. oil.');
        press('Show');
        fireEvent.click(forward());
        tick('Add 2 tbsp. butter.');

        expect(screen.getByRole('button', { name: 'Show' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('reads the recipe once: a refetch with edited text changes nothing under the cook', () => {
        const { rerender, onLeave, onEdit, onHome } = setup();

        rerender(
            <CookingScreen
                read={ready({
                    recipe: {
                        id: 'r1',
                        title: TITLE,
                        status: RecipeStatus.PUBLISHED,
                        steps: [{ stepNumber: 1, instruction: 'Something else.' }],
                    },
                })}
                onLeave={onLeave}
                onEdit={onEdit}
                onHome={onHome}
            />,
        );

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Heat 1.5 tbsp. oil.' })).toBeTruthy();
    });

    it('opens a fresh session when the screen is given another recipe', () => {
        const { rerender, onLeave, onEdit, onHome } = setup();
        fireEvent.click(forward());

        rerender(
            <CookingScreen
                read={ready({
                    recipe: {
                        id: 'r2',
                        title: 'Soup',
                        status: RecipeStatus.PUBLISHED,
                        steps: [{ stepNumber: 1, instruction: 'Simmer the soup.' }],
                    },
                })}
                onLeave={onLeave}
                onEdit={onEdit}
                onHome={onHome}
            />,
        );

        expect(screen.getByText('Step 1 of 1')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Simmer the soup.' })).toBeTruthy();
    });

    it('exits to the recipe with Exit', () => {
        const { onLeave } = setup();

        press('Exit cooking mode');

        expect(onLeave).toHaveBeenCalledTimes(1);
    });
});

// The screen reads the window once, because a leaf never reads the device; under 360 the place takes its
// own row and the Back and Next chevrons hide, so the labels keep one line. 360 itself is the wide layout.
describe('CookingScreen (native): the under-360 layout', () => {
    const glyphs = (el: HTMLElement) => el.querySelectorAll('[data-commise-stub="icon"]').length;
    const topBar = () => screen.getByTestId('cooking-top-bar');

    it('at 359 puts the place on its own row and draws no chevrons, keeping both labels', () => {
        viewport.width = 359;
        setup();

        expect(getComputedStyle(topBar()).flexDirection).toBe('column');
        expect(glyphs(back())).toBe(0);
        expect(glyphs(forward())).toBe(0);
        expect(back().textContent).toContain('Back');
        expect(forward().textContent).toContain('Next step');
    });

    it('at 360 keeps the place beside Exit and draws a chevron on each', () => {
        viewport.width = 360;
        setup();

        expect(getComputedStyle(topBar()).flexDirection).toBe('row');
        expect(glyphs(back())).toBe(1);
        expect(glyphs(forward())).toBe(1);
    });

    // The 360 is measured in text, like web's 22.5rem: the width is divided by the cook's text size.
    it('at twice the text size takes the narrow layout under 720 wide, and the wide one at 720', () => {
        viewport.fontScale = 2;
        viewport.width = 719;
        const { unmount } = setup();
        expect(getComputedStyle(topBar()).flexDirection).toBe('column');
        expect(glyphs(back())).toBe(0);
        expect(glyphs(forward())).toBe(0);
        unmount();

        viewport.width = 720;
        setup();
        expect(getComputedStyle(topBar()).flexDirection).toBe('row');
        expect(glyphs(back())).toBe(1);
        expect(glyphs(forward())).toBe(1);
    });
});

// At the largest text the step body scrolls; the place, Exit, Back and Next stay pinned, nothing truncated.
describe('CookingScreen (native): the body scrolls between a pinned top bar and nav', () => {
    it('puts the step in the scrolling body, and the top bar and nav outside it', () => {
        setup();

        const body = screen.getByTestId('cooking-scroll');

        expect(body.contains(screen.getByRole('region', { name: 'Step 1 of 6' }))).toBe(true);
        expect(body.contains(screen.getByTestId('cooking-top-bar'))).toBe(false);
        expect(body.contains(screen.getByRole('navigation'))).toBe(false);
    });
});

/**
 * A finger drag, through react-native-web's own responder system: a touch starts on the step (or on another element the
 * test names), moves, and lifts. Nothing here calls the screen's handlers directly, so a handler that is not wired to an
 * ancestor of the touched element fails these tests.
 */
function drag(
    from: { readonly x: number; readonly y: number },
    to: { readonly x: number; readonly y: number },
    on: HTMLElement = screen.getAllByRole('region')[0] as HTMLElement,
): void {
    const step = on;
    const at = (point: { readonly x: number; readonly y: number }) => ({
        identifier: 0,
        pageX: point.x,
        pageY: point.y,
        clientX: point.x,
        clientY: point.y,
        target: step,
    });

    fireEvent.touchStart(step, { touches: [at(from)], changedTouches: [at(from)], timeStamp: 1 });
    fireEvent.touchMove(step, { touches: [at(to)], changedTouches: [at(to)], timeStamp: 2 });
    fireEvent.touchEnd(step, { touches: [], changedTouches: [at(to)], timeStamp: 3 });
}

const SWIPE_LEFT = { from: { x: 330, y: 300 }, to: { x: 60, y: 310 } } as const;
const SWIPE_RIGHT = { from: { x: 60, y: 300 }, to: { x: 330, y: 310 } } as const;

// A swipe on the step is an extra route between steps, and only between steps.
describe('CookingScreen (native): the step swipe', () => {
    it('moves to the next step on a left swipe and back on a right swipe, and says where it went', () => {
        const { container } = setup();
        fireEvent.click(forward());
        expect(screen.getByText('Step 2 of 6')).toBeTruthy();

        drag(SWIPE_LEFT.from, SWIPE_LEFT.to);
        expect(screen.getByText('Step 3 of 6')).toBeTruthy();
        const polite = Array.from(container.querySelectorAll('[aria-live="polite"]'));
        expect(polite.some((region) => region.textContent === 'Step 3 of 6. Roast for 40 min.')).toBe(true);

        drag(SWIPE_RIGHT.from, SWIPE_RIGHT.to);
        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });

    it('does not leave cooking mode on a right swipe at step 1', () => {
        const { onLeave } = setup();

        drag(SWIPE_RIGHT.from, SWIPE_RIGHT.to);

        expect(onLeave).not.toHaveBeenCalled();
        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
    });

    it('does not finish on a left swipe at the last step', () => {
        setup();

        for (let move = 0; move < 5; move += 1) {
            fireEvent.click(forward());
        }

        expect(screen.getByText('Step 6 of 6')).toBeTruthy();

        drag(SWIPE_LEFT.from, SWIPE_LEFT.to);

        expect(screen.getByText('Step 6 of 6')).toBeTruthy();
        expect(screen.queryByText('All 6 steps done')).toBeNull();
    });

    // A short step leaves most of the scrolling body empty, and a cook swipes wherever the screen is free.
    it('takes a swipe that starts in the empty body below a short step', () => {
        setup();
        fireEvent.click(forward());

        drag(SWIPE_LEFT.from, SWIPE_LEFT.to, screen.getByTestId('cooking-scroll'));

        expect(screen.getByText('Step 3 of 6')).toBeTruthy();
    });

    it('leaves a swipe from the left screen edge to the system', () => {
        setup();
        fireEvent.click(forward());

        drag({ x: 4, y: 300 }, { x: 330, y: 300 });

        expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    });
});

// The focus line and the title never share a size: readingLarge and largeTitle never appear on one screen.
describe('CookingScreen (native): the focus-line role and the title role never share a screen', () => {
    it('draws nothing in the largeTitle face in any step state', () => {
        const { container } = setup();

        expect(inFace(container, LARGE_TITLE)).toHaveLength(0);
        tick('Heat 1.5 tbsp. oil.');
        press('Show');
        expect(inFace(container, LARGE_TITLE)).toHaveLength(0);
        tick('Add the onion and cook 5 min.');
        expect(inFace(container, LARGE_TITLE)).toHaveLength(0);
    });

    it('draws nothing in the focus-line face on Done', () => {
        const { container } = setup();

        for (let step = 0; step < 6; step++) {
            fireEvent.click(forward());
        }

        expect(screen.getByRole('heading', { name: 'All 6 steps done' })).toBeTruthy();
        expect(inFace(container, FOCUS_LINE)).toHaveLength(0);
    });
});

describe('CookingScreen (native): Done', () => {
    const finish = () => {
        for (let step = 1; step < 6; step++) {
            fireEvent.click(forward());
        }

        fireEvent.click(forward());
    };

    it('says all the steps are done and moves screen-reader focus to the title', () => {
        setup();
        finish();

        const title = screen.getByRole('heading', { name: 'All 6 steps done' });
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(title, 'focus');
        expect(screen.getByText(`${TITLE}. Enjoy it.`)).toBeTruthy();
        expect(screen.queryByRole('navigation')).toBeNull();
    });

    it('keeps the labelled Exit in the top bar, with no place', () => {
        const { onLeave } = setup();
        finish();

        expect(screen.queryByText(/^Step \d+ of \d+$/u)).toBeNull();
        press('Exit cooking mode');

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('pins its two actions in the foot, outside the scrolling body', () => {
        setup();
        finish();

        const body = screen.getByTestId('cooking-scroll');

        expect(body.contains(screen.getByRole('heading', { name: 'All 6 steps done' }))).toBe(true);
        expect(body.contains(screen.getByRole('button', { name: 'Back to the recipe' }))).toBe(false);
        expect(body.contains(screen.getByRole('button', { name: 'Cook it again' }))).toBe(false);
    });

    it('holds the screen on while cooking and lets it go on Done', () => {
        keepAwake.available = true;
        setup();

        expect(keepAwake.calls.at(-1)).toBe(true);
        finish();

        expect(keepAwake.calls.at(-1)).toBe(false);
        expect(screen.getByText('The screen can turn off again.')).toBeTruthy();
    });

    it('promises nothing about the screen where it could not be held', () => {
        keepAwake.available = false;
        setup();
        finish();

        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
    });

    it('goes back to the recipe', () => {
        const { onLeave } = setup();
        finish();

        press('Back to the recipe');

        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it('cooks it again from step 1, line 1, with every tick cleared', () => {
        setup();
        tick('Heat 1.5 tbsp. oil.');
        finish();

        press('Cook it again');

        expect(screen.getByText('Step 1 of 6')).toBeTruthy();
        expect(screen.getByText('Line 1 of 2')).toBeTruthy();
        expect(screen.queryByText(/You ticked/u)).toBeNull();
        expect(keepAwake.calls.at(-1)).toBe(true);
    });
});
