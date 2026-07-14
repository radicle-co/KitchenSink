// Ambient declarations for the @formatjs Intl polyfill side-effect imports (they ship no types for their
// `/polyfill` and `/locale-data/*` subpaths). Imported for their side effects only in App.tsx to give
// Hermes the `Intl.PluralRules` the shared recipe formatters need.
declare module '@formatjs/intl-getcanonicallocales/polyfill';
declare module '@formatjs/intl-locale/polyfill';
declare module '@formatjs/intl-pluralrules/polyfill';
declare module '@formatjs/intl-pluralrules/locale-data/en';
