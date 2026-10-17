/**
 * @module cards/cardSpec — the types of a design-system component card. A card is data plus one render function:
 * the page template (`cardPage`) owns the layout, the host marker and the staging, so a card file states only what
 * is specific to its component.
 *
 * @pattern Template Method — the card supplies the varying steps (`render`, `afterRender`, options); `cardPage`
 * owns the invariant skeleton.
 */
import type { ReactNode } from 'react';

import type { CardComponentName, CardUi, NativeCardUi } from './cardComponents.js';

/** Which columns a card shows. */
export type CardPlatforms = 'both' | 'web' | 'native';

/** Window and overlay set-up a card asks the page for. A closed set: everything else belongs in `render`. */
export interface CardStaging {
    /**
     * The card is a page that scrolls: the document is taller than `height` ON PURPOSE, because the component under
     * show reacts to the document's scroll position (`BackToTop`). Without this a card whose content is taller than
     * its declared `height` is a defect the e2e tier fails, so a clipped preview cannot go unnoticed.
     */
    readonly scrollsDocument?: boolean;
    /**
     * Makes the window a 390 x 844 phone before anything renders (`innerWidth`, `innerHeight` and `visualViewport`,
     * then a `resize`), for components that branch on the viewport.
     */
    readonly phoneViewport?: boolean;
    /**
     * Gives each column a clipped, framed stage of this height and moves the overlay a component portals to
     * `<body>` (a Radix layer, a react-native-web Modal) into its own column's stage instead of over the page.
     */
    readonly portalIntoColumn?: { readonly frameHeight: number };
}

/** Which column a render call is for, and the layout class that column's primary arrangement uses. */
export interface CardContext {
    readonly platform: 'web' | 'native';
    /** `row` on the wide web column, `col` on the phone-width native column. Use as `className`. */
    readonly stack: 'row' | 'col';
}

/**
 * The mounted column elements, handed to `afterRender`. A column the card does not show is absent, and so is a stage
 * when the card asks for no `portalIntoColumn`: a stage is the framed box that column's overlays are moved into.
 */
export interface CardColumns {
    readonly web?: HTMLElement;
    readonly native?: HTMLElement;
    readonly webStage?: HTMLElement;
    readonly nativeStage?: HTMLElement;
}

/** A line of text under a column. */
export interface CardNotes {
    readonly web?: string;
    readonly native?: string;
}

/** The part of a card the page template needs besides the render function. */
export interface CardMeta {
    /** The group the card is listed under in the host. */
    readonly group: string;
    /** The preview height in CSS pixels. */
    readonly height: number;
    readonly staging?: CardStaging;
    readonly notes?: CardNotes;
}

/** `reason` is required exactly when a platform is missing, and meaningless otherwise. */
export type CardScope =
    | { readonly platforms: 'both'; readonly reason?: undefined }
    | { readonly platforms: 'web' | 'native'; readonly reason: string };

/**
 * A component card.
 *
 * @typeParam Used - The component names the card mounts; `render` may only touch those.
 */
export type CardSpec<Used extends CardComponentName = CardComponentName> = CardMeta &
    CardScope & {
        /**
         * The components the card mounts. The build checks each against the surface discovered for the card's
         * platforms and fails the build when one is missing (`surface/surfaceChecks.ts`), so a card can never name a
         * component its column cannot mount.
         */
        readonly uses: readonly Used[];
        /**
         * Called once per shown column, with that platform's namespace. It serves the native column too unless
         * {@link CardSpec.renderNative} is given.
         */
        readonly render: (ui: CardUi<Used>, context: CardContext) => ReactNode;
        /**
         * The native column, for a card whose components take different props on the two platforms (the native leaf
         * has a prop the web one lacks, or the reverse). Typed against the native leaves, so a prop only the web
         * takes fails `tsc` here. When given, `render` draws the web column only.
         */
        readonly renderNative?: (ui: NativeCardUi<Used>, context: CardContext) => ReactNode;
        /**
         * Runs in the browser after the columns are rendered, for a state that needs the DOM (focus a trigger,
         * scroll a host). The page is not flagged ready (`data-card-ready`) until the returned promise settles, so an
         * interaction that takes time returns a promise that resolves when its result is on screen: await a DOM
         * condition with `waitFor` (`./waitFor.ts`), never a fixed delay. A rejection leaves the page unready and
         * logs the error.
         */
        readonly afterRender?: (columns: CardColumns) => void | Promise<void>;
    };
