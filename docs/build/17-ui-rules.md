# 17 — UI rules (checklist for every screen)

Defaults for how we build the apps. They govern our build, not what users do in the app: never add
warnings or nudges that push users (e.g. a business picking a brand colour) to follow them.
Many users are on a phone with one hand — the mobile rules are essential.

1. **Basics** — body contrast ≥4.5:1; one primary (filled) button per view, others outlined/neutral;
   every input has a visible label above it (placeholders are examples only); buttons say what
   happens ("Șterge ocazia" / "Păstrează", never "OK"); related items close, unrelated spaced;
   left-align text longer than two lines; icon-only buttons get `aria-label`; meaningful images get
   alt text, decorative `alt=""`; SVG icons, no emoji.
2. **Spacing** — one scale only: 4, 8, 16, 24, 32 (48/64 for big sections). Label closer to its own
   field than to the field above. More space between groups than within. One alignment edge. Cards
   padded ≥16px. Nested radius = outer radius − padding.
3. **Type** — body line-height 1.4–1.6; line length 45–75ch (cap column width); headings clearly
   bigger/bolder; ALL CAPS only for short labels with letter-spacing; max two typefaces; tighten
   tracking on large headings.
4. **Colour** — one accent for actions, rest neutral; never colour alone (errors get words + icon);
   red = danger, green = success, always; check contrast on coloured buttons; tint large areas
   softly; links get colour and underline.
5. **Mobile** — tap targets ≥44×44 with space between; main action at the bottom in thumb reach;
   inputs ≥16px text; right keyboard via `inputMode`/`type`; no hover-only actions; bottom sheets
   over centred dialogs.
6. **Dashboards** — lead with the one number that matters, large; every number has a period and a
   change; bar charts start at zero; >3 parts of a whole → sorted horizontal bars, not a pie;
   right-align numbers with tabular figures; highlight one series, grey the rest.
7. **Dark mode** — dark grey background, not black; off-white text; lighter, less saturated accent;
   raise surfaces with lighter greys, not shadows; secondary text still ≥4.5:1; dim bright images.
8. **Keyboard** — everything reachable with Tab and usable with Enter/Space in a sensible order;
   visible focus ring; focused items never hidden under sticky bars (`scroll-margin`); dialogs/sheets
   take focus on open, return it on close, Escape closes.
9. **Forms** — each error next to its field, in words, saying how to fix it; never clear typed input;
   on failed submit focus the first invalid field; validate on blur/submit, not per keystroke.
10. **Loading** — reserve space (skeletons, width/height) so nothing jumps; feedback within ~100ms;
    disable a button while its action runs and say what is happening ("Se salvează…"); clear empty
    states (what is missing + the action to add it) and error states with retry.
11. **Motion** — respect `prefers-reduced-motion`; 150–300ms, exits faster; animate only
    transform/opacity; motion explains, never decorates.
