/**
 * @module @commise/ui/pushed-page — the native design-system {@link PushedPageFrame} (see `props.ts`): the frame every
 * native pushed page mounts, so Back is pinned at the top of the safe area at every scroll position and in every state
 * (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md`).
 *
 * ORCHESTRATION of the page's frame. It mounts the page's ONE `ScrollHost`, reads the host's scroll state into the two
 * display facts (`barFactsOf`), and lays the pinned `CondensedTitleBar` over the page. The bar comes BEFORE the scroller
 * in the tree and is drawn over it by absolute position, so the reading order and the screen agree: Back, the menu, the H1,
 * then the content. The page's scroller spreads the `bind` it is handed and merges the `inset` it is handed (`PINNED_BAR_HEIGHT` of top
 * padding), so the large title starts under the bar and no page restates the bar's height.
 *
 * ⛔ One `ScrollHost` per page. A page that mounted a second, inner host would bind its scroller to that one while the bar
 * read this one, and the bar would never change. The host needs no bar height on native (see `ScrollHostWebProps.topInset`).
 *
 * The root `View` takes `onAccessibilityEscape` (iOS), so VoiceOver's two-finger scrub goes back, as it does in native iOS
 * apps. System back and predictive back stay with the navigator; `BackInterceptProvider` is unchanged (ADR-0056).
 *
 * @pattern Template — ScrollHost, pinned CondensedTitleBar, content inset
 */
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { PINNED_BAR_HEIGHT } from '../largeTitleHeader/barGeometry.js';
import { CondensedTitleBar } from '../largeTitleHeader/CondensedTitleBar.native.js';
import { ScrollHost } from '../scrollHost/ScrollHost.native.js';
import { useScrollHost } from '../scrollHost/scrollHostContext.js';
import type { ScrollBind } from '../scrollHost/props.js';
import { barFactsOf } from './barFacts.js';
import type { PushedPageFrameProps, PushedPageInset } from './props.js';

/** Native: the scroller's content starts under the bar. */
const INSET: PushedPageInset = { paddingTop: PINNED_BAR_HEIGHT };

/** The frame inside its host: the bar, then the page. */
const Frame: FC<Omit<PushedPageFrameProps, 'headingId'> & { readonly bind: ScrollBind }> = ({
    back,
    title,
    menu,
    children,
    bind,
}) => {
    const { atTop, condensed } = useScrollHost();
    const { surfaceShown, titleShown } = barFactsOf({ atTop, condensed });

    return (
        <View onAccessibilityEscape={back.onPress} style={styles.frame}>
            <CondensedTitleBar
                {...(title === undefined ? {} : { title })}
                back={back}
                {...(menu === undefined ? {} : { menu })}
                surfaceShown={surfaceShown}
                titleShown={titleShown}
            />
            {children(bind, INSET)}
        </View>
    );
};

/** The native design-system pushed-page frame. */
export const PushedPageFrame: FC<PushedPageFrameProps> = ({ headingId, back, title, menu, children }) => (
    <ScrollHost headingId={headingId}>
        {(bind) => (
            <Frame
                back={back}
                {...(title === undefined ? {} : { title })}
                {...(menu === undefined ? {} : { menu })}
                bind={bind}
            >
                {children}
            </Frame>
        )}
    </ScrollHost>
);

const styles = StyleSheet.create({
    // Transparent so the root `AppCanvas` wash shows through (issue #145).
    frame: { flex: 1, backgroundColor: 'transparent' },
});
