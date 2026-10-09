/**
 * @module @commise/ui/back-to-top — the shared contract of the design-system `BackToTop` (`docs/design/uiOverhaul/buildSpec.md`
 * §3.6; ownerDecisions D3). WEB ONLY, on long lists (My recipes, Discover results, collection detail members).
 *
 * PLATFORM-FORK (§14.3): there is no native leaf, by design. On native the second tap on the active tab and the iOS
 * status-bar tap scroll to the top (React Navigation's `useScrollToTop` over the screen's `ScrollHost`), which is the
 * platform's own way to do this job.
 */

/** The `BackToTop` contract. */
export interface BackToTopProps {
    /** The label and name: "Back to top". */
    readonly label: string;
    /**
     * Called after the scroll starts: move focus to the page's H1 (advance its `LargeTitleHeader.focusSignal`), so a
     * keyboard or screen-reader user lands at the top too (SC 2.4.3).
     */
    readonly onReturn: () => void;
    /** Whether a floating create button shows on this page: "Back to top" then sits 16 px above it. */
    readonly aboveFab?: boolean;
}
