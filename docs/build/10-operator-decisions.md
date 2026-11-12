# 10 — Operator decisions (agents must NOT resolve these)

These come from PRD section 13 (open questions) and the v4/v4.4 reviews: they are operator choices
inside fixed constraints. Agents implement them as env config / seeded console settings with sane
defaults, never hard-coded. If a work item hits one of these, use the placeholder and note it in the
PR; do not guess.

## Infrastructure and providers (constraints fixed by INF/SEC)
- Transactional email provider (must offer EU delivery; SPF/DKIM/DMARC on eventdesk.ro) — INF2, LAU3
- AI text provider/model for INF7 (recorded in console; 10 results/month cap is fixed by Q6)
- EU hosting vendor (Romania preferred) for app, Postgres, object store — INF9
- Secret store product — SEC13
- Malware scanner for uploads — SEC4
- S3-compatible object store endpoint/region (EU) — INF3
- Payment processor confirmation at M2: Stripe first, Netopia fallback — PAY5
- Fiscal invoicing connector (SmartBill / Oblio / equivalent) and ANAF RO e-Factura connection — PAY3
- Licensed discovery datasets and their terms, if any — BD1

## Legal and compliance (operator-owned, LAU1/LAU2/LAU6/LAU8)
- Legal entity operating the platform (SRL/SRL-D, registration, TVA status; 21% standard rate once
  registered; micro-enterprise threshold 395,000 RON)
- ANSPDCP controller registration before release P; named PrivacyOwner
- e-Factura obligation/thresholds for pilot invoices
- Romanian legal review of business terms, "For businesses" page, claim invitation under
  ePrivacy/Legea nr. 506/2004, DSA registration with ANCOM
- DPIA for discovery, guest household data, MCP external transfer (LAU2)
- External penetration test before first guest link (LAU4)

## Product and commercial
- Real monthly fixed cost for the break-even figure (20,000 RON is a placeholder)
- Launch counties/categories confirmation (Bucharest/Ilfov + Cluj proposed) and which categories
  launch first
- Final pilot prices confirmation (199 / 1,990 / 149 RON excl. TVA are pilot figures)
- The second staff person (and third for compliance access) — approvals need two people (W9)
- Moderation service target in hours (W2 queue timer)
- Whether basic listings stay free permanently
- Open design questions recorded in PRD §13 (drawing formats beyond PDF/raster; "subject to quote"
  disclaimer legal review; fresh vs dried flowers at launch; animated invitation envelope; paid
  invitation packs — the last would require deliberately changing a non-goal)
- Enquiry relay: email-only at launch vs adding landline/SMS preference later

## Rule for agents
If a decision above blocks a work item, ship with the placeholder default and a console/env knob,
list it in the PR description under "Operator decisions needed", and never bake a guess into code,
data or copy.
