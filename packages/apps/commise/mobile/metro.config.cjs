// CommonJS (.cjs) because this package is "type": "module"; Metro's getSentryExpoConfig is CJS.
//
// THE single Metro config for this app. There used to be a second `metro.config.js` carrying the
// extension-rewrite resolver below, and because Metro's config lookup prefers `metro.config.js` over
// `metro.config.cjs`, that file WON and this one was dead — silently disabling the Sentry Debug IDs, so
// EAS uploads could not symbolicate (U10 / U11). The two are merged here and the `.js` is deleted: one
// config, `.cjs` so `require` stays valid under `"type": "module"`.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Stamps unique Debug IDs onto bundles + source maps so EAS uploads symbolicate (U10 / U11).
const config = getSentryExpoConfig(__dirname);

// The codebase uses NodeNext-style relative imports that carry a `.js`/`.jsx` extension even though the
// source file is `.ts`/`.tsx` (tsc and vitest map these transparently; Metro does not). Rewrite a failed
// `./x.js` → `./x.ts`/`.tsx` (and `.jsx`) at resolution time so Metro bundles the same source the type
// checker and unit tests see, without touching import sites.
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
    const rewritten = moduleName.replace(/\.jsx?$/, '');
    if (rewritten !== moduleName && (moduleName.startsWith('./') || moduleName.startsWith('../'))) {
        try {
            return context.resolveRequest(context, rewritten, platform);
        } catch {
            // Fall through to the default resolver (which reports the original, clearer error).
        }
    }

    return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
