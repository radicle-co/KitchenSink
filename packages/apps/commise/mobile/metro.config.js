// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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
