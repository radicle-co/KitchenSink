/**
 * Component tests for the mobile Home widget-surface HOST logic (US-000 / FR-046): discovery → curation →
 * render, the placeholder-vs-bespoke render split, the skip-unknown-id path, and the once-per-session nudge.
 * Rendered via react-native-web under jsdom (see `vitest.native.config.ts`). The host's seams (`container`,
 * `renderers`) are injected with fakes so these assert the composition-root behaviour without loading the
 * real widget chunks — the real recipe slot's states are covered in `RecipeWidgetSlot.native.test.tsx`, and
 * the chrome pieces in their own tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { lazy, type FC, type JSX } from 'react';

import {
    errorReporterToken,
    isPlaceholderHomeWidget,
    registerHomeWidget,
    resolveHomeWidgets,
    ROADMAP_WIDGET_IDS,
    type ErrorReporter,
    type HomeWidgetDescriptor,
} from '@commise/features-core';
import {
    RECIPE_HOME_WIDGET_ID,
    RecipeWidgetEmptyState,
    RecipeWidgetLoadError,
    RecipeWidgetLoadingCard,
} from '@commise/features-recipes';
import { LocaleProvider } from '@commise/i18n/react';
import { renderWithProviders, sideInsetOf } from '@commise/test-utils';
import { FAB_RESERVED_BOTTOM_PX } from '@commise/ui/create-fab';
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';
import { createContainer, type Container } from 'ditox';
import { Pressable, Text } from 'react-native';

import { HomeWidgetSurface } from '../../../src/components/home/HomeWidgetSurface.js';
import { homeContainer } from '../../../src/components/home/homeContainer.js';
import { useHomeNudge } from '@commise/features-core/home';

// The profile hook hits Clerk + the identity API; stub it to a controllable tier + display name.
const { profileRef } = vi.hoisted(() => ({
    profileRef: {
        current: {
            data: {
                // Plan 2026-10-14-009: the nudge is an upsell, offered only under `upsell`.
                account: { paidFeatures: 'upsell' as 'granted' | 'upsell' | 'hidden' },
                user: { displayName: 'Jane Doe' as string | undefined },
            },
        },
    },
}));
vi.mock('../../../src/hooks/useUserProfile.js', () => ({ useUserProfile: () => profileRef.current }));

// `homeContainer` binds `errorReporterToken` to a real Sentry-backed reporter; mocked (never loaded for real)
// so importing it here doesn't drag in `@sentry/react-native`'s native module graph under jsdom, mirroring
// how the web host's equivalent test mocks `@sentry/nextjs`.
vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));

// The Home surface reads the bottom safe-area inset for the tab bar; a zero-inset stub renders it faithfully.
vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

afterEach(() => {
    cleanup();
    profileRef.current.data.account.paidFeatures = 'upsell';
    vi.useRealTimers();
});

const noop = (): void => undefined;

/** A registrable LIVE descriptor with an inert loader (the injected renderer is what actually draws). */
const makeLiveDescriptor = (id: string): HomeWidgetDescriptor => ({
    id,
    load: () => Promise.resolve({ default: (): null => null }),
    defaultWeight: 1,
});

/** A registrable PLACEHOLDER descriptor whose loader resolves the supplied skeleton component. */
const makePlaceholderDescriptor = (id: string, Skeleton: FC): HomeWidgetDescriptor => ({
    kind: 'placeholder',
    id,
    capability: `${id}-capability`,
    load: () => Promise.resolve({ default: Skeleton }),
    defaultWeight: 1,
});

/** A container pre-registered with the given descriptors. */
const containerWith = (...descriptors: readonly HomeWidgetDescriptor[]): Container => {
    const container = createContainer();

    for (const descriptor of descriptors) {
        registerHomeWidget(container, descriptor);
    }

    return container;
};

const renderSurface = (props: Partial<Parameters<typeof HomeWidgetSurface>[0]> = {}): void => {
    renderWithProviders(<HomeWidgetSurface onSeeAllRecipes={noop} onSelectRecipe={noop} {...props} />);
};

const FakeRecipeWidget: FC = () => <Text>fake-recipe-widget</Text>;

/**
 * Every greeting band the heading can be in, as [label, a local time in it, the exact title]. The greeting reads
 * the viewer's LOCAL clock (`useHomeGreeting`), so a test that finds the heading by its text must pin the clock and
 * name the band it expects: an unpinned one passed by day and failed between 22:00 and 04:59 ("Still up").
 * The bands' boundaries are covered by `greetingBucketForHour`'s own test (`@commise/features-core`).
 */
const GREETING_BANDS = [
    ['morning', new Date(2026, 4, 31, 8, 0, 0), 'Good morning, Jane Doe'],
    ['afternoon', new Date(2026, 4, 31, 14, 0, 0), 'Good afternoon, Jane Doe'],
    ['evening', new Date(2026, 4, 31, 19, 0, 0), 'Good evening, Jane Doe'],
    ['night', new Date(2026, 4, 31, 3, 45, 0), 'Still up, Jane Doe?'],
] as const;

/**
 * Pins ONLY `Date` to the given instant. The async queries (`findBy*`, `waitFor`) poll on real timers, so faking
 * `setTimeout` as well would stall them.
 */
const pinClockAt = (instant: Date): void => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(instant);
};

describe('HomeWidgetSurface (mobile) — host composition', () => {
    // Rewritten for slice 3: the top bar (with its dead search and bell) is deleted. Home's large title is the greeting,
    // the scroller's first child, with the avatar as its action; the tab bar is the navigator's
    // (`tests/navigation/RootNavigator.native.test.tsx`).
    it('renders the greeting as the large title, with its action, and no top bar or tab bar of its own', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
            headerAction: { kind: 'avatar', avatar: <Text accessibilityRole="button">Profile</Text> },
        });

        const heading = screen.getByRole('heading', { name: /^Good afternoon/u });

        expect(screen.getAllByRole('heading')[0]).toBe(heading);
        expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
        expect(screen.queryByLabelText(/coming soon/u)).toBeNull();
        expect(screen.queryByLabelText('Main')).toBeNull();
    });

    it('sits the greeting on the app canvas, not inside a gradient card', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 31, 14, 0, 0));

        renderWithProviders(
            <HomeWidgetSurface
                onSeeAllRecipes={noop}
                onSelectRecipe={noop}
                container={containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID))}
                renderers={{ [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget }}
            />,
        );

        // "No box in a box" (`docs/design/uiOverhaul/buildSpec.md` §1.6): the greeting card is deleted. The app canvas
        // already carries the beach-glow wash, so the greeting sits on it rather than in a second gradient card.
        expect(
            screen.getByRole('heading', { name: /^Good afternoon/u }).closest('[data-commise-stub="linear-gradient"]'),
        ).toBeNull();
    });

    // Bug sweep B11: the large title insets its own sides 16, so the region does not pad around it, and the widgets
    // under it pad themselves 16. A region that also padded would move the title in twice (32).
    it.each(GREETING_BANDS)(
        'insets the title once (its own 16) and the widgets under it by 16, in the %s',
        async (_band, instant, title) => {
            pinClockAt(instant);

            renderSurface({
                container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
                renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
            });

            expect(sideInsetOf(screen.getByRole('heading', { name: title }))).toBe(16);
            expect(sideInsetOf(await screen.findByText('fake-recipe-widget'))).toBe(16);
        },
    );

    it('renders the bespoke slot for a live widget whose id has a registered renderer', async () => {
        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
    });

    it.each(GREETING_BANDS)(
        'keeps the rest of Home on screen while a LAZY bespoke widget is still loading (a Suspense boundary per widget), in the %s',
        async (_band, instant, title) => {
            // A bespoke renderer may itself be `React.lazy` (the recipe slot is code-split). Home's widget-surface
            // contract is a per-widget ErrorBoundary + Suspense, so one widget still resolving must leave the greeting
            // and its siblings drawn: without the boundary the pending chunk suspends the whole surface.
            const Pending = lazy<FC>(() => new Promise<{ default: FC }>(() => undefined));
            const Sibling: FC = () => <Text>fake-sibling-widget</Text>;

            pinClockAt(instant);

            renderSurface({
                container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID), makeLiveDescriptor('sibling')),
                renderers: { [RECIPE_HOME_WIDGET_ID]: Pending, sibling: Sibling },
            });

            expect(await screen.findByText('fake-sibling-widget')).toBeTruthy();
            expect(screen.getByRole('heading', { name: title })).toBeTruthy();
        },
    );

    it('renders a placeholder through its loader seam (skeleton), not the bespoke renderer map', async () => {
        const Skeleton: FC = () => <Text>fake-skeleton</Text>;

        renderSurface({
            container: containerWith(
                makeLiveDescriptor(RECIPE_HOME_WIDGET_ID),
                makePlaceholderDescriptor('meal-plan', Skeleton),
            ),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-skeleton')).toBeTruthy();
        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
    });

    it('leads with the recent recipes and groups the placeholders under one "Coming soon" heading (F2, §4.2)', async () => {
        const Skeleton: FC = () => <Text>fake-skeleton</Text>;

        renderSurface({
            container: containerWith(
                makePlaceholderDescriptor('nutrition', Skeleton),
                makeLiveDescriptor(RECIPE_HOME_WIDGET_ID),
            ),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        const recipes = await screen.findByText('fake-recipe-widget');
        const heading = screen.getByRole('heading', { name: 'Coming soon' });
        const skeleton = await screen.findByText('fake-skeleton');

        expect(screen.getByText('Meal plans, a grocery list and daily nutrition are on the way.')).toBeTruthy();
        expect(recipes.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(heading.compareDocumentPosition(skeleton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('draws no "Coming soon" heading once no placeholder remains', async () => {
        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        await screen.findByText('fake-recipe-widget');

        expect(screen.queryByRole('heading', { name: 'Coming soon' })).toBeNull();
    });

    it('SKIPS a live widget whose id has no renderer instead of crashing (graceful version skew)', async () => {
        // `mystery` is a LIVE descriptor registered but absent from `renderers`, so it has no bespoke slot and
        // is not a placeholder. A host that did not guard this would render `<undefined />`; that crash would
        // be swallowed by the per-widget ErrorBoundary, and the only trace is React's console.error. Asserting
        // ZERO error logs is what makes this load-bearing — remove the skip guard and this fails.
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID), makeLiveDescriptor('mystery')),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });

        expect(await screen.findByText('fake-recipe-widget')).toBeTruthy();
        expect(errorSpy).not.toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    it('reports a widget render failure AND shows a localized notice, never silent blank space (B23/DA9)', () => {
        // A widget throw must never crash the surface, AND must never be silent (B23/DA9) — the boundary's
        // `onError` routes to the reporter resolved from the INJECTED `errorReporterToken`, not a hard-coded
        // Sentry import, so this asserts against a fake bound onto the test's own container.
        //
        // The VISIBLE half is the mirror of the web host's identical assertion: a `fallback={null}` here left
        // the viewer (and, worse, a screen-reader user) with unexplained blank space where a widget should be.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const reportError: ErrorReporter = vi.fn();

        const Boom: FC = () => {
            throw new Error('widget boom');
        };

        const container = containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID));
        container.bindValue(errorReporterToken, reportError);

        renderSurface({
            container,
            renderers: { [RECIPE_HOME_WIDGET_ID]: Boom },
        });

        // The throw is caught → no crash, and a LOCALIZED notice stands in for the widget, announced as a
        // POLITE `status` so assistive tech reports the failure without interrupting the viewer mid-sentence
        // over something they cannot act on. The copy is asserted as the literal the catalog ships (not
        // `mobileMessages.en...`), so swapping the key for another message fails here.
        expect(screen.queryByText('fake-recipe-widget')).toBeNull();
        expect(screen.getByText('This section couldn’t load.')).toBeTruthy();
        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(reportError).toHaveBeenCalledWith(expect.any(Error), { widget: RECIPE_HOME_WIDGET_ID });

        consoleError.mockRestore();
    });

    it('leaves a PLACEHOLDER failure silent — there is no widget content to explain the loss of (web parity)', async () => {
        // Deliberate asymmetry, matched on both platforms: a roadmap skeleton is itself a stand-in, so a
        // notice in its place would announce the failure of something the viewer was never promised. Only the
        // reporting is mandatory here. This pins the asymmetry so a well-meaning "make it consistent" change
        // to the placeholder arm has to argue with a test.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const reportError: ErrorReporter = vi.fn();

        const Boom: FC = () => {
            throw new Error('placeholder boom');
        };

        const container = containerWith(
            makeLiveDescriptor(RECIPE_HOME_WIDGET_ID),
            makePlaceholderDescriptor('meal-plan', Boom),
        );
        container.bindValue(errorReporterToken, reportError);

        renderSurface({ container, renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget } });

        // The placeholder loads through `React.lazy`, so its throw lands a tick later — wait for the REPORT
        // (the observable proof the boundary fired) before asserting the notice is absent, or this passes
        // vacuously against a surface that simply had not rendered the failing placeholder yet.
        await waitFor(() => {
            expect(reportError).toHaveBeenCalledWith(expect.any(Error), { widget: 'meal-plan' });
        });

        expect(screen.queryByText('This section couldn’t load.')).toBeNull();

        consoleError.mockRestore();
    });

    it('shows the subscription nudge at most once per session across repeated gated taps', async () => {
        const GatedWidget: FC = (): JSX.Element => {
            const { trigger } = useHomeNudge();

            return (
                <Pressable accessibilityRole="button" accessibilityLabel="gate" onPress={trigger}>
                    <Text>gate</Text>
                </Pressable>
            );
        };

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: GatedWidget },
        });
        const gate = await screen.findByRole('button', { name: 'gate' });

        fireEvent.click(gate);
        expect(screen.getByText('Unlock Commise Pro')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();

        fireEvent.click(gate);
        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();
    });

    // ── Plan 2026-10-14-009 D14 (owner ruling 2026-10-13): the nudge is an upsell, behind the paid-features gate.
    it.each(['granted', 'hidden'] as const)('⛔ never shows the subscription nudge under %s', async (state) => {
        profileRef.current.data.account.paidFeatures = state;

        const GatedWidget: FC = (): JSX.Element => {
            const { trigger } = useHomeNudge();

            return (
                <Pressable accessibilityRole="button" accessibilityLabel="gate" onPress={trigger}>
                    <Text>gate</Text>
                </Pressable>
            );
        };

        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: GatedWidget },
        });

        fireEvent.click(await screen.findByRole('button', { name: 'gate' }));

        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();
    });
});

/*
 * NOTE on where the recipe widget NAVIGATION binding is covered. The host default renderer map is where the
 * inert-cards defect lived (it built the slot with only `onSeeAllRecipes`, so `onSelectRecipe` was `undefined`
 * all the way down and every "Recent recipes" card rendered non-interactive). It is deliberately NOT re-tested
 * here: this file method is to inject `renderers`/`container` FAKES so the composition root can be asserted
 * without loading real widget chunks or a recipe query client. The real binding is covered where it is actually
 * observable end to end — `tests/screens/AppRoot.recipeTap.native.test.tsx` renders the real Home, host, slot,
 * widget and card leaves and taps a card — plus the slot own `RecipeWidgetSlot.native.test.tsx` activation cases.
 */
// Designer ruling 2026-11-01, corrected (`nativeBoards/designAnswers.md`): Home's "New recipe" button floats over its
// foot, so the page ends with the button's height, its margin and 16, computed (`FAB_RESERVED_BOTTOM_PX`), not the 48
// every other page ends with. Written after the code, which already read the constant; it was shown to fail by setting
// the foot to the 48 page end.
describe('HomeWidgetSurface (mobile) — the foot under the floating create button', () => {
    it('ends the scroller’s content with the room the floating create button needs', () => {
        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget },
        });
        const feet: string[] = [];

        // The scroller's content container is one of the widget's ancestors.
        for (
            let node = screen.getByText('fake-recipe-widget').parentElement;
            node !== null;
            node = node.parentElement
        ) {
            feet.push(getComputedStyle(node).paddingBottom);
        }

        expect(feet).toContain(`${String(FAB_RESERVED_BOTTOM_PX)}px`);
    });

    // Designer ruling d (2026-11-02): the room is the button's drawn height at the current text scale, plus its margin
    // and 16: 98 at the 1.5x chrome cap, not the 88 of scale 1.
    it('ends the scroller’s content with 98 px at a 1.5x text scale', () => {
        renderWithTamagui(
            <LocaleProvider locale="en">
                <HomeWidgetSurface
                    onSeeAllRecipes={noop}
                    onSelectRecipe={noop}
                    container={containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID))}
                    renderers={{ [RECIPE_HOME_WIDGET_ID]: FakeRecipeWidget }}
                />
            </LocaleProvider>,
            'light',
            1.5,
        );
        const feet: string[] = [];

        for (
            let node = screen.getByText('fake-recipe-widget').parentElement;
            node !== null;
            node = node.parentElement
        ) {
            feet.push(getComputedStyle(node).paddingBottom);
        }

        expect(feet).toContain('98px');
        expect(feet).not.toContain(`${String(FAB_RESERVED_BOTTOM_PX)}px`);
    });

    /**
     * Design review 2026-11-01 (`deviceShots2.md`, Low): the floating button sat over "We couldn't load your recent
     * recipes.". The foot is the SCROLLER's, so every state the recent block can be in — and the host's own failure
     * notice — ends with the same room, never a state of its own. These draw the real leaves through the renderer seam.
     * ⚠️ At rest a floating button covers whatever scrolls under it; what the room guarantees is that the END of the
     * content clears it, which only a device shows.
     */
    const Throws: FC = () => {
        throw new Error('slot failed');
    };

    const STATES: readonly (readonly [string, FC, () => HTMLElement])[] = [
        [
            'the read failed (Try again)',
            () => <RecipeWidgetLoadError onRetry={noop} seeAll={{ onPress: noop }} />,
            () => screen.getByText('We couldn’t load your recent recipes.'),
        ],
        [
            'loading',
            () => <RecipeWidgetLoadingCard variant="compact" />,
            () => screen.getByLabelText('Loading recipes'),
        ],
        ['empty', () => <RecipeWidgetEmptyState />, () => screen.getByText('Your recipes will show up here.')],
        ['the slot itself failed', Throws, () => screen.getByText('This section couldn’t load.')],
    ];

    it.each(STATES)('ends with the same room when the recent block is in the state: %s', (_name, Widget, anchor) => {
        // React logs the slot's throw; the boundary is what is under test, not the log.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(noop);
        renderSurface({
            container: containerWith(makeLiveDescriptor(RECIPE_HOME_WIDGET_ID)),
            renderers: { [RECIPE_HOME_WIDGET_ID]: Widget },
        });
        const feet: string[] = [];

        for (let node = anchor().parentElement; node !== null; node = node.parentElement) {
            feet.push(getComputedStyle(node).paddingBottom);
        }

        expect(feet).toContain(`${String(FAB_RESERVED_BOTTOM_PX)}px`);
        consoleError.mockRestore();
    });
});

describe('homeContainer (mobile) — v1 registration', () => {
    it('registers the live recipe widget AND the roadmap placeholders (005–009 are skeletons, not absent)', () => {
        const ids = resolveHomeWidgets(homeContainer).map((descriptor) => descriptor.id);

        expect(ids).toContain(RECIPE_HOME_WIDGET_ID);

        for (const roadmapId of ROADMAP_WIDGET_IDS) {
            expect(ids).toContain(roadmapId);
        }
    });

    it('registers the roadmap ids as placeholder-arm descriptors, and the recipe id as a live one', () => {
        const byId = new Map(resolveHomeWidgets(homeContainer).map((descriptor) => [descriptor.id, descriptor]));

        for (const roadmapId of ROADMAP_WIDGET_IDS) {
            const descriptor = byId.get(roadmapId);
            expect(descriptor && isPlaceholderHomeWidget(descriptor)).toBe(true);
        }

        const recipe = byId.get(RECIPE_HOME_WIDGET_ID);
        expect(recipe && isPlaceholderHomeWidget(recipe)).toBe(false);
    });
});

// ADR-0080: the "Coming soon" heading and its line draw through the design system's `Text`, so they follow the device's
// dark scheme and the 2x text cap. The heading is the web's `text-section-title text-ink`, the line its
// `text-body text-ink-muted`, which the web groups with the heading 4 pt apart (`gap-1`).
describe('HomeWidgetSurface (mobile) — the "Coming soon" heading’s type and colour', () => {
    const BODY = 'Meal plans, a grocery list and daily nutrition are on the way.';

    const renderComingSoon = (scheme: 'light' | 'dark'): void => {
        const Skeleton: FC = () => <Text>fake-skeleton</Text>;

        renderWithTamagui(
            <HomeWidgetSurface
                onSeeAllRecipes={noop}
                onSelectRecipe={noop}
                container={containerWith(makePlaceholderDescriptor('nutrition', Skeleton))}
                renderers={{}}
            />,
            scheme,
        );
    };

    it.each([
        ['Coming soon', 'sectionTitle'],
        [BODY, 'body'],
    ] as const)('sets “%s” in the %s role', (text, typeRole) => {
        const spec = nativeTokens.type[typeRole];
        renderComingSoon('light');
        const style = getComputedStyle(screen.getByText(text));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it('groups the line with its heading, space 1 apart', () => {
        renderComingSoon('light');
        const group = screen.getByRole('heading', { name: 'Coming soon' }).parentElement;

        expect(group?.contains(screen.getByText(BODY))).toBe(true);
        expect(group === null ? undefined : resolvedStyle(group, 'gap')).toBe(`${String(nativeTokens.spacing[1])}px`);
    });

    it.each(['light', 'dark'] as const)(
        'paints the heading in ink and its line in inkMuted in the %s scheme',
        (scheme) => {
            renderComingSoon(scheme);
            const roles = rolesFor(scheme);

            expect(resolvedColour(screen.getByRole('heading', { name: 'Coming soon' }), 'color')).toBe(rgb(roles.ink));
            expect(resolvedColour(screen.getByText(BODY), 'color')).toBe(rgb(roles.inkMuted));
        },
    );
});
