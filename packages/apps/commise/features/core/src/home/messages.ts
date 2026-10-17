/**
 * @module @commise/features-core/home — the copy of the Home surface that web and mobile say identically, in one
 * dictionary: the time-of-day greetings, the "Coming soon" roadmap, the paid-features nudge, the failed-widget notice,
 * and the navigation labels both tab bars draw.
 *
 * Each app's own dictionary used to hold its own copy of these sentences, word for word, and the two had already begun to
 * differ (the tab bar's accessible name was "Tabs" on web and "Main" on mobile; `buildSpec.md` §10 names it "Tabs", and
 * "Main" is the sidebar's). What stays in an app's dictionary is what is that platform's alone: web's wordmark, page
 * titles and sidebar controls; mobile's "Close upgrade offer".
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { HomeNavItemId } from '../homeNavigation.js';
import type { RoadmapWidgetId } from '../roadmapWidgets.js';
import type { GreetingBucket } from '../utils/timeOfDay.js';

/** The navigation labels both tab bars (and the web sidebar) draw, and the profile entry's name. */
export interface HomeChromeMessages {
    /** Label of each navigation destination, keyed by the shared nav model's id. */
    readonly destinations: Readonly<Record<HomeNavItemId, string>>;
    /** The avatar's and the profile row's name, with the cook's name in `{name}` (`buildSpec.md` §3.3). */
    readonly profileButton: string;
    /** The same name when the cook has none yet. */
    readonly profileButtonNoName: string;
    /** Accessible name of the bottom tab bar's navigation landmark (the sidebar's differs: `buildSpec.md` §10). */
    readonly tabNavLabel: string;
}

/** Copy of the Home surface, shared by both apps. */
export interface HomeMessages {
    /** Home's H1 when the cook has no name yet, one per time-of-day bucket (`buildSpec.md` §4.2). */
    readonly greetings: Readonly<Record<GreetingBucket, string>>;
    /** Home's H1 with the cook's name in `{name}`: "Good afternoon, Eliza". */
    readonly greetingsNamed: Readonly<Record<GreetingBucket, string>>;
    /** Accessible label for the Home widget-surface region. */
    readonly regionLabel: string;
    /** Shown in place of a live Home widget whose body throws (B23). */
    readonly widgetError: string;
    /**
     * The roadmap skeleton placeholders (FR-046 / R6 as amended by CR-001). Titles are the REAL widget headings from the
     * mockup: the placeholder shows what is coming, never invented data.
     */
    readonly roadmap: {
        /** The heading over the placeholders. */
        readonly comingSoonHeading: string;
        /** The line under it. */
        readonly comingSoonBody: string;
        /** The badge on each placeholder. */
        readonly soon: string;
        /** The widget headings, keyed by the roadmap id. */
        readonly titles: Readonly<Record<RoadmapWidgetId, string>>;
    };
    /** The paid-features nudge (plan 2026-10-14-009 D14). */
    readonly nudge: {
        readonly title: string;
        readonly body: string;
        /** The action that opens the plans. */
        readonly upgrade: string;
        /** The action that dismisses the nudge. */
        readonly dismiss: string;
    };
    /** The navigation labels. */
    readonly chrome: HomeChromeMessages;
}

/** The Home surface's shared copy, per locale. */
export const homeMessages: LocalizedMessages<HomeMessages> = {
    en: {
        greetings: {
            morning: 'Good morning',
            afternoon: 'Good afternoon',
            evening: 'Good evening',
            night: 'Still up?',
        },
        greetingsNamed: {
            morning: 'Good morning, {name}',
            afternoon: 'Good afternoon, {name}',
            evening: 'Good evening, {name}',
            night: 'Still up, {name}?',
        },
        regionLabel: 'Home',
        widgetError: 'This section couldn’t load.',
        roadmap: {
            comingSoonHeading: 'Coming soon',
            comingSoonBody: 'Meal plans, a grocery list and daily nutrition are on the way.',
            soon: 'Soon',
            titles: {
                nutrition: 'Today’s nutrition',
                'resume-cooking': 'Resume cooking',
                'meal-plan': 'This week’s meals',
            },
        },
        nudge: {
            title: 'Unlock Commise Pro',
            body: 'Upgrade to Commise Pro to use this feature.',
            upgrade: 'See plans',
            dismiss: 'Maybe later',
        },
        chrome: {
            destinations: {
                home: 'Home',
                recipes: 'Recipes',
                discover: 'Discover',
                'meal-plan': 'Plan',
                grocery: 'Shop',
            },
            profileButton: 'Profile, {name}',
            profileButtonNoName: 'Profile',
            tabNavLabel: 'Tabs',
        },
    },
};
