---
name: designCanvases
description: Find, read, edit or answer comments on the Commise design canvases on claude.ai, which hold the screen mockups (boards) for every page and feature, on web and mobile, and the Design System. Use it before any work that looks at, compares against, changes or reviews a Commise screen design, board, mockup or canvas, or the Design System artifact, and before replying to a comment on one.
---

# Commise design canvases

The screen designs and the Design System are claude.ai artifacts, not files in this repository. Several agents edit
them at the same time, so follow these steps exactly.

## Find the canvas

Read `docs/design/canvases/registry.json`. It lists every canvas with its link, subject, platform, status and source.
Use the entries with status `current`. Each page and feature has one `web` canvas and one `mobile` canvas. A link that
is not in the registry is not a canvas to work on. Read `docs/design/canvases/README.md` for what each status and
source means.

## Change a screen canvas (source `live`)

1. Read the canvas's comments with `ArtifactComments` (`action: "read"`). Do this first, because an open owner comment
   can change the work.
2. Start a watch with `ArtifactComments` (`action: "watch"`), so new comments on it reach you while you work.
3. Read the live canvas with `Artifact` (`action: "read"`), and download only the files you will change (`path` or
   `paths`). Never start from a saved copy, another worktree or a build.
4. Make the change. If the screen exists on both platforms, change the web canvas and the mobile canvas in the same
   task.
5. Publish only the changed files to the same `url`, with `files`. The files you leave out stay as they are.
6. If the publish is refused because the canvas changed, merge onto the version the refusal hands you, then publish
   again. Never pass `force`.
7. Reply in each comment thread you acted on, then resolve it.

## Change the Design System (source `repo`)

Never edit the artifact. Change `@commise/ui` or `packages/tools/designArtifact`, then follow "Regenerate the
artifacts" in `packages/tools/designArtifact/README.md`.

## A change across many canvases

Write the patch as a script under `docs/design/canvases/scripts/` and commit it before you run it. The script reads
each live canvas, patches the files and publishes only the changed files. Do not run the old build scripts on the
branch `docs/offline-start-adr` over a live canvas: they rebuild boards from old sources and delete later edits.

## Keep the registry true

When you create, rename or retire a canvas, update `registry.json` in the same change. The guard
`packages/tools/repoGuards/__tests__/designCanvasRegistry.test.ts` checks its shape.
