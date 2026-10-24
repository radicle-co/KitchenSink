/**
 * react-native-web ships no types. Its API is react-native's, so the module is typed as react-native's: an Adapter
 * written against it is then checked against the real React Native surface. The members it has and React Native's
 * types no longer carry are declared as opaque, because nothing here calls them: they are re-exported untouched.
 */
declare module 'react-native-web' {
    import type { ComponentType } from 'react';

    export * from 'react-native';

    export const CheckBox: ComponentType<Record<string, unknown>>;
    export const Picker: ComponentType<Record<string, unknown>>;
    export const ProgressBar: ComponentType<Record<string, unknown>>;
    export const YellowBox: unknown;
    export const render: (...args: readonly unknown[]) => unknown;
    export const unmountComponentAtNode: (...args: readonly unknown[]) => unknown;
    export const unstable_createElement: (...args: readonly unknown[]) => unknown;
    export const useLocaleContext: () => unknown;
}
