# 0092: Canvas images are canvas files, stored with Git LFS

- **Status**: Accepted
- **Date**: 2026-11-15
- **Drivers**: The owner's rulings of 2026-11-15. Keep the design canvases' images in git with Git LFS, and keep the
  boards in plain git. Store each image as a canvas file, so previews, copied boards and new images show no broken
  images ("Ok do it").
- **Relates to**: `docs/design/canvases/README.md`, which makes the repository folder the source of every screen
  canvas.

## Context

A screen canvas is a claude.ai Design artifact mirrored into `docs/design/canvases/<folder>/project/`. Its boards
showed photos through uploads, `url(/_blob/<id>)`. An upload lives in one artifact's own store, and its id belongs to
that artifact. So git held only the ids, and an id resolved only on the canvas that issued it:

- A preview canvas, a board copied to another canvas and the local render check all showed broken images.
- A new image needed an upload to the live canvas before its branch merged.
- Losing a canvas lost its photos.

A Design canvas also serves its own files by relative path, as the mobile canvases already do with their fonts in
`project/ds/commise/fonts/`. A test canvas published on 2026-11-15 showed `url(assets/<file>.webp)` photos.

The 1,780 boards that used uploads referenced 344 uploads, which held 7 distinct images, 242,708 bytes in all.

## Decision

1. **Images are canvas files.** Each canvas keeps its images in `project/assets/`, named by the first 16 hex characters
   of the image's SHA-256 (`5024d8f60c578f87.webp`). Boards reference them by relative path:
   `url(assets/5024d8f60c578f87.webp)`. No board uses `/_blob/`. The same photo has the same name in every canvas.
   If the photo is in both canvases, a board copied from one to the other keeps working.
2. **The images are stored with Git LFS, and nothing else is.** `.gitattributes` gives
   `docs/design/canvases/*/project/assets/**` the LFS filter. Boards and `canvas.json` stay plain git, so a PR shows
   their diffs and the guards read their text.
3. **Images download only on request.** `.lfsconfig` excludes them from default fetches, so clones, worktrees and CI
   download none. The LOCAL render check pulls the folders it renders.
4. **The publish tool handles LFS.** It reads an image's real bytes through the LFS filter and refuses to publish
   pointer text. It hashes a downloaded live image through the same filter, so the image matches its git entry.
5. **`.husky/pre-push` runs `git lfs pre-push`**, so a push uploads the images it references.
6. **`designCanvasFolders.test.ts` holds the rules**: no `/_blob/` reference, every referenced asset exists in the same
   canvas, no unreferenced asset, every asset stored as an LFS pointer, and no LFS path outside the canvases' assets.

## Alternatives rejected

- **Keep the upload ids and import the images beside the folder.** Previews and copied boards still break, and a new
  image still needs a live upload before merge. Each case needs its own tool step.
- **Boards in LFS too.** Boards are text. In LFS, review shows no diff for them, and CI and the guards get pointer
  files instead of boards.
- **Plain git for the images.** At 242,708 bytes this costs the same storage. LFS was the owner's choice, and the
  opt-in fetch keeps image downloads off every clone.

## Consequences

- GitHub's free plan includes 10 GiB of LFS storage and 10 GiB of LFS bandwidth a month, public repos included. The
  images are a small fraction of that, and default clones fetch none.
- Every machine that commits a canvas image needs `git-lfs` and the repo's LFS filters (`git lfs install --local
--skip-repo`). The guard fails a commit that stores raw bytes.
- The first publish of each canvas after this change uploads its images as files. The old uploads stay in each store,
  unused.

## Residual risk

- **A one-way door.** The image bytes live in GitHub's LFS store, not in git objects. Leaving LFS later means
  `git lfs migrate export` or keeping LFS for old commits.
- **A missing LFS object.** A branch pushed without the pre-push hook can reference an image its remote lacks. The
  render check and the publish tool fail with the pull command rather than showing or publishing a pointer.
