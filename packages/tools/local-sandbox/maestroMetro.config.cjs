/**
 * The mobile app's own Metro config, with its developer-local `.env` overrides hidden — for `local:maestro` only.
 *
 * ⛔ WHY THIS EXISTS. In a DEV bundle Expo does not inline `EXPO_PUBLIC_*`: it bundles the project's `.env` files as
 * modules and spreads them OVER `process.env` (`@expo/metro-config` `transform-worker.js`, the `expo/virtual/env`
 * branch), so `EXPO_NO_DOTENV` and an exported variable both lose to a file. The app's `.env.local` names a deployed
 * preview, so the first proof run signed in on the device and then read `recipe-pr-91` while the seeder wrote to the
 * local database: an empty library, and a flow failing on a control the empty state does not draw.
 *
 * Hiding `.env.local` / `.env.development.local` from Metro's file map leaves the committed `.env.development` — the
 * canonical local ports — and the runner reverses those ports onto the local sandbox. The runner then checks the
 * served bundle names no deployed host, so a change in how Expo resolves env cannot pass silently.
 *
 * Loaded through `EXPO_OVERRIDE_METRO_CONFIG`, which Expo documents in its source as internal and unstable — the
 * bundle check is what makes relying on it safe.
 */
const path = require('node:path');

const mobileDir = path.resolve(__dirname, '../../apps/commise/mobile');
const config = require(path.join(mobileDir, 'metro.config.cjs'));

/** Escape a path for use inside a RegExp. */
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hidden = ['.env.local', '.env.development.local'].map(
    // ⚠️ No flags: Expo composes every blockList pattern into one RegExp and refuses patterns whose flags differ.
    (file) => new RegExp(`^${escape(path.join(mobileDir, file))}$`),
);
const existing = config.resolver?.blockList;

module.exports = {
    ...config,
    resolver: {
        ...config.resolver,
        blockList: [...(existing === undefined ? [] : [existing].flat()), ...hidden],
    },
};
