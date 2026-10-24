# Builder brief: redesign one group of canvas boards

You apply a finished redesign to existing screen boards. You decide nothing new: every visual rule comes from the
documents below. If the spec does not cover a case, choose the option closest to the Home boards and list it in your
report.

## Read first

1. `docs/design/uiRefreshWorkshop5/redesignCanvas/redesignSpec.md`: the system, and the notes for your rows.
2. `docs/design/uiRefreshWorkshop5/redesignCanvas/tokens.css` and `redesign.css`: what already changes globally.
3. `docs/design/uiRefreshWorkshop5/ownerFeedback.md`: the owner's decisions. Every board keeps them.
4. Worked examples: the 15 redesigned Home boards in `redesignCanvas/boards/`. Compare each one with its legacy copy
   in `packages/tools/designArtifact/dist/canvas/project/` to see the kind of edit expected.
5. For Recipe detail only: `docs/design/uiRefreshWorkshop5/pilot/round9/mockup.html`, `mockupWide.html` and `spec.md`.

## What to do for each board in your group

1. Copy the legacy board from `packages/tools/designArtifact/dist/canvas/project/<Name>.dc.html` to
   `docs/design/uiRefreshWorkshop5/redesignCanvas/boards/<Name>.dc.html`. Keep the file name exactly.
2. Edit the copy:
    - Type: only 13, 15 and 17 px, plus one 28 px title per screen. Weights 400 to 600. No text is under 13 px. If
      the spec keeps an 11 px overline, that one is allowed.
    - Color: only the redesign tokens (`var(--…)`), no raw hex. Steel marks what to act on. It never fills a large
      surface.
    - Layout and patterns: apply your rows' notes in the spec, and every owner decision that applies to the board.
    - Keep the board's width, its states, its real components (`x-import`), its copy and its `<script>` block, unless
      the spec changes them.
3. Keep the `.dc.html` format valid: close every element, quote every attribute, keep the `support.js` line.

Do not edit anything outside `redesignCanvas/boards/`. Do not edit `tokens.css`, `redesign.css`, `redesignSpec.md`,
the assembler or another group's boards. If a global change is needed, put it in your report.

## Check your work

Assemble into your own folder and render your boards. Replace `<group>` with your group name and list your board
names (without `.dc.html`) at the end:

```bash
S=/tmp/claude-1000/-home-brandon-Development-KitchenSink/7091c8e5-d5b1-4d19-bb4d-8da0ff6bbb8c/scratchpad
python3 docs/design/uiRefreshWorkshop5/redesignCanvas/assembleRedesign.py $S/rc<group>
mkdir -p $S/rr<group>
cp $S/renderCanvasTmp.ts packages/tools/designArtifact/renderCanvas<group>Tmp.ts
cd packages/tools/designArtifact && PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH DESIGN_CANVAS_RUNTIME=$S/liveRuntime/artifact-type/dc-runtime.js npx tsx renderCanvas<group>Tmp.ts $S/rc<group>/project $S/rr<group> light,dark <Board1> <Board2> > $S/rr<group>/metrics.json; rm -f renderCanvas<group>Tmp.ts
```

The metrics list text sizes, text under 11 px, weights over 600, overflow and script errors per board and theme.
Sizes above 40 px are icon glyphs and photo placeholders, so ignore them. Fix every board until it has no errors, no
overflow, no weight over 600, and only the allowed sizes. Then open at least one light and one dark screenshot per row
and look at it. A board must look like the Home boards, not only pass the numbers.

## Report

Five lines or fewer: how many boards you finished, any you did not finish, any spec gap you filled and how, and any global
change you need.
