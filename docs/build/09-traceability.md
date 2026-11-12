# 09 — Traceability: PRD requirement → work item

Coverage proof: every PRD v4.9 requirement ID maps to at least one work item. When a work item is
implemented, mark its row done in the PR that implements it. If the PRD changes, update this table
in the same PR.

## Principles (PRD §5) and goals (§3)
| PRD | Enforced by |
| --- | --- |
| Principles 1–8 | Invariants list in `README.md`; R0-16 (3), B-06 (4), V6/P-06 (5), A-05/D2 (6), P-04/P-13 (7), P-08 (8), plus MON1 (1), A-03 (2) |
| Goals 1–7 | A-01, R0-16, A-06, P-04/P-05, P-06/P-07/C-01, P-01/P-12, gate M5 |

## Release A (PRD §7)
| PRD | Work item | PRD | Work item |
| --- | --- | --- | --- |
| A1 | A-01 | A8 | A-08 |
| A2 | A-02 | A9 | A-09 |
| A3 | A-03 | A10 | A-10 |
| A4 | A-04 | A11 | A-01 |
| A5 | A-05 | A12 | R0-06 (+ every work item's checklist) |
| A6 | A-06 | A13 | A-11 |
| A7 | A-07 | exports (A) | A-12 |

## Release B (PRD §7)
| PRD | Work item | PRD | Work item |
| --- | --- | --- | --- |
| B1 | B-01 | B7 | B-07 |
| B2 | B-02 | B8 | B-08 |
| B3 | B-03 | B9 | B-09 |
| B4 | B-04 | B10 | B-10 |
| B5 | B-05 | B11 | B-11 |
| B6 | B-06 | B12 | B-12 |

## Release P (PRD §8)
| PRD | Work item | PRD | Work item |
| --- | --- | --- | --- |
| P1, P2 | P-01 | P18–P23 | P-08 |
| P3, W2 | P-02 | P24–P26 | P-12 |
| P4 | P-03 | P27 (superseded by MON1) | P-12 |
| P5–P7 | P-04 | P28 | P-12 |
| P8–P11, P32, P33 | P-05 | P29, P30 | P-09, P-10 |
| P12 | P-05, P-07 | P31 | P-11 |
| P13–P16 | P-13 | MON1–MON5 | P-12 |
| V1–V11 | P-06 | BD1–BD7, W5 | P-09 |
| F1, F2, F5, F6 | P-07 (F3/F4 designer UI in C-13) | W1–W10 | P-14 (W2→P-02, W10→R0-14) |
| DEP1–DEP7 | R0-14 | MCP1–MCP8 | R0-15, P-15 |
| PAY1–PAY5 | P-12 | | |

## Releases C/D/E (PRD §9)
C → C-01…C-13; D → D-01…D-05; E → E-01…E-04 (see `08-releases-C-D-E.md`).

## Accounts, privacy, platform (PRD §10)
| PRD | Work item | PRD | Work item |
| --- | --- | --- | --- |
| S1, INF4, SEC1, SEC14 | R0-04 | Q1, Q2, A12 | R0-06, R0-08 (+ all) |
| S2 | R0-04 | Q3 | R0-08 perf tests + every release's e2e |
| S3, SEC3, SEC12 | R0-04 | Q4 | R0-16 + atomic tests A-08, A-09 |
| S4 | R0-04 | Q5 | k6 load script, run pre-release |
| S5 | R0-13 | Q6 | R0-10, R0-11 |
| S6, SEC2 | A-06 | Q7 | R0-01, R0-12 |
| S7, S8 | R0-04 | Q8, Q10 | R0-06, C-01 |
| SEC4 | R0-10 | Q9 | R0-10 |
| SEC5, SEC6, SEC7 | R0-09 | L1–L5 | R0-06, R0-11 |
| SEC8, SEC13 | R0-04, R0-02, R0-15 | D1 | R0-01, R0-07 |
| SEC9 | R0-02, R0-03 | D2 | A-05 (+ server-side tests) |
| SEC10 | R0-03, R0-13 | D3 | P-05, P-15 |
| SEC11, SEC16 | R0-05, R0-04 | D4, INF11 | R0-12, P-04, P-08, P-11 |
| SEC15 | R0-15, P-15 | D5, INF6 | R0-03, B-10, R0-18 |
| INF1 | R0-02, R0-07 | D6 | R0-18 |
| INF2 | R0-11 | INF12 | R0-02 (infra) |
| INF3 | R0-10 | INF8 | R0-06 |
| INF5 | A-06, C-10 | INF9 | R0-02 |
| INF7 | cross-cutting §AI; C-04/C-13 labelling | INF10 | R0-03, R0-12 |

## Gates and launch obligations (PRD §12, §20)
| PRD | Where |
| --- | --- |
| M0 | `04-foundation-release-0.md` exit |
| M1 | `06-release-B.md` exit (pilot + interviews) |
| M2 | `07-release-P.md` exit (P-12 acceptance) |
| M3, M4, M5 | `README.md` gate map; console dashboards W1/W6 |
| LAU1 | R0-07, R0-08, R0-17 |
| LAU2 | R0-17 (console records; DPIA operator-owned) |
| LAU3 | R0-11 config docs + operator task |
| LAU4 | pre-launch operator task (pen test); SEC items are the build side |
| LAU5 | R0-08, R0-12 |
| LAU6 | R0-07 (For businesses page), P-12, LAU6 content operator-owned |
| LAU7 | R0-14 runbook UI; operator-owned runbook |
| LAU8 | R0-17 (notice-and-action intake) |
| LAU9 | R0-07, R0-17 (accessibility statement) |

## Design language (PRD §21)
Garden Soirée + Honest Directory → R0-06; Midnight Candlelight → B-07; Paper & Ink layout designer →
C-01; design gates (WCAG AA at 320px before A, Featured label legibility before P, phone-first mocks)
→ CI checks in R0-01/R0-06 and P-13 acceptance.
