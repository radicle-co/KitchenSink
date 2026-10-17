# @kitchensink/design-artifact

This package builds two claude.ai artifacts from the Commise sources:

- the **Design System**: tokens, fonts, one bundle of the real components, and a card per component.
- the **screens canvas**: the app's screens as artboards that mount those components.

Nothing in it is hand-copied from the product. The bundle compiles the real web leaves (`window.Commise`) and the real React Native leaves through react-native-web (`window.Commise.Native`). The tokens come from `@commise/ui`'s own exports.

## Build

```bash
npm run artifact:build --workspace=@kitchensink/design-artifact
```

The build writes `dist/designSystem/project` and `dist/canvas/project`. Each directory is laid out exactly as its artifact expects. If a card or a board names a component the sources do not export, the build fails and writes nothing.

To link the canvas to a published Design System, set both of these variables before the build:

- `DESIGN_SYSTEM_ARTIFACT_URL`: the system's claude.ai link.
- `DESIGN_SYSTEM_ARTIFACT_VERSION`: its revision.

If you set neither, the canvas carries no design-system link. If you set only one, the build stops.

## Publish

Publishing is manual, because only the Artifact tool can write to claude.ai. Publish `dist/designSystem/project` to the system artifact, then `dist/canvas/project` to the canvas artifact. The README in the system names the commit it was built from. When the tree had uncommitted changes, it says so.

## Tests

| Tier        | Command                    | Where it runs              |
| ----------- | -------------------------- | -------------------------- |
| Unit        | `npm run test`             | CI                         |
| Integration | `npm run test:integration` | CI                         |
| LOCAL e2e   | `npm run test:e2e`         | a developer's machine only |

The LOCAL e2e renders every card and every board in Chromium, in light and dark. It needs three things. If one is missing, its setup stops with instructions:

1. **Chromium for Playwright**, installed under `~/.cache/ms-playwright`.
2. **The canvas runtime.** Set `DESIGN_CANVAS_RUNTIME` to a local copy of `support.js`. The claude.ai platform supplies that file to every canvas, and this repository must not vendor it. To get a copy, read any Design canvas artifact with the Artifact tool's `read` action and `path` set to `artifact-type/dc-runtime.js`.
3. **Network access to jsDelivr, once.** The cards run on React 18.3.1, as the artifact host does. The suite downloads the two React files, checks each against a pinned SHA-384 hash, and caches them under `node_modules/.cache/designArtifact`.
