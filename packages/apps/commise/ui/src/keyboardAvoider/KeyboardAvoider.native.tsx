/**
 * @module @commise/ui/keyboard-avoider — the one keyboard rule for a screen or a modal's content
 * (`docs/design/compactHeightLayout.md` §9.2; `docs/design/ingredientSpecialization.md` §S8.1 "Keyboard: where the
 * sheet sits"). The only module in the apps that renders React Native's `KeyboardAvoidingView`
 * (`packages/infra/global/__tests__/keyboardAvoiderAdapterImports.test.ts`).
 *
 * The content is padded up by the part of it the keyboard covers, on both platforms. On iOS the keyboard overlays the
 * window. On Android this app's windows are edge to edge, the house `Modal`'s too (`navigationBarTranslucent`), and an
 * edge-to-edge window is not resized for the keyboard (E2 I6). React Native 0.86's `KeyboardAvoidingView` measures the
 * overlap from its own frame, so a window that does resize gets no padding and nothing is counted twice. That frame is
 * read relative to its parent and the keyboard's position on the screen, so the avoider sits in a box that starts at
 * the top of the window: a screen's root, a `SafeAreaView` that pads rather than moves, or a modal's backdrop. ⚠️ On
 * Android it pads only if React Native reports the keyboard while a modal window holds it, a device check owed.
 *
 * @pattern Adapter over React Native's `KeyboardAvoidingView` — one rule, owned once
 */
import type { FC, ReactNode } from 'react';
import { KeyboardAvoidingView, type StyleProp, type ViewStyle } from 'react-native';

/** Props for {@link KeyboardAvoider}. */
export interface KeyboardAvoiderProps {
    readonly style?: StyleProp<ViewStyle>;
    readonly children: ReactNode;
}

/** A `KeyboardAvoidingView` that pads its content above the keyboard. A presentational component. */
export const KeyboardAvoider: FC<KeyboardAvoiderProps> = ({ style, children }) => (
    <KeyboardAvoidingView behavior="padding" style={style}>
        {children}
    </KeyboardAvoidingView>
);
