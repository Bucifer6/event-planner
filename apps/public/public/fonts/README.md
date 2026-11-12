# Self-hosted fonts (D1)

Place the woff2 files here (and mirror them into `apps/public/public/fonts/` for the
public site). Names expected by `packages/ui/src/tokens.css`:

- `sora-400.woff2`, `sora-600.woff2` (UI font)
- `cormorant-600.woff2` (display/voice font)
- `dmmono-400.woff2` (factual mono labels)
- `fraunces-600.woff2` (editorial figures)
- `marcellus-400.woff2` (invitation display)
- `spacegrotesk-400.woff2` (directory labels)

Until the files exist, the system fallback stacks in `tokens.css` apply and nothing
breaks. Never load fonts from a third-party CDN — the public site must set no
third-party requests at all (D1, asserted in CI).
