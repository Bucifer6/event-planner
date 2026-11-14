#!/usr/bin/env python3
"""Generates src/themes.css from the theme table below and checks WCAG AA contrast.
Run:  python3 packages/ui/scripts/gen-themes.py        (rewrites src/themes.css)
The same contrast pairs are asserted by packages/ui/test/themes.test.ts against the CSS."""
import sys, os

LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"

FONTS = [  # family, file stem, weight range, extra descriptor, has italic
    ("Cormorant Garamond", "cormorant-garamond-{s}-wght-{i}", "300 700", "", True),
    ("Jost", "jost-{s}-wght-{i}", "100 900", "", True),
    ("Fraunces", "fraunces-{s}-standard-{i}", "100 900", "", True),
    ("DM Sans", "dm-sans-{s}-wght-{i}", "100 1000", "", True),
    ("Instrument Serif", "instrument-serif-{s}-400-{i}", "400", "", True),
    ("Instrument Sans", "instrument-sans-{s}-wght-{i}", "400 700", "", True),
    ("Archivo", "archivo-{s}-standard-{i}", "100 900", "  font-stretch: 62% 125%;\n", True),
]

SERIF_FALLBACK = '"Didot", "Bodoni 72", Georgia, serif'
SANS_FALLBACK = '"Avenir Next", "Helvetica Neue", "Segoe UI", system-ui, sans-serif'

THEMES = {
    "maison": {
        "comment": "MAISON — the house look (same values as tokens.css), stated explicitly so a preview can show it inside another look.",
        "voice": {
            "--font-display": '"Bodoni Moda", "Didot", "Bodoni 72", "Playfair Display", Georgia, serif',
            "--font-text": '"Hanken Grotesk", "Avenir Next", "Helvetica Neue", "Segoe UI", system-ui, sans-serif',
            "--caps": "uppercase", "--track": "1", "--italic": "italic", "--em-color": "inherit", "--display-weight": "500", "--display-stretch": "normal",
            "--display-leading": "1.12", "--display-tracking": "-0.015em", "--display-caps": "none", "--hero-weight": "400", "--figure-weight": "500",
            "--btn-weight": "650", "--btn-size": "0.8125rem", "--label-size": "0.75rem", "--wordmark-size": "1.375rem", "--wordmark-weight": "500",
            "--radius": "2px", "--radius-sm": "2px", "--hair": "1px",
            "--display-sm": "1.375rem", "--display-md": "1.75rem", "--display-lg": "2.25rem", "--display-xl": "clamp(2.5rem, 7vw, 4rem)",
        },
        "light": dict(paper="#f5f2ec", surface="#fffdf8", sunken="#ece8df", ink="#17161b", ink2="#4b4853", ink3="#66636e", line="#ddd7cb", lineStrong="#a9a294",
                      accent="#1c2452", accentHover="#2b356f", onAccent="#fffdf8", accentTint="#e6e8f2", gilt="#a08342", giltInk="#7a622b"),
        "dark": dict(paper="#141318", surface="#1c1b21", sunken="#100f13", ink="#ece8df", ink2="#bcb8af", ink3="#9d9990", line="#33313a", lineStrong="#5a5763",
                     accent="#b9c0f2", accentHover="#d0d5f8", onAccent="#141318", accentTint="#24263a", gilt="#c9ab70", giltInk="#d6ba82"),
    },
    "atelier": {
        "comment": "ATELIER — couture noir et blanc. Pure white, true black, wide-tracked capitals; no colour at all.",
        "voice": {
            "--font-display": f'"Cormorant Garamond", {SERIF_FALLBACK}', "--font-text": f'"Jost", {SANS_FALLBACK}',
            "--display-weight": "400", "--hero-weight": "300", "--figure-weight": "400", "--display-tracking": "-0.01em",
            "--display-sm": "1.625rem", "--display-md": "2.125rem", "--display-lg": "2.875rem", "--display-xl": "clamp(3rem, 9vw, 5rem)",
            "--track": "1.4", "--btn-weight": "500", "--radius": "0px", "--wordmark-size": "1.75rem", "--wordmark-weight": "500",
        },
        "light": dict(paper="#ffffff", surface="#ffffff", sunken="#f3f3f0", ink="#0a0a0a", ink2="#454543", ink3="#696966", line="#e3e3df", lineStrong="#8c8c88",
                      accent="#0a0a0a", accentHover="#3a3a38", onAccent="#ffffff", accentTint="#efefec", gilt="#0a0a0a", giltInk="#0a0a0a"),
        "dark": dict(paper="#0c0c0c", surface="#161616", sunken="#060606", ink="#f3f3ee", ink2="#bebeb8", ink3="#9c9c96", line="#2b2b2b", lineStrong="#5e5e5a",
                     accent="#f3f3ee", accentHover="#ffffff", onAccent="#0c0c0c", accentTint="#232323", gilt="#f3f3ee", giltInk="#f3f3ee"),
    },
    "riviera": {
        "comment": "RIVIERA — sun-washed sand, Mediterranean blue for actions, terracotta as the ornament. Soft corners, sentence-case.",
        "voice": {
            "--font-display": f'"Fraunces", {SERIF_FALLBACK}', "--font-text": f'"DM Sans", {SANS_FALLBACK}',
            "--display-weight": "500", "--hero-weight": "400", "--figure-weight": "500", "--display-tracking": "-0.02em",
            "--caps": "none", "--track": "0", "--btn-weight": "600", "--btn-size": "0.9375rem", "--label-size": "0.8125rem", "--radius": "12px", "--radius-sm": "6px", "--wordmark-size": "1.5rem", "--wordmark-weight": "600",
        },
        "light": dict(paper="#f7efe3", surface="#fffaf2", sunken="#efe3d1", ink="#2a2921", ink2="#575343", ink3="#6e6956", line="#e4d7c2", lineStrong="#a99b80",
                      accent="#1c5466", accentHover="#266a80", onAccent="#fffaf2", accentTint="#deeaec", gilt="#c2643c", giltInk="#96482a"),
        "dark": dict(paper="#1b1a16", surface="#25231d", sunken="#131210", ink="#f1e9da", ink2="#c5bca9", ink3="#a39a84", line="#38352c", lineStrong="#635e4e",
                     accent="#a3d2de", accentHover="#c4e4ec", onAccent="#11201f", accentTint="#1f2f33", gilt="#e09a78", giltInk="#e7ab8d"),
    },
    "jardin": {
        "comment": "JARDIN — stone, sage and moss. Quiet, botanical, lower-case calm; a single old-style serif for the occasion.",
        "voice": {
            "--font-display": f'"Instrument Serif", {SERIF_FALLBACK}', "--font-text": f'"Instrument Sans", {SANS_FALLBACK}',
            "--display-weight": "400", "--hero-weight": "400", "--figure-weight": "400", "--display-tracking": "-0.01em",
            "--display-sm": "1.5rem", "--display-md": "2rem", "--display-lg": "2.625rem", "--display-xl": "clamp(2.75rem, 8vw, 4.5rem)",
            "--caps": "none", "--track": "0.25", "--btn-weight": "600", "--btn-size": "0.9375rem", "--label-size": "0.8125rem", "--radius": "4px", "--wordmark-size": "1.75rem", "--wordmark-weight": "400",
        },
        "light": dict(paper="#f1f1eb", surface="#fafaf5", sunken="#e5e7dd", ink="#1d221e", ink2="#48504a", ink3="#626b62", line="#d8dbcf", lineStrong="#9da393",
                      accent="#2e4a39", accentHover="#3d6049", onAccent="#f8f9f3", accentTint="#e0e8de", gilt="#8b9c7c", giltInk="#55664a"),
        "dark": dict(paper="#151815", surface="#1d211d", sunken="#0e110e", ink="#e7eae1", ink2="#b7bdaf", ink3="#979e8f", line="#2e342e", lineStrong="#565e54",
                     accent="#b6d2be", accentHover="#d0e4d5", onAccent="#122016", accentTint="#223027", gilt="#9fb08f", giltInk="#b4c3a4"),
    },
    "studio": {
        "comment": "STUDIO — fashion-forward. Blush paper, black ink, one stroke of vermilion; wide bold grotesque capitals, no italics.",
        "voice": {
            "--font-display": f'"Archivo", {SANS_FALLBACK}', "--font-text": f'"Archivo", {SANS_FALLBACK}',
            "--display-weight": "800", "--hero-weight": "800", "--figure-weight": "700", "--display-stretch": "125%", "--display-tracking": "-0.02em",
            "--display-leading": "1.02", "--display-caps": "uppercase", "--italic": "normal", "--em-color": "var(--gilt-ink)",
            "--display-sm": "1.0625rem", "--display-md": "1.5rem", "--display-lg": "2rem", "--display-xl": "clamp(2rem, 7.5vw, 3.75rem)", "--wordmark-size": "1.125rem", "--wordmark-weight": "800",
            "--track": "1", "--btn-weight": "700", "--radius": "0px", "--hair": "1.5px",
        },
        "light": dict(paper="#f4ebe6", surface="#fcf7f3", sunken="#eaddd5", ink="#111110", ink2="#48433f", ink3="#6a635e", line="#dccfc6", lineStrong="#111110",
                      accent="#111110", accentHover="#3b3633", onAccent="#fcf7f3", accentTint="#eaddd5", gilt="#e2452b", giltInk="#b3301a"),
        "dark": dict(paper="#121110", surface="#1c1a18", sunken="#0a0909", ink="#f4ebe6", ink2="#c4b9b2", ink3="#a2978f", line="#342f2c", lineStrong="#f4ebe6",
                     accent="#f4ebe6", accentHover="#ffffff", onAccent="#121110", accentTint="#2a2522", gilt="#ff6a4d", giltInk="#ff8d75"),
    },
    "nocturne": {
        "comment": "NOCTURNE — always at night. Slate-ink paper, warm candle-gold for actions, a sepia hairline; the same in both modes.",
        "scheme": "dark",
        "voice": {
            "--font-display": f'"Cormorant Garamond", {SERIF_FALLBACK}', "--font-text": f'"DM Sans", {SANS_FALLBACK}',
            "--display-weight": "500", "--hero-weight": "400", "--figure-weight": "500", "--display-tracking": "-0.01em",
            "--display-sm": "1.625rem", "--display-md": "2.125rem", "--display-lg": "2.75rem", "--display-xl": "clamp(3rem, 8.5vw, 4.75rem)",
            "--track": "1.2", "--btn-weight": "600", "--radius": "2px", "--wordmark-size": "1.75rem", "--wordmark-weight": "500",
        },
        "light": dict(paper="#14191e", surface="#1e252b", sunken="#0f1317", ink="#f6eddf", ink2="#cabcaa", ink3="#a99c8b", line="#2f373d", lineStrong="#5c5143",
                      accent="#e5bd81", accentHover="#f0d3a6", onAccent="#14191e", accentTint="#2b2a26", gilt="#c9a46b", giltInk="#e5bd81"),
        "dark": dict(paper="#14191e", surface="#1e252b", sunken="#0f1317", ink="#f6eddf", ink2="#cabcaa", ink3="#a99c8b", line="#2f373d", lineStrong="#5c5143",
                     accent="#e5bd81", accentHover="#f0d3a6", onAccent="#14191e", accentTint="#2b2a26", gilt="#c9a46b", giltInk="#e5bd81"),
    },
    "folio": {
        "comment": "FOLIO — the printed page. Newsprint cream, iron-gall ink, an oxblood rule; tight editorial headlines, square corners.",
        "voice": {
            "--font-display": f'"Fraunces", {SERIF_FALLBACK}', "--font-text": f'"Instrument Sans", {SANS_FALLBACK}',
            "--display-weight": "600", "--hero-weight": "500", "--figure-weight": "600", "--display-tracking": "-0.04em", "--display-leading": "1.04",
            "--track": "1.1", "--btn-weight": "600", "--radius": "0px", "--radius-sm": "0px", "--wordmark-size": "1.5rem", "--wordmark-weight": "700",
        },
        "light": dict(paper="#f4f2e9", surface="#f8f6ef", sunken="#ece7d8", ink="#26251e", ink2="#4f4a3d", ink3="#625c4c", line="#d9d3c1", lineStrong="#a6a08d",
                      accent="#8f342c", accentHover="#a8453b", onAccent="#f8f6ef", accentTint="#f1e2dc", gilt="#a34031", giltInk="#8f342c"),
        "dark": dict(paper="#191814", surface="#22201b", sunken="#11100d", ink="#efebdd", ink2="#c3bda9", ink3="#a39d8a", line="#36332b", lineStrong="#625d50",
                     accent="#eba59b", accentHover="#f4c3bb", onAccent="#191814", accentTint="#3a2522", gilt="#d97f6f", giltInk="#eba59b"),
    },
    "herbarium": {
        "comment": "HERBARIUM — pressed leaves. Lichen paper, forest-green ink and actions, a little softness in the corners.",
        "voice": {
            "--font-display": f'"Cormorant Garamond", {SERIF_FALLBACK}', "--font-text": f'"Instrument Sans", {SANS_FALLBACK}',
            "--display-weight": "500", "--hero-weight": "500", "--figure-weight": "500", "--display-tracking": "-0.005em",
            "--display-sm": "1.625rem", "--display-md": "2.125rem", "--display-lg": "2.75rem", "--display-xl": "clamp(2.875rem, 8vw, 4.5rem)",
            "--caps": "none", "--track": "0.3", "--btn-weight": "600", "--btn-size": "0.9375rem", "--label-size": "0.8125rem", "--radius": "5px", "--radius-sm": "4px", "--wordmark-size": "1.75rem", "--wordmark-weight": "500",
        },
        "light": dict(paper="#e8ecdf", surface="#f4f6ee", sunken="#dce5d0", ink="#253427", ink2="#46523f", ink3="#536047", line="#c8d1bd", lineStrong="#a7b49d",
                      accent="#435932", accentHover="#56703f", onAccent="#f4f6ee", accentTint="#dbe5cf", gilt="#8a9e74", giltInk="#4c6138"),
        "dark": dict(paper="#141913", surface="#1c231b", sunken="#0d110c", ink="#e6ecdc", ink2="#b8c2ab", ink3="#98a38b", line="#2c3529", lineStrong="#56634f",
                     accent="#b9d39c", accentHover="#d1e4bb", onAccent="#141913", accentTint="#24301f", gilt="#9fb487", giltInk="#b9d39c"),
    },
    "prism": {
        "comment": "PRISM — a launch poster. Lavender-white paper, ultramarine actions, heavy wide grotesque headlines.",
        "voice": {
            "--font-display": f'"Archivo", {SANS_FALLBACK}', "--font-text": f'"Archivo", {SANS_FALLBACK}',
            "--display-weight": "900", "--hero-weight": "900", "--figure-weight": "800", "--display-stretch": "112%", "--display-tracking": "-0.035em",
            "--display-leading": "1.02", "--italic": "normal", "--em-color": "var(--accent)",
            "--display-sm": "1.25rem", "--display-md": "1.75rem", "--display-lg": "2.375rem", "--display-xl": "clamp(2.25rem, 8vw, 4.25rem)", "--wordmark-size": "1.25rem", "--wordmark-weight": "900",
            "--caps": "none", "--track": "0", "--btn-weight": "700", "--btn-size": "0.9375rem", "--label-size": "0.8125rem", "--radius": "8px", "--radius-sm": "6px",
        },
        "light": dict(paper="#ecedf9", surface="#fbfaff", sunken="#e0def8", ink="#211c43", ink2="#46406a", ink3="#555075", line="#d3d0f0", lineStrong="#bdb8e6",
                      accent="#3e35af", accentHover="#4d43de", onAccent="#fbfaff", accentTint="#e0def8", gilt="#4d43de", giltInk="#3e35af"),
        "dark": dict(paper="#13112a", surface="#1c1938", sunken="#0c0b1d", ink="#eceafd", ink2="#bfbbe4", ink3="#9f9ac6", line="#2e2a52", lineStrong="#58539a",
                     accent="#b3adff", accentHover="#cdc9ff", onAccent="#13112a", accentTint="#26224d", gilt="#8f87ff", giltInk="#b3adff"),
    },
    "salon": {
        "comment": "SALON — an evening drawing room. Rosewater paper, mulberry ink, garnet actions in pill-shaped buttons.",
        "voice": {
            "--font-display": f'"Cormorant Garamond", {SERIF_FALLBACK}', "--font-text": f'"Jost", {SANS_FALLBACK}',
            "--display-weight": "500", "--hero-weight": "400", "--figure-weight": "500", "--display-tracking": "-0.01em",
            "--display-sm": "1.625rem", "--display-md": "2.125rem", "--display-lg": "2.875rem", "--display-xl": "clamp(3rem, 9vw, 5rem)",
            "--track": "1.2", "--btn-weight": "500", "--radius": "6px", "--radius-sm": "999px", "--wordmark-size": "1.75rem", "--wordmark-weight": "500",
        },
        "light": dict(paper="#f7eee8", surface="#fff7ef", sunken="#f1e0db", ink="#491f2a", ink2="#683f49", ink3="#754b55", line="#e4ccc6", lineStrong="#c4a19c",
                      accent="#8b3b4d", accentHover="#a34a5e", onAccent="#fff7ef", accentTint="#f3dfe0", gilt="#a8735a", giltInk="#7c4a36"),
        "dark": dict(paper="#1d1215", surface="#28191e", sunken="#140c0e", ink="#f7e6e2", ink2="#d2b6b5", ink3="#b39596", line="#3b262c", lineStrong="#6c4a52",
                     accent="#f0a9b8", accentHover="#f7c7d1", onAccent="#1d1215", accentTint="#3c2329", gilt="#d8a68d", giltInk="#e6bba5"),
    },
    "dune": {
        "comment": "DUNE — desert at golden hour. Sand paper, umber ink, burnt-sienna actions, softened corners.",
        "voice": {
            "--font-display": f'"Fraunces", {SERIF_FALLBACK}', "--font-text": f'"DM Sans", {SANS_FALLBACK}',
            "--display-weight": "700", "--hero-weight": "600", "--figure-weight": "600", "--display-tracking": "-0.025em",
            "--caps": "none", "--track": "0.2", "--btn-weight": "600", "--btn-size": "0.9375rem", "--label-size": "0.8125rem", "--radius": "4px", "--radius-sm": "4px", "--wordmark-size": "1.5rem", "--wordmark-weight": "700",
        },
        "light": dict(paper="#f2e6d7", surface="#f9efe2", sunken="#eddbc7", ink="#3b2921", ink2="#5c443a", ink3="#694e42", line="#e0cbb5", lineStrong="#c7aa91",
                      accent="#8b472e", accentHover="#a3573a", onAccent="#f9efe2", accentTint="#f1dccd", gilt="#d08c64", giltInk="#8b472e"),
        "dark": dict(paper="#1c1611", surface="#261e18", sunken="#130f0b", ink="#f4e8d9", ink2="#cdbba7", ink3="#ac9a87", line="#3a2f26", lineStrong="#6a5848",
                     accent="#eeaa86", accentHover="#f5c6ab", onAccent="#1c1611", accentTint="#3b2a20", gilt="#d9a07a", giltInk="#eeaa86"),
    },
    "ledger": {
        "comment": "LEDGER — the accountant's book. Mint-grey paper, typewriter headings, bottle-green actions, square corners.",
        "voice": {
            "--font-display": 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace', "--font-text": f'"Instrument Sans", {SANS_FALLBACK}',
            "--display-weight": "600", "--hero-weight": "500", "--figure-weight": "600", "--display-tracking": "-0.04em", "--italic": "normal", "--em-color": "var(--accent)",
            "--display-sm": "1.25rem", "--display-md": "1.5rem", "--display-lg": "1.875rem", "--display-xl": "clamp(2rem, 6.5vw, 3.25rem)",
            "--track": "1", "--btn-weight": "600", "--radius": "0px", "--radius-sm": "0px", "--wordmark-size": "1.25rem", "--wordmark-weight": "600",
        },
        "light": dict(paper="#ebefed", surface="#f9faf8", sunken="#e0e8e3", ink="#1e2826", ink2="#3e4c49", ink3="#465653", line="#cdd7d2", lineStrong="#aebbb6",
                      accent="#226454", accentHover="#2d7a67", onAccent="#f9faf8", accentTint="#dae9e2", gilt="#226454", giltInk="#226454"),
        "dark": dict(paper="#111716", surface="#19201e", sunken="#0a0f0e", ink="#e5ece9", ink2="#b3c0bb", ink3="#93a19c", line="#28322f", lineStrong="#51605b",
                     accent="#8fd3bd", accentHover="#b2e3d3", onAccent="#111716", accentTint="#1d302a", gilt="#8fd3bd", giltInk="#8fd3bd"),
    },
    "muse": {
        "comment": "MUSE — dreamy and soft. Lilac paper, plum ink and actions, generous round corners and pill buttons.",
        "voice": {
            "--font-display": f'"Instrument Serif", {SERIF_FALLBACK}', "--font-text": f'"DM Sans", {SANS_FALLBACK}',
            "--display-weight": "400", "--hero-weight": "400", "--figure-weight": "400", "--display-tracking": "-0.015em",
            "--display-sm": "1.5rem", "--display-md": "2rem", "--display-lg": "2.75rem", "--display-xl": "clamp(2.875rem, 8.5vw, 4.75rem)",
            "--caps": "none", "--track": "0.2", "--btn-weight": "600", "--btn-size": "0.9375rem", "--label-size": "0.8125rem", "--radius": "16px", "--radius-sm": "999px", "--wordmark-size": "1.75rem", "--wordmark-weight": "400",
        },
        "light": dict(paper="#f1edf7", surface="#fcf9ff", sunken="#e9e0f4", ink="#31243c", ink2="#544461", ink3="#5f4d6e", line="#ddd2ea", lineStrong="#c8b9d7",
                      accent="#754581", accentHover="#8b559a", onAccent="#fcf9ff", accentTint="#ece0f2", gilt="#b3a1ed", giltInk="#6a4b9a"),
        "dark": dict(paper="#17121c", surface="#211a28", sunken="#0f0c13", ink="#efe6f7", ink2="#c7b8d6", ink3="#a796b8", line="#33293d", lineStrong="#62547a",
                     accent="#dcb0e8", accentHover="#ead0f1", onAccent="#17121c", accentTint="#33243b", gilt="#b9a8f0", giltInk="#cbbdf4"),
    },
    "vellum": {
        "comment": "VELLUM — a hand-bound book. Parchment paper, sepia ink, umber actions; a bookish serif, square corners.",
        "voice": {
            "--font-display": f'"Cormorant Garamond", {SERIF_FALLBACK}', "--font-text": f'"Instrument Sans", {SANS_FALLBACK}',
            "--display-weight": "500", "--hero-weight": "500", "--figure-weight": "500", "--display-tracking": "-0.01em",
            "--display-sm": "1.625rem", "--display-md": "2.125rem", "--display-lg": "2.75rem", "--display-xl": "clamp(2.875rem, 8.5vw, 4.75rem)",
            "--track": "1.1", "--btn-weight": "600", "--radius": "0px", "--radius-sm": "0px", "--wordmark-size": "1.75rem", "--wordmark-weight": "500",
        },
        "light": dict(paper="#f5f0e7", surface="#fcf8f0", sunken="#ebe1d5", ink="#251f1b", ink2="#55483e", ink3="#66564a", line="#ddd0c2", lineStrong="#c9b9a9",
                      accent="#8a482d", accentHover="#a3593a", onAccent="#fcf8f0", accentTint="#f1e1d6", gilt="#b98266", giltInk="#8a482d"),
        "dark": dict(paper="#1b1714", surface="#25201b", sunken="#120f0d", ink="#f1e9dd", ink2="#c9bcab", ink3="#a99b8a", line="#382f28", lineStrong="#66584b",
                     accent="#e8aa8c", accentHover="#f2c6ae", onAccent="#1b1714", accentTint="#3a2a21", gilt="#d29c80", giltInk="#e8aa8c"),
    },
    "lagoon": {
        "comment": "LAGOON — sea glass and harbour blue. Pale aqua paper, deep-water ink, round cards and pill buttons.",
        "voice": {
            "--font-display": f'"Instrument Serif", {SERIF_FALLBACK}', "--font-text": f'"DM Sans", {SANS_FALLBACK}',
            "--display-weight": "400", "--hero-weight": "400", "--figure-weight": "400", "--display-tracking": "-0.015em",
            "--display-sm": "1.5rem", "--display-md": "2rem", "--display-lg": "2.75rem", "--display-xl": "clamp(2.875rem, 8.5vw, 4.75rem)",
            "--caps": "none", "--track": "0.2", "--btn-weight": "600", "--btn-size": "0.9375rem", "--label-size": "0.8125rem", "--radius": "24px", "--radius-sm": "999px", "--wordmark-size": "1.75rem", "--wordmark-weight": "400",
        },
        "light": dict(paper="#f0f6f7", surface="#fcfdfc", sunken="#dbecef", ink="#14334d", ink2="#35536b", ink3="#406079", line="#c8dde2", lineStrong="#aac9d0",
                      accent="#1f637c", accentHover="#287995", onAccent="#fcfdfc", accentTint="#dbecef", gilt="#80b9c6", giltInk="#24617a"),
        "dark": dict(paper="#0f181d", surface="#162229", sunken="#0a1115", ink="#e3eff2", ink2="#b0c6cd", ink3="#91a9b1", line="#243840", lineStrong="#4b6872",
                     accent="#94cfe0", accentHover="#b7e0ec", onAccent="#0f181d", accentTint="#1b3038", gilt="#80b9c6", giltInk="#94cfe0"),
    },
}

VAR = dict(paper="--paper", surface="--surface", sunken="--sunken", ink="--ink", ink2="--ink-2", ink3="--ink-3", line="--line", lineStrong="--line-strong",
           accent="--accent", accentHover="--accent-hover", onAccent="--on-accent", accentTint="--accent-tint", gilt="--gilt", giltInk="--gilt-ink")

def lum(h):
    h = h.lstrip("#"); r, g, b = (int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + 0.05) / (lb + 0.05)

PAIRS = [("ink", "paper"), ("ink", "surface"), ("ink2", "paper"), ("ink2", "surface"), ("ink2", "sunken"), ("ink3", "paper"), ("ink3", "surface"),
         ("onAccent", "accent"), ("onAccent", "accentHover"), ("accent", "paper"), ("accent", "surface"), ("accent", "accentTint"), ("giltInk", "paper"), ("giltInk", "surface")]

def faces():
    out = []
    for family, stem, weight, extra, italic in FONTS:
        for style in (["normal", "italic"] if italic else ["normal"]):
            for subset, rng in (("latin-ext", LATIN_EXT), ("latin", LATIN)):
                file = stem.format(s=subset, i=style)
                fmt = "woff2" if weight == "400" else "woff2-variations"
                out.append(f'@font-face {{\n  font-family: "{family}";\n  font-style: {style};\n  font-display: swap;\n  font-weight: {weight};\n{extra}  src: url("../fonts/{file}.woff2") format("{fmt}");\n  unicode-range: {rng};\n}}')
    return "\n".join(out)

def block(sel, pairs, indent=""):
    body = "\n".join(f"{indent}  {k}: {v};" for k, v in pairs)
    return f"{indent}{sel} {{\n{body}\n{indent}}}"

def main():
    bad = 0
    css = ["/* MAISON — alternative looks. GENERATED by packages/ui/scripts/gen-themes.py — edit the table there.",
           "   A look is chosen with data-ui=\"<name>\" on <html> (or on any element, for previews).",
           "   No attribute = Maison, the house look defined in tokens.css. Fonts load only when used. */", "", faces(), ""]
    for name, t in THEMES.items():
        for mode in ("light", "dark"):
            for a, b in PAIRS:
                r = ratio(t[mode][a], t[mode][b])
                if r < 4.5:
                    bad += 1; print(f"CONTRAST {name} {mode} {a}/{b} = {r:.2f}", file=sys.stderr)
        light = ([("color-scheme", "dark")] if t.get("scheme") == "dark" else []) + list(t["voice"].items()) + [(VAR[k], v) for k, v in t["light"].items()]
        dark = [(VAR[k], v) for k, v in t["dark"].items()]
        css.append(f"/* {t['comment']} */")
        css.append(block(f'[data-ui="{name}"]', light))
        css.append("@media (prefers-color-scheme: dark) {\n" + block(f':root:not([data-theme="light"])[data-ui="{name}"]', dark, "  ") + "\n}")
        css.append(block(f'[data-ui="{name}"][data-theme="dark"],\n[data-ui="{name}"] [data-theme="dark"]', [("color-scheme", "dark")] + dark))
        css.append("")
    here = os.path.dirname(os.path.abspath(__file__))
    open(os.path.join(here, "..", "src", "themes.css"), "w").write("\n".join(css))
    print(f"wrote themes.css; contrast failures: {bad}")
    sys.exit(1 if bad else 0)

main()
