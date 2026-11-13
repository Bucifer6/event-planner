# 16 — "Maison": the EventDesk design language

EventDesk should feel like stationery from a couture house, not like software: ivory paper,
midnight ink, a single hairline of gilt. It replaces the PRD §21 "Garden Soirée" look (owner's
decision). The behavioural gates of §21 remain: AA contrast, 44px targets, phone first, honest paid
label, "unknown" never shown as zero.

Everything lives in `packages/ui` (`@ed/ui`): `tokens.css`, `base.css`, `components.css`,
`shell.css`, `components.tsx` (server-safe), `client.tsx` (interactive), `icons.tsx`.

## The idea in five rules

1. **Tailored, not rounded.** Corners are square (`--radius: 2px`). No shadows, no gradients, no
   pills. Structure comes from hairlines (`--line`) and white space.
2. **Two voices.** *Bodoni Moda* (display serif, with its italic) speaks for the occasion: titles,
   figures, the invitation. *Hanken Grotesk* does the work: body, forms, tables. Small labels are
   Hanken in tracked capitals (`.ed-label`, `Eyebrow`). Nothing else — no mono, no third face.
3. **One action colour.** `--accent` (bleu nuit) is used only for the primary action, links and
   focus. Everything else is ink on paper. Red means danger, green means done, amber means
   attention — always with words and a mark, never colour alone.
4. **Gilt is jewellery.** `--gilt` appears as hairlines, the seal, the inset plate-mark of a framed
   card, the italic index numerals. Never as a fill, never for body text (`--gilt-ink` when it must
   be read).
5. **Calm density.** One primary button per view. Generous space between groups, tight inside
   them. On a phone the main action sits at the bottom (`.ed-actionbar`).

## Tokens (never invent values)

- Space: `--s-1` 4 · `--s-2` 8 · `--s-3` 16 · `--s-4` 24 · `--s-5` 32 · `--s-6` 48 · `--s-7` 64.
- Type: `--text-xs` 12 (labels only) · `--text-sm` 14 · `--text-md` 16 · `--text-lg` 18 ·
  `--display-sm` 22 · `--display-md` 28 · `--display-lg` 36 · `--display-xl` fluid 40–64.
- Colour: `--paper --surface --sunken --ink --ink-2 --ink-3 --line --line-strong --accent
  --accent-hover --on-accent --accent-tint --gilt --gilt-ink --danger(-tint) --success(-tint)
  --attention(-tint)`. Dark mode ("Minuit") is automatic via `prefers-color-scheme`; force it on a
  subtree with `data-theme="dark"` (event-day view does this).
- `--tap` 48px controls · `--measure` 65ch text column · `--page` 1120px · `--page-narrow` 640px.

Contrast pairs (WCAG 2.2 AA, all ≥ 4.5:1): ink/paper 16.3 · ink-2/paper 8.0 · ink-3/paper 5.3 ·
on-accent/accent 13.6 · danger/paper 7.0 · success/paper 6.6 · attention/paper 6.0 · gilt-ink/paper
4.9. Dark: ink/paper 15.1 · ink-2/paper 9.3 · ink-3/paper 6.5 · on-accent/accent 10.3.

## Components (`import { … } from "@ed/ui"`, icons from `"@ed/ui/icons"`)

Layout: `Page` (`narrow`), `Stack` (`gap` 1–6), `Cluster`, `Grid` (`cols` 2|3|4|"aside"),
`PageHeader` (eyebrow, title, description, actions), `Section`, `Card` (`framed` = gilt plate-mark,
for the hero/invitation card of a view — at most one per screen), `GiltRule`.

Type: `Eyebrow`, `Lead`, `Unknown`, `ValueOrUnknown`; classes `.ed-display`, `.ed-muted`,
`.ed-small`, `.ed-label`, `.ed-num` (tabular figures), `.ed-prose` (long text).

Actions: `Button` (`variant` primary|secondary|quiet|danger|danger-quiet, `block`), `LinkButton`,
`buttonClassName()` for `next/link`, `IconButton` (needs `label`), `SubmitButton` (needs
`pendingLabel`), `ExternalLink`, `CopyButton`.

Forms: `TextField`, `TextareaField`, `SelectField` (label above, hint, error beside the field),
`Field` for custom controls, `Checkbox`, `ChoiceChips` (radio/checkbox as 48px chips — default for
guest answers and short option sets), `Stepper`, `FocusFirstError`. Wrap forms in
`<form className="ed-form">`.

Status and data: `Tag` (tone neutral|success|danger|attention|accent), `Fact`, `PaidLabel`,
`Notice`, `Figure`/`Figures`, `Meter`, `BarList`, `List`/`Row`, `DescriptionList`, `Table`,
`EmptyState`, `Skeleton`, `DeltaList` (What-if before → after).

Overlays: `Sheet`, `SheetTrigger` (bottom sheet on phones, side panel ≥720px; never a centred
dialog). Put the primary button last in `footer`.

Brand and guest: `Wordmark`, `Seal`, `Invitation`, `StepProgress`, `Ornament` (icons).

Frames (classes in `shell.css`): `.ed-topbar`, `.ed-bottomnav`, `.ed-masthead`, `.ed-rail`,
`.ed-solo` (auth and guest pages), `.ed-console`, public site `.ed-hero`, `.ed-plate`, `.ed-band`,
`.ed-numbered`, `.ed-footer`, `.ed-langswitch`.

Special surfaces: `.ed-board` (columns), `.ed-plan` (blueprint: venue tables solid, custom tables
dashed, POIs gilt), `.ed-now` + `.ed-clock` (event day).

## Screen recipes

- **A page** = `Page` → `PageHeader` → `Section`s → optional `.ed-actionbar` with the one primary.
- **A dashboard** leads with one `Figure size="hero"` (label says the period), then `Figures`.
- **A list** = `List` + `Row` (or `Table` for numbers; numerics right-aligned with `.ed-num`).
  Always provide an `EmptyState` with the action to add the first item.
- **Create/edit** = `SheetTrigger` with a form inside, or its own narrow page for long forms.
- **Guest pages** = `.ed-solo` frame, `Invitation` plate, one question per screen with
  `ChoiceChips`/`Stepper`, `StepProgress`, primary action in `.ed-actionbar`.
- **Destructive** = `danger` button with the object in the label ("Șterge ocazia") beside a
  secondary "Păstrează"; confirm in a `Sheet`.
- **Unknown values**: `<ValueOrUnknown value={x} unknownLabel={t("common.unknown")} />`.

## Voice (Romanian first)

Polite second person plural is not used; address the planner informally and warmly ("Adaugă primul
invitat"). Sentences are short. Buttons are verbs with their object. English mirrors it.
