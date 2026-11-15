# Design canvases

The Commise design system and the screen mockups are claude.ai artifacts. This folder is where every agent finds
them, and it holds the rules for editing them without losing another agent's work.

`registry.json` lists every canvas: its link, what it holds, its status and its source. It is the only list. Do not
copy links into other documents. Link to this folder instead. `designCanvasRegistry.test.ts` in `packages/tools/repoGuards`
checks its shape.

## What each kind means

| Kind           | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `designSystem` | The Design System: tokens, fonts and a card per component.          |
| `page`         | The screens of one page of the app, such as Home or Recipe detail.  |
| `feature`      | The screens of one feature, such as Meal planning or Grocery lists. |
| `unused`       | A canvas that holds nothing.                                        |

## What each status means

| Status    | Meaning                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `current` | The canvas to read and edit. Every page and every feature has one web canvas and one mobile canvas.          |
| `archive` | An older canvas that holds web and mobile together. Do not make new changes there. Read it for history only. |
| `unused`  | A canvas that holds nothing. Do not use it.                                                                  |

The owner can still leave a comment on an archive canvas. Answer it in that thread. Make the change on the `current`
web and mobile canvases for the same subject, and say so in the reply.

## What each source means

| Source | Where the truth lives                     | How to change it                                                                                                                                                                                 |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repo` | The repository. Only the Design System.   | Change `@commise/ui` or `packages/tools/designArtifact`, then follow "Regenerate the artifacts" in that package's README. Never edit the artifact directly: the next regeneration overwrites it. |
| `live` | The published canvas itself. All screens. | Read the live canvas, edit it, and publish it back to the same link (the steps below).                                                                                                           |
| `none` | Nothing. Only an `unused` canvas.         | Do not change it.                                                                                                                                                                                |

The screen canvases have no build that can recreate them. The first build scripts are on the unmerged branch
`docs/offline-start-adr`, and `docs/design/uiRefreshWorkshop5/redesignCanvas/assembleRedesign.py` is on main. Owner
comments and agent edits were made on the live canvases after those scripts last ran. Running one over a live canvas
deletes those edits. Use them only to create a new canvas.

## How to edit a screen canvas

1. Find the canvas in `registry.json`. Use the `current` web and mobile canvases for the subject. A change to a screen
   that exists on both platforms goes on both canvases in the same task.
2. Read its comments first, with the `ArtifactComments` tool (`action: "read"`). An open owner comment can change
   what you are about to do.
3. Read the live canvas with the `Artifact` tool (`action: "read"`). Download only the files you change with `path` or
   `paths`, into your scratchpad. Never start from a copy you saved earlier, from another worktree, or from a build.
4. Make the change, then publish only the files you changed to the same `url`, with `files`. Files you leave out stay
   as they are, so you cannot delete another agent's boards by accident.
5. If the publish is refused because the canvas changed, another agent published after your read. Merge your change
   onto the version the refusal hands you and publish again. Never pass `force`.
6. Reply in any comment thread you acted on, then resolve it.

## Bulk changes across many canvases

A change that touches many canvases (for example, a new tab in every tab bar) follows the same steps for each canvas:
read the live files, patch them, publish only the changed files. Commit the patch script under
`docs/design/canvases/scripts/` before you run it, so another agent can rerun or extend it. A restart of the machine deletes
scratchpad folders.

## Comments

Claude can reply to and resolve only a thread that a person sent to Claude ("Send to Claude", or `@claude` in the
thread). A comment wakes a session only while that session watches the canvas. If you are working on a canvas, start
a watch with `ArtifactComments` (`action: "watch"`) so new comments reach you while you work.

## When a canvas is created, renamed or retired

Update `registry.json` in the same change. A canvas that is not in the registry does not exist for other agents.
