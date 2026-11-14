# 20 — Glossary

**What this is, in plain English.** The words used in the product, the documents and the code,
each explained in a sentence or two, with the Romanian term a user sees on screen beside it.
Use it whenever a word in another document is unclear.

The Romanian terms were taken from the message files (`packages/i18n/messages/ro/`). Where a
term is a code or document word that never appears on screen, the Romanian column says "—".

## People and access

| Term | Romanian on screen | Meaning |
| --- | --- | --- |
| **Planner** | — (the user) | A person planning an occasion. Always free |
| **Occasion** | *Ocazie* | The thing being planned: a wedding, baptism, anniversary, trip. Everything else belongs to an occasion |
| **Owner** | *Organizator* | The person who created the occasion or received it. Holds every grant; the only one who can delete it or change who has access |
| **Member / team** | *Echipă și roluri* | People who help plan. Roles: *Organizator* (owner), *Manager de proiect* (project manager), *Coordonator* (workstream lead), *Ajutor* (contributor), *Furnizor* (supplier), *Invitat* (guest) |
| **Grant** | *Finanțe*, *Cereri private* | An extra permission given to one member on top of their role. There are two: **finance** (see and change the budget and shared costs) and **private requests** (read guests' dietary and access requests). Without the grant, that data is invisible to the member |
| **Delegation** | *Delegare* | Offering a task to another member. It becomes theirs only if they accept; if they decline it comes back to the person who offered it |
| **Household** | *Familie* (list: *Familii invitate*) | A group of guests invited together and answering together — a family, a couple, one person. Invitations and replies are per household |
| **Guest** | *Invitat* | A named adult in a household. Children are never recorded as people — only how many are coming ("+2 copii") |
| **Guest link** | *Linkul de invitație* | The private web address sent to one household. Whoever has it sees only that household's invitation and can answer for it. No account needed. It can be revoked or set to expire |
| **Supplier link** | — | The same idea for a supplier: a private address showing only their own booking and briefing |
| **Anonymous account** | *cont anonim* | An account with a generated username and a password, and no email, phone or name. It cannot be recovered without its recovery codes |
| **Two-step sign-in** | *Verificare în doi pași* | An optional second proof at sign-in: a code from an authenticator app. Required for staff, never for planners |
| **Fresh confirmation** | — | A new code entered within the last ten minutes, required before sensitive actions such as deletion or transferring ownership. In code: *fresh auth* |
| **Staff** | — | People who run the platform, with one or more of six roles. They use the console |
| **Console** | — | The management area at `/console`, for staff only |
| **Single-operator mode** | *Mod restricționat: un singur operator* | The state while only one person holds a staff role: anything needing a second person waits without effect |
| **Approval** | *Aprobări* | A request by one staff member that takes effect only when another approves it (the two-person rule) |
| **Compliance access** | *Acces de conformitate* | Time-limited access to one person's records, for a legal reason, requested by the privacy owner and approved by two others |

## Planning

| Term | Romanian on screen | Meaning |
| --- | --- | --- |
| **Template** | — | A starting set of tasks for a kind of occasion (wedding, baptism, anniversary, picnic, New Year, solo trip, group trip), scheduled backwards from the date |
| **Task** | *Sarcini* | One thing to do, with one owner and a due date. The same task appears in the list, the board, the calendar and the event-day view |
| **Brief** | — | The occasion's purpose and its two or three priorities |
| **Overview** | *Privire de ansamblu* | The occasion's front page: days to go, what is overdue, offers nobody accepted, blockers |
| **Digest** | *Rezumatul zilei* | One email a day per member with what needs their attention; nothing is sent when there is nothing to say |
| **What-if preview** | *Ce-ar fi dacă?* | A change shown before it is made: what it is and everything it would affect, as before → after. It is applied only when a person confirms. Moving the date, importing guests, cancelling, and anything an AI assistant suggests all go through it. In code: `whatif_previews`, a *preview* or *proposal* |
| **Delta** | *Schimbări după comanda finală* (for orders) | A recorded difference between what was agreed and what changed later — the before → after rows of a preview, or the guest changes that arrived after a final order |
| **Date poll** | *Sondaj de date* | Guests vote Yes, Maybe or No on candidate dates; the host confirms one. Voting never reserves a place |
| **RSVP** | *Invitați și răspunsuri* | A household's answer: who is coming, as numbers of adults and children |
| **Capacity** | *locuri* | The one count of places for an occasion, shared by invited households and public registrations. Two people cannot take the last place |
| **Contribution** | *Cine ce aduce* | A stated need ("6 salads") that guests can claim part of |
| **Unknown** | *necunoscut* | A price, size or count nobody has provided. It is shown as unknown, in italics — never as zero and never guessed — and is left out of calculations |

## Money and suppliers

| Term | Romanian on screen | Meaning |
| --- | --- | --- |
| **Budget** | *Buget* | Per category, five separate amounts: estimate, committed, invoiced, paid, forecast |
| **Expense** | — | A cost with an optional receipt. *Approved* and *paid* are separate states |
| **Shared costs / ledger** | *Cheltuieli comune* | Who paid, who benefits, who owes whom — per currency |
| **Fact** | — | Something that happened and must not be silently rewritten: a payment made, a quantity received, an arrival |
| **Correction** | *corecție* (*Motivul corecției*) | The only way to change a fact: a new record saying what it was, what it becomes and why, kept forever beside the fact |
| **Supplier** | *Furnizor* | A business or person providing something for the occasion, recorded in the plan |
| **Booking** | — | The state of the agreement with a supplier: *Întrebat* → *Ofertă primită* → *Rezervat* → *Confirmat* → *Livrat* (or *Anulat*) |
| **Quote** | *Ofertă* | A price from a business, as a PDF, that the planner can accept into the supplier record |
| **Briefing** | *Briefing* | What the supplier needs to know. Each published briefing is a version that cannot be edited; a change is a new version the supplier acknowledges |
| **Snapshot (final order)** | *Comanda finală* | The agreed order, frozen. Later guest changes do not alter it; they appear beside it as a delta until the planner makes a new version |
| **Payment deadline** | — | An advance, instalment or final balance with a due date; overdue ones appear in the digest of members with the finance grant |
| **Delivery** | *Livrări și retururi* | Expected, received and returned quantities, and deposits |
| **Event-day view** | *Ziua evenimentului* | The run sheet: the same tasks, shown as Ready, Running, Waiting, Done |
| **Readiness decision** | *Decizia de pregătire* | A recorded Hold, Proceed or Proceed with conditions, tied to evidence. It cannot be edited afterwards |
| **Closeout** | *Încheiere* | Closing an occasion: unpaid balances, returns and deposits still open, and lessons for next time (*Ce ai învățat*) |

## Businesses and the directory

| Term | Romanian on screen | Meaning |
| --- | --- | --- |
| **Business** | *Afacere* / *Firme* | A business account with an owner, admins and staff |
| **Listing** | *listare* | A business's entry in the directory, with categories and the localities it serves |
| **Directory** | *Firme* (*Găsește firme*) | The public list of businesses by category and county |
| **Organic order** | — | The normal order of results. It rotates daily and payment cannot change it |
| **Featured** | *Promovat — plasare plătită* | Paid position above the organic results, always labelled. **It does not exist while monetisation is off** |
| **Moderation** | *Moderare* | Staff review before anything a business publishes goes public |
| **Moderation revision** | *Trimitere spre moderare* | One submission waiting for review — a new listing, an edit, a drawing, a catalogue. States: *În așteptare*, *Aprobată*, *Respinsă*, *Retrasă de firmă*. The public version stays up while an edit waits |
| **Factual badge** | *Verificat: …* | One of exactly two statements staff can record: company registration seen (ONRC), or insurance seen valid until a date. There is no general "verified" badge and no ratings |
| **Unclaimed listing** | *Adăugat de EventDesk — nefiind revendicat încă* | A minimal listing created by discovery from public information, before the business has taken it over. It cannot receive enquiries |
| **Claim** | *Revendică listarea* | A business proving a listing is theirs — by a code sent to their published address, or a moderator's recorded check — approved by a second staff member |
| **Discovery** | *Descoperire* | The tool that finds candidate businesses from public sources and creates drafts for staff to approve |
| **Objection / removal request** | — | A business asking not to be listed. Honoured within 30 days and recorded for three years |
| **Enquiry** | — | A planner's message to a listing. States: sent (with the date), awaiting reply, answered, closed |
| **Quote request** | *Cerere de ofertă* | An enquiry to a florist or stylist carrying an arrangement design or picture |
| **Lapse** | — (the business sees *Nu poți adăuga listări noi acum*) | A business's paid plan ending. Its clients' occasions and anything already in use keep working; only new business occasions, branding and library edits stop. Cannot happen while monetisation is off |
| **Handover** | *Predate clienților* | A business giving an occasion it planned to its client. The business's access and branding end; the history is kept |
| **Monetisation switch** | — | The single setting that makes paid plans purchasable. OFF by default; needs a tested billing set-up, a second person's approval and 60 days' notice |
| **Free phase** | — | The period while the switch is off: everything is free for everyone |
| **Platform notice** | *Comunicări* | A message from staff to businesses — never to anyone a planner entered |
| **Content report** | *Rapoarte conținut* | A report of illegal content from anyone (the EU's notice-and-action duty) |

## Spaces, seating and celebration

| Term | Romanian on screen | Meaning |
| --- | --- | --- |
| **Drawing** | — | A venue's floor plan picture (PNG, JPG or PDF), one per space |
| **Calibration** | *Calibrat* / *necalibrat* | Marking two points on a drawing whose real distance is known, so the platform knows the scale. An uncalibrated drawing cannot be used for layouts |
| **Markings** | — | What the venue draws on a calibrated drawing: usable floor areas, its tables, fixtures (stage, dance floor), points of interest (toilets, bar, exits), parking areas |
| **Drawing version** | *Versiunea {n}, valabilă din {date}* | An approved state of a drawing. It never changes; an update is a new version |
| **Space model** | *Planul sălii* | The room an occasion is laid out in: either a venue's approved drawing version or a rectangle the planner typed in. A venue's later update arrives as a What-if preview, never silently |
| **Custom table** | *masă proprie* | A table the planner adds with their own dimensions, always marked as theirs and never shown as the venue's |
| **Fit check** | *Încape* / *Necunoscut: …* | Whether the tables and fixtures fit the usable area, at each stage of the meal. Items with unknown dimensions are left out and reported as unknown |
| **Meal stage** | — | A phase of the evening with its own layout ("Primire", "Dans") |
| **Seating** | *Așezare la mese* | Who sits at which table. Guests see their own table only after the planner publishes the plan (*Ce văd invitații*) |
| **Parking facts** | — | What the venue states about parking; each fact is known or unknown |
| **Programme / cue list** | *Program* | The moments of the day; a cue list is the detailed running order for one moment, kept in versions |
| **Stationery** | *Invitații și papetărie* | Invitation, save-the-date, menu, table and place cards, thank-you cards from one design. A saved version cannot change; a *proof* (*probă*) is the on-screen copy you check before printing |
| **Print pack** | *Tipărire și export* | Print-ready PDFs: QR labels, QR invitations, table cards, the room plan to scale |
| **Public page** | *Pagina publică* / *Pagina evenimentului* | An optional published page for an event, with registration and a waiting list (*Lista de așteptare*) |
| **Private request** | *Cereri private* | A guest's dietary or access need, visible only to members with that grant, removed 30 days after the occasion closes |
| **Gift estimator** | *Calculator dar* | A private planning aid suggesting a customary money-gift range. A cultural guide only; nobody else sees it |
| **Arrangement** | *Aranjamente florale* | A flower arrangement designed from catalogue items, with an indicative cost (*Cost orientativ — nu este o ofertă*) |
| **Catalogue** | *Catalog de flori* | A florist's published list of flowers with seasons and indicative prices |

## Travel and operating the day

| Term | Romanian on screen | Meaning |
| --- | --- | --- |
| **Itinerary / leg** | *Itinerar și cazare* | The journey as legs, each with its own local times at both ends |
| **Subgroup** | — | Part of a travelling group with its own plans |
| **Settlement** | — | Who owes whom after a trip, per currency. Currencies are never converted automatically |
| **Rehearsal** | *Repetiția zilei* | Stepping through the day to see clashes, without changing anything |
| **Check-in** | *Check-in* | Recording that a household arrived, by name or by scanning its QR code. An arrival is a fact |
| **Offline capture** | *Sincronizare* | Recording arrivals and your own checklist ticks without a network; they are sent once when the connection returns, and clashes are shown rather than hidden |
| **Sustainability goal** | *Sustenabilitate* | An optional target with measured quantities |

## Platform and code words

| Term | Meaning |
| --- | --- |
| **PRD** | The product requirements document, `docs/PRD.md`. It wins over every other document |
| **Requirement id** | The labels in the PRD: A1, B3, P13, V7, SEC4, LAU1… `09-traceability.md` has a row for each |
| **Release 0, A, B, P, C, D, E** | The seven stages the product was built in |
| **Gate (M0–M5)** | A go/no-go checkpoint in the PRD that depends on real-world evidence |
| **Launch obligation (LAU1–LAU9)** | Things that must be true around the software before launch: legal texts, registrations, penetration test, monitoring |
| **Operator** | The organisation running EventDesk.ro, and the decisions only it can make |
| **Invariant** | A rule the product must never break; twelve are listed in this folder's `README.md` |
| **Seam** | A prepared plug-in point where an outside service will be connected, with a stand-in for development. Not an integration |
| **Dormant** | Built and tested, but switched off and unreachable (payments, Featured) |
| **Core** | `packages/core` — where every business rule and access check lives |
| **Ctx / actor** | The "who is doing this" passed to every core function: an account, a guest link, a staff member, an AI token, the system, or nobody |
| **Registry** | A list one part of the code owns and others add to — how features in different areas connect |
| **Migration** | A recorded change to the database structure, applied with `pnpm db:migrate` |
| **SQL guard** | A rule inside the database that refuses certain changes whatever the app does |
| **Purge** | Final deletion after the seven-day undo has passed |
| **Retention** | How long a kind of data is kept before it is deleted automatically |
| **Worker / job / schedule** | The background program; a unit of its work; a job that repeats at set times |
| **Audit log** | The permanent record of who changed what. Nobody can edit or delete it |
| **MCP / assistant token** | The connection that lets a person's own AI assistant read their plan and propose changes. On screen: *Asistenți AI* |
| **Fair use** | The limits on a free service: storage per occasion and business, emails per day, AI text results per month |
| **Maison** | The name of EventDesk's design language |
| **Deploy / rollback** | Putting a new version live; returning to the previous one |
| **Tag** | A named, fixed point in the code's history, such as `v1.4.0`. Only tags are deployed |
| **CI** | The automated checks that run on every change |
