# @kitchensink/design-artifact

This package builds two claude.ai artifacts from the Commise sources:

- the **Design System**: tokens, fonts, one bundle of the real components, and a card per component.
- the **screens canvas**: the app's screens as artboards that mount those components.

Nothing in it is hand-copied from the product. The bundle compiles the real web leaves (`window.Commise`) and the real React Native leaves through react-native-web (`window.Commise.Native`). The tokens come from `@commise/ui`'s own exports.

## The two artifacts

| Artifact       | Link                                              | Built into                  |
| -------------- | ------------------------------------------------- | --------------------------- |
| Design System  | https://claude.ai/artifact/DN1aFbTBJKfW7bbgDdnzye | `dist/designSystem/project` |
| Screens canvas | https://claude.ai/artifact/NgDDxhpxbSgQ48NZbsAWdv | `dist/canvas/project`       |

Both are private to the owner. The canvas records one exact version of the Design System, so the system is always published first.

## Regenerate the artifacts

"Regenerate the design system and screens" means: build both artifacts from the current sources, publish the Design System, then rebuild the canvas against that new version and publish it.

Only the claude.ai Artifact tool can publish. A person runs steps 1 to 3 and then asks Claude Code to "regenerate the design system and screens". An AI agent does every step.

### Before you start

1. Use Node 24. Run `node --version` and make sure that it prints `v24`.
2. If `node_modules` is missing or out of date, run `npm ci` from the repo root.
3. Check out the commit you want to publish. The Design System's README records the commit it was built from. If the tree was dirty, it adds "plus uncommitted changes". Publish from a clean tree.

### Steps

1. From the repo root, build the packages the builder reads:

    ```bash
    npx turbo run build --filter=@kitchensink/design-artifact^...
    ```

2. Run the checks. If one fails, stop and fix it before you publish:

    ```bash
    npm run typecheck --workspace=@kitchensink/design-artifact
    ```

    ```bash
    npm run test --workspace=@kitchensink/design-artifact
    ```

    ```bash
    npm run test:integration --workspace=@kitchensink/design-artifact
    ```

    The LOCAL e2e (`npm run test:e2e`) renders every card and board in a browser. If its requirements are met, run it too (see [Tests](#tests)).

3. Build both artifacts:

    ```bash
    npm run artifact:build --workspace=@kitchensink/design-artifact
    ```

    The build prints "78 component cards" and "27 boards" (or the current counts) and writes `dist/designSystem/project` and `dist/canvas/project`. If a card or a board names a component that the sources do not export, the build fails and writes nothing.

4. Publish the Design System (AI only, see [Publishing with the Artifact tool](#publishing-with-the-artifact-tool)). The publish result reports a version id, for example `Version 9, version id 1792210447-a7b4`. Keep the version id.

5. Rebuild with the link to that version. Set both variables, or the build stops:

    ```bash
    DESIGN_SYSTEM_ARTIFACT_URL=https://claude.ai/artifact/DN1aFbTBJKfW7bbgDdnzye DESIGN_SYSTEM_ARTIFACT_VERSION=<version id from step 4> npm run artifact:build --workspace=@kitchensink/design-artifact
    ```

    `dist/canvas/project/canvas.json` now names that version under `designSystems`. Do not publish the Design System again from this build. Only the canvas records the link, so the system published in step 4 stays current.

6. Publish the canvas (AI only).

7. Make sure that both publishes worked (see [Check the result](#check-the-result)).

### Publishing with the Artifact tool

Each artifact was created from a claude.ai Artifact type. The type owns `index.html`, `SKILL.md` and everything under `artifact-type/`. Never send those files. You publish only the files under `project/`.

Do these steps for each artifact, the Design System first:

1. Read the artifact first: `Artifact` with `action: "read"`, the artifact's `url`, and `path: "project/README.md"`. A publish to an artifact that the conversation has not read is refused.
2. List its published files: `action: "list"`, `scope: "files"`, and the `url`. Compare the `project/` paths with the files in the dist folder. A path that is live but absent from the build is stale. Remove it with a `null` entry in the `files` map form, for example `{"project/components/Old/preview.html": null}`.
3. Publish with these inputs:

    | Input       | Design System                                                       | Canvas                                             |
    | ----------- | ------------------------------------------------------------------- | -------------------------------------------------- |
    | `url`       | the Design System link                                              | the canvas link                                    |
    | `root`      | `<repo>/packages/tools/designArtifact/dist/designSystem`            | `<repo>/packages/tools/designArtifact/dist/canvas` |
    | `file_path` | `<root>/project/design-system.json`                                 | `<root>/project/canvas.json`                       |
    | `files`     | every other file under `<root>/project`, as `{"path": "project/…"}` | the same                                           |

    Generate the `files` list from the folder, for example `find project -type f | sort` run in `<root>`, so that no file is missed.

4. Send `project/components/index.d.ts` with `"contentType": "text/plain"`. The host does not serve `.ts`, and without the content type the whole publish is refused. Every other file type is inferred.
5. Do not pass `force`. If the publish reports a newer live version, read the artifact again and publish again.

### Check the result

1. List the files of each artifact again. Every file in the dist folder is listed, and no stale `project/` path remains.
2. Read `project/README.md` from the Design System. Its last line names the commit you built from, with no "plus uncommitted changes".
3. Read `project/canvas.json` from the canvas. The `version` under `designSystems` equals the Design System version id from step 4.

## Add a board

A board is one screen in one state, drawn twice: `Name.dc.html` for web (1280 px wide) and `NameMobile.dc.html` for mobile (390 px wide). Boards live in `content/canvas/boards/`.

1. Start from the board of the same screen. Copy it, and keep only the part that the state changes.
2. Draw components from the bundle (`Commise.X` on web, `Commise.Native.X` on mobile). Draw by hand only what the bundle does not export.
3. Take every list, status line and label from the app's own pure model, not from memory. Write a scratch vitest file in the feature package that calls the model with the package's own fixtures and prints the props as JSON. Delete the scratch file after the run.
4. To show a `Combobox` list open, set `focus-requested`, `list-requested` and `on-focus-request-handled`. The web list floats below the field, so give the web board room under the field for it.
5. Add the board to `src/canvas/boards.ts`. The title ends with `(web)` or `(mobile)`, and a board that shows an unbuilt change has `proposal` in its title. Boards of one row stay together.
6. Render the board at its width and set `height` to the rendered page height. On web, add the room that a floating list needs.
7. Run the unit, integration and LOCAL e2e tiers. The unit tests pin the board count, the row count and some canvas positions. When you add boards, update those numbers.

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
