# Design canvases

The Commise design system and the screen mockups are claude.ai artifacts. This folder is where every agent finds
them, and it holds the rules for editing them without losing another agent's work.

`registry.json` lists every canvas: its link, what it holds, its status and its source. It is the only list. Do not
copy links into other documents. Link to this folder instead. `designCanvasRegistry.test.ts` in `packages/tools/repoGuards`
checks its shape.

Each page and feature canvas has a folder here, named by its registry id and given in its `snapshot` field. The folder
is a byte-for-byte snapshot of that canvas's published files, taken on 2026-11-15. Its `snapshot.json` records the
link, the version read and the time. The published canvas stays authoritative until the owner moves the canvases to a
repo-source workflow. Never edit a snapshot to change a design.

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

## Repo-source canvases (`repo-canvas`)

A canvas follows this section once its registry `source` is `repo-canvas`. Until then it stays `live` and follows the
sections above. A `repo-canvas` entry has a `folder`: `docs/design/canvases/<folder>/` holds `snapshot.json` and
`project/…`, the files of the artifact. The repository folder is the truth. The live canvas is a copy that a publish
from `main` refreshes.

### Edit

Work on a branch, in your own worktree, in `docs/design/canvases/<folder>/project/`. Never edit or publish a
registered canvas live. Never put `index.html`, `SKILL.md`, `artifact-type/` or `project/published.json` in the folder:
the artifact type owns the first three, and the publish writes the marker.

### Preview

To show work in progress, publish the branch files to an artifact that is not in the registry. Delete that artifact
after the PR merges.

### Check before merge

- The repo guards pass.
- The LOCAL e2e renders every changed board in light and dark. `CANVASES=all` renders every canvas, and you run it
  before a publish.
- The designer approves the PR.

### Publish from main

Run these from a clean checkout after `git fetch origin main`. Only the `Artifact` tool can read and publish.

1. **Plan.** `npm run canvas:publishPlan --workspace=packages/tools/designArtifact -- plan --live <dir>`. It prints,
   for each `repo-canvas` entry, the baseline (the live marker, or the snapshot commit when there is no marker), the
   changed and deleted paths, and what to download. Skip a canvas with status `unchanged`.
2. **Read.** For each canvas, download the paths in `download` with the `Artifact` tool (`action: "read"`) into
   `<dir>/<folder>/`. Also save the `action: "list"` result as a JSON array of paths.
3. **Check.** `… -- check <id> --main <sha> --live <dir> --list <list.json>`. Exit 0 is clean. A live file passes when
   it equals the baseline or `main`. Exit 1 is drift: stop and follow "Drift". Exit 2 is bad input.
4. **Stage.** `… -- stage <id> --main <sha> --live <dir> --list <list.json> --out <out>`. It checks again, writes the
   `main` blobs from git (a dirty work tree cannot leak in) and the marker outside the canvas folder, and prints the
   `url`, `root` and `files` for the publish.
5. **Publish.** Pass that output to the `Artifact` tool unchanged. `files` is the dict form: a deletion is `null`.
   Never pass `force`. If the publish is refused, restart at step 2 for that canvas.

### Drift

The check found a live edit that the repository does not have. Import the live files into the folder in a PR titled
`canvas drift: <id>`, merge it, then publish. After that merge the live file equals `main`, so the check passes.

### Rollback

`git revert` the merge on `main`, then publish.

## Comments

Claude can reply to and resolve only a thread that a person sent to Claude ("Send to Claude", or `@claude` in the
thread). A comment wakes a session only while that session watches the canvas. If you are working on a canvas, start
a watch with `ArtifactComments` (`action: "watch"`) so new comments reach you while you work.

## When a canvas is created, renamed or retired

Update `registry.json` in the same change. A canvas that is not in the registry does not exist for other agents.
