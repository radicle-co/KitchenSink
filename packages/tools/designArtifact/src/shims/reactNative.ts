/**
 * @module reactNative — the `react-native` module for the native build in a browser: everything react-native-web
 * exports, with the five members whose web behaviour would make the design system look or act wrong replaced:
 * `Platform` (an iOS one), `useColorScheme` and `Appearance` (follow `data-theme`, not the OS), `AccessibilityInfo`
 * (silent) and `TextInput` (multiline auto-grow that settles, and `setSelection`).
 *
 * The re-export list is written out because the repo bans `export *`; `reactNative.test.tsx` fails when it stops
 * matching react-native-web's own export list, so it cannot drift unseen.
 *
 * @pattern Adapter over react-native-web
 * @pattern Decorator — TextInput wraps the web input to report a device-style content height
 */
import { useComposedRefs } from '@radix-ui/react-compose-refs';
import { createElement, forwardRef, useSyncExternalStore } from 'react';
import {
    AccessibilityInfo as WebAccessibilityInfo,
    Appearance as WebAppearance,
    TextInput as WebTextInput,
} from 'react-native-web';
import type {
    AccessibilityInfoStatic,
    Appearance as NativeAppearance,
    EmitterSubscription,
    ColorSchemeName,
    PlatformIOSStatic,
    PlatformOSType,
    TextInputProps,
} from 'react-native';

export {
    ActivityIndicator,
    Alert,
    Animated,
    AppRegistry,
    AppState,
    BackHandler,
    Button,
    CheckBox,
    Clipboard,
    DeviceEventEmitter,
    Dimensions,
    Easing,
    FlatList,
    I18nManager,
    Image,
    ImageBackground,
    InteractionManager,
    Keyboard,
    KeyboardAvoidingView,
    LayoutAnimation,
    Linking,
    LogBox,
    Modal,
    NativeEventEmitter,
    NativeModules,
    PanResponder,
    Picker,
    PixelRatio,
    Pressable,
    ProgressBar,
    RefreshControl,
    SafeAreaView,
    ScrollView,
    SectionList,
    Share,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    Touchable,
    TouchableHighlight,
    TouchableNativeFeedback,
    TouchableOpacity,
    TouchableWithoutFeedback,
    UIManager,
    Vibration,
    View,
    VirtualizedList,
    YellowBox,
    findNodeHandle,
    processColor,
    render,
    unmountComponentAtNode,
    unstable_createElement,
    useLocaleContext,
    useWindowDimensions,
} from 'react-native-web';

const OS = 'ios';

/** An iPhone's platform. `select` picks `ios`, then `native`, then `default`, as Metro does. */
export const Platform: PlatformIOSStatic = {
    OS,
    Version: '26.0',
    isPad: false,
    isTV: false,
    isVision: false,
    isTesting: false,
    constants: {
        forceTouchAvailable: false,
        interfaceIdiom: 'phone',
        osVersion: '26.0',
        systemName: 'iOS',
        isTesting: false,
        reactNativeVersion: { major: 0, minor: 86, patch: 0 },
    },
    select: <T>(specifics: { [platform in PlatformOSType]?: T } & { default?: T }): T | undefined =>
        OS in specifics ? specifics[OS] : 'native' in specifics ? specifics.native : specifics.default,
};

/** A subscription that only removes. React Native types it as the emitter's class; no caller reads its other fields. */
const subscription = (remove: () => void): EmitterSubscription => ({ remove }) as EmitterSubscription;

// The design system switches theme with data-theme on <html>, not the OS scheme: follow it.
const readScheme = (): NonNullable<ColorSchemeName> =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

function subscribe(onChange: () => void): () => void {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
}

/** The colour scheme of the page: `dark` when `<html data-theme="dark">`, else `light`. */
export function useColorScheme(): NonNullable<ColorSchemeName> {
    return useSyncExternalStore(subscribe, readScheme, readScheme);
}

/** The web Appearance, with the scheme read from `data-theme`. */
export const Appearance: typeof NativeAppearance = {
    ...WebAppearance,
    getColorScheme: readScheme,
    addChangeListener: (listener) => {
        const unsubscribe = subscribe(() => listener({ colorScheme: readScheme() }));

        return subscription(unsubscribe);
    },
};

/** The web AccessibilityInfo with nothing announced and no assistive technology present. */
export const AccessibilityInfo: AccessibilityInfoStatic = {
    ...WebAccessibilityInfo,
    announceForAccessibility: () => undefined,
    announceForAccessibilityWithOptions: () => undefined,
    sendAccessibilityEvent: () => undefined,
    setAccessibilityFocus: () => undefined,
    isReduceMotionEnabled: () => Promise.resolve(false),
    isScreenReaderEnabled: () => Promise.resolve(false),
    addEventListener: () => subscription(() => undefined),
};

/** A length of a computed style such as `16px`, as a number. */
const pixels = (value: string): number => Number.parseFloat(value) || 0;

/**
 * Make a textarea report its TEXT height as `scrollHeight`, the way a device reports a content size.
 *
 * react-native-web measures `scrollHeight`, which includes the vertical padding and never falls below the box's own
 * height. A component that adds the padding back to what it is told then grows by one padding per report, and each
 * growth is measured again: an endless loop. Measuring with the box collapsed gives the natural height, and taking the
 * padding off gives the text.
 *
 * Scoped: the getter is defined on this one element, never on `HTMLTextAreaElement.prototype`.
 *
 * This compensates the same react-native-web padding defect as `textContentHeight` in
 * `packages/apps/commise/ui/src/input/TextArea.native.tsx`, which takes the padding off when `Platform.OS` is
 * `'web'`. The two do not compensate twice only because this shim reports `Platform.OS = 'ios'`, so that branch
 * stays idle here.
 *
 * @sideEffect Defines a property on the element.
 * @param node - The textarea react-native-web rendered.
 */
export function reportTextHeight(node: HTMLTextAreaElement): void {
    if (Object.hasOwn(node, 'scrollHeight')) {
        return;
    }

    Object.defineProperty(node, 'scrollHeight', {
        configurable: true,
        get(this: HTMLTextAreaElement): number {
            const natural = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')?.get;
            const inline = this.style.height;
            this.style.height = '0px';
            const collapsed = natural?.call(this) as number;
            this.style.height = inline;
            const computed = getComputedStyle(this);

            return Math.max(0, collapsed - pixels(computed.paddingTop) - pixels(computed.paddingBottom));
        },
    });
}

/**
 * Give a field element React Native's `setSelection(start, end)`, which react-native-web's TextInput lacks. A native
 * component that selects text on mount (the Combobox) calls it through its ref, and the DOM's own `setSelectionRange`
 * does the same job.
 *
 * Scoped: the method is defined on this one element, never on an element prototype.
 *
 * @sideEffect Defines a property on the element.
 * @param node - The input or textarea react-native-web rendered.
 */
export function addSetSelection(node: HTMLInputElement | HTMLTextAreaElement): void {
    if (Object.hasOwn(node, 'setSelection')) {
        return;
    }

    Object.defineProperty(node, 'setSelection', {
        configurable: true,
        value(this: HTMLInputElement | HTMLTextAreaElement, start: number, end?: number): void {
            this.setSelectionRange(start, end ?? start);
        },
    });
}

/** Adapts the host element to the device TextInput. A stable function, so React attaches it once. */
function adaptHost(instance: WebTextInputInstance | null): void {
    const host: unknown = instance;

    if (host instanceof HTMLTextAreaElement) {
        reportTextHeight(host);
    }

    if (host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement) {
        addSetSelection(host);
    }
}

/**
 * The web TextInput with the device's behaviour: a multiline field reports its text height, every field offers
 * `setSelection`, and every field shrinks in a flex row as a device's does.
 */
export const TextInput = forwardRef<WebTextInputInstance, TextInputProps>(function TextInput(props, forwarded) {
    return createElement(WebTextInput, {
        ...props,
        style: [DEVICE_FLEX_ITEM, props.style],
        ref: useComposedRefs(forwarded, adaptHost),
    });
});

/**
 * A device's layout engine (Yoga) gives every flex item a minimum size of 0, and react-native-web's View does the same,
 * but its TextInput renders a bare `<input>`, whose CSS minimum is its intrinsic width. A field set to `flex: 1` beside
 * a button then refuses to shrink and pushes the button out of its row, which a device never does. The caller's own
 * `style` comes after this, so an explicit minimum still wins.
 */
const DEVICE_FLEX_ITEM = { minWidth: 0 } as const;

type WebTextInputInstance = InstanceType<typeof WebTextInput>;
