# Critique 3: Pilot Light and Fresh Cut

**Designer 3.** Contrast numbers below were computed from the hex values in each option (WCAG 2.x formula).

## Option 1: Pilot Light

**Fresh?** Yes, and nowhere near paper or cream. Cool fog and cast iron feel new. But it is so quiet that it can
read as a tidy utility app. Almost colourless is a risk with an owner who asked for visual excitement. The dish art
is a plate seen from above, which echoes The Table.

**Simple?** Very. Standard header, lists, chips, segmented control, five tabs. One small trap: the glowing "Cooked
last" tile has no chevron, while every list row does. It must look just as tappable. "Tap a step to make it current"
is today's behaviour, so it is fine.

**Palette.** Best defined of the two: one job per colour, and written pairing rules. The numbers hold: white on
ember 6.18, ember on sunk 4.97, pewter on ground 3.47. Two gaps. Ember `#B3330E` and beet `#A3173F` differ by only
1.23:1. To most eyes, primary and danger are the same red. Distance in the layout is not enough. Saffron is
1.71:1 on fog, so the glow carries no edge. It works only because the pill says "Cooked last" in words.

**Keep:** "One light per screen, and none where nothing is now." It is a rule anyone can follow.

**Fix:** move danger off the ember hue (a cool plum or a deeper wine with a clear hue gap). Stop the 9 s breathing
loop on Home: ambient motion that never ends is not calm. Add the chevron to the lit tile.

**One push:** let the light be real light. Tint the dish art and the top of the screen with the saffron glow. Then the
warm pool feels lit, not just filled with a pale colour.

## Option 2: Fresh Cut

**Fresh?** The freshest of the two. Flat produce cut-outs are bright, modern and food-led, and they solve the "no
photo" problem with joy. No slide back to the old look.

**Simple?** Mostly. Two things to check. A carousel hides most recipes off screen. A short plain list under it
is more obvious. A list/grid toggle plus a segmented control plus chips is a lot of controls on one header.

**Palette.** Good names, clear logic. Three problems:

- Tomato `#B83419` vs chili `#B0241B`: 1.14:1. Primary and danger are the same colour.
- Rind passes on surface (3.52:1) but drops to 2.90:1 on shell `#E7EAE5`. Today no rind edge sits on shell, so
  write that down as a rule. Unselected chips have no edge at all: shell on rinse is 1.12:1.
- Blueberry as the current step makes "now" the coldest colour in a warm food app.

**Keep:** the art. It gives every recipe a face from day one and needs no explaining.

**Fix:** a separate danger hue, rind darkened to `#7A7F79` (3.37:1 on shell) so it is safe anywhere, a warm "now"
colour. The 40-shape art set is the real cost. Prove it on 20 real recipes before committing.

**One push:** let the art set the screen's tint. A pale wash from the lead ingredient behind the detail sheet makes
each recipe feel like its own place.
