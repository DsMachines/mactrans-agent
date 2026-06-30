# Mactrans ARIA — Architecture & Handoff Doc

This is the working reference for continuing development on this project in a new
conversation. It captures the original request, what's been built, what's real vs.
simulated, and where the known gaps are.

Live demo: https://mactrans-agent.vercel.app/
Repo: https://github.com/DsMachines/mactrans-agent (auto-deploys `main` → Vercel)

## 1. What this app is

"Mactrans ARIA" is a demo of an autonomous AI freight-broker agent for a fictional
Malaysian logistics company. It simulates an end-to-end RFQ → quote → negotiation
workflow, built to be presented live to a client whose team includes an IT specialist
— so the demo had to look and behave like a real system, including one genuine
external API call, while the rest of the "integrations" are convincing simulations.

## 2. Original request (verbatim intent, lightly trimmed)

The client wanted the demo to work like this:

1. Client emails in an RFQ → agent extracts the cargo/route details → builds a draft
   quote → **sales admin reviews/edits/approves** → agent emails the quote to the
   client → client negotiates → agent replies → **any price decision needs sales
   admin sign-off via a WhatsApp-style chat interface, and only after the admin says
   so does anything actually go out to the client.**
2. While working, the agent should narrate its reasoning step by step, "like it's
   really connecting to a database/API," specifically:
   - Connect to **Google Maps** to measure round-trip distance: hub → pickup →
     destination → hub.
   - Compute a cost-per-km from that distance.
   - Fetch (or simulate) **weather** for the requested ship date — if no real
     forecast is available, narrate "predicting from seasonal historical patterns"
     (monsoon, flood, landslide, haze, etc.)
   - Reference a **route incident history** (5 dummy but realistic-sounding past
     incidents — low bridge clearance, potholes, narrow corners, market-day
     congestion, flood history) — narrated one at a time, not summarized.
   - Check a **truck fleet/engine-management** system and exclude any truck with
     bad brakes/worn tires given the route's risk profile.
   - Confirm the selected truck + driver as its own visible step.
   - Then calculate the final quote (margin, insurance, escort, handling, etc.) for
     the sales admin to review.
3. If the client pushes for a bigger discount after the admin already approved one,
   the agent should **re-analyze** (idle schedule / weather / traffic) and propose a
   **different ship date** at a genuinely lower, mechanically-derived price — not an
   arbitrary discount.
4. Everything except one piece must be fake-but-convincing. **Exactly one real
   integration was requested: Google Maps**, because the audience has technical
   people who might probe it — "we need it to work correctly and not fail in demo."
   The user explicitly chose **Google Maps Distance Matrix only** as the real
   integration; everything else (weather, incident log, fleet status) is deliberately
   simulated, with realistic-looking step-by-step narration so it doesn't read as
   fake during a live run.
5. Admin approval had to be **real freeform interpretation**, not yes/no keyword
   matching — the admin types whatever they want in the WhatsApp box and a real
   Claude call decides what to do.

Original raw notes are preserved at `../masterplan-v3.md` (one level above this repo).

## 3. Tech stack

- **Frontend**: React 19 + Vite 8 (`src/`), plain inline-style components (no CSS
  framework), ESM (`"type": "module"` in root `package.json`).
- **Backend**: Vercel serverless functions, Node.js 20, CommonJS (`api/package.json`
  sets `{"type": "commonjs"}` — this is a deliberate split from the ESM frontend in
  the same repo; don't "fix" this mismatch, it's required for Vercel's function
  runtime).
- **LLM**: Anthropic SDK (`@anthropic-ai/sdk`), model `claude-haiku-4-5-20251001`,
  used via direct `messages.create()` calls — sometimes in a manual agentic
  tool-use loop, sometimes as a single bounded call.
- **Deploy**: Vercel, auto-deploy on push to `main` of the GitHub repo above.
- **No database** — everything is either real-time LLM output or in-memory mock
  data defined directly in `api/lib/mockTools.js`.

## 4. High-level request flow

```
Browser (src/App.jsx)
   │  POST /api/agent  { rfq_text }
   ▼
api/agent.js  (SSE stream)
   │  Claude tool-use loop (11 tools, see §6) → narrates each step as it goes
   │  ends with [EMAIL_DRAFT] + [WHATSAPP_MESSAGE] → emits `pending_action`
   ▼
Browser shows: draft email (Outlook sim) + WhatsApp prompt — NOTHING is "sent" yet
   │
   │  Sales admin either:
   │   (a) clicks "Amend Quote" → edits line items client-side → Recalculate
   │       → POST /api/agent { mode: "regenerate_email", amended_values }
   │   (b) types freeform reply in WhatsApp
   │       → POST /api/admin-chat { pending_action, admin_message, chat_history }
   ▼
Admin approves (real Claude decision, see §7) → email flips to "sent" client-side
   │
   │  Presenter clicks "Simulate Client Counter-Offer" (simulates the absent client)
   ▼
POST /api/negotiate  { original_quote_myr, counter_offer_myr, minimum_acceptable_myr }
   │  same admin-approval gate as above
   │
   │  Presenter clicks "Client Pushes for More"
   ▼
POST /api/negotiate  { mode: "alternate_date", ... }
   │  re-runs check_alternate_schedule → proposes new ship date/time/driver at a
   │  price that mechanically matches (or gets as close as possible to) what the
   │  client asked for — same admin-approval gate again
```

Throughout, the WhatsApp chat (`/api/admin-chat`) is **always available** — it is not
gated to only work while something is pending. With nothing pending it falls back to
a plain conversational mode grounded in the most recent email/client context.

## 5. Key design patterns (read this before changing anything)

- **SSE streaming**: `api/agent.js` and `api/negotiate.js` stream
  `data: {...}\n\n` events; the client reads them via a manual `ReadableStream`
  reader in `App.jsx`'s `readStream()`, dispatched through `src/lib/sseParser.js`'s
  `routeEvent()`. `api/admin-chat.js` is plain JSON (single bounded call, no
  streaming needed).
- **Admin-approval gate**: nothing is ever marked "sent" by the backend itself.
  Every client-facing draft ends with a `pending_action` event
  (`{action_id, action_type, summary, email_ref, whatsapp_prompt, quote_snapshot}`).
  The frontend only flips an email's `status` from `'draft'` to `'sent'` once the
  admin approves via `/api/admin-chat`. `done` means "the SSE stream finished," not
  "this was sent."
- **Marker-based output parsing**: every Claude call that drafts client-facing text
  ends with `[EMAIL_DRAFT]...[WHATSAPP_MESSAGE]...`, parsed via a regex
  `parseOutputBlocks()` (duplicated in `agent.js`/`negotiate.js`/`admin-chat.js` —
  not factored into a shared module, be aware if you fix a bug in one copy).
- **`quote_snapshot` has THREE different shapes** depending on action_type — this
  was the source of several bugs, know it before touching pricing logic:
  - `send_quote_email` (first quote): raw `calculate_quote` tool output — uses
    **`final_quote_myr`** for the total, plus `base_rate_myr`, `fuel_surcharge_myr`,
    `insurance_fee_myr`, `escort_fee_myr`, `handling_fee_myr`,
    `weather_contingency_myr`, `discount_applied_myr`, `minimum_acceptable_myr`,
    `breakeven_myr` (never expose this one to the client).
  - `send_amended_quote_email` (after manual Amend Quote edit): same line-item
    fields, but the total field is **`total_quote_myr`** instead.
  - `send_negotiation_reply` / `send_alternate_offer`: no line items at all, just a
    flat **`final_offer_myr`** or **`final_quote_myr`** + `minimum_acceptable_myr`.
  - The `rate_card` SSE event (drives the visible Rate Card panel) always remaps
    whatever the source total field is into `total_quote_myr` for display — so
    `pending_action.quote_snapshot` and the `rateCard` React state are NOT the same
    shape even for the same quote. `api/admin-chat.js`'s `applyPatch()`/
    `recomputeSnapshot` logic and `App.jsx`'s `handleAdminChatSend` both
    explicitly handle this by checking `total_quote_myr ?? final_quote_myr ??
    final_offer_myr` rather than assuming one field name.
- **Generic quote-patch mechanism** (`api/admin-chat.js`): rather than hardcoding
  per-action-type editable fields, the admin's chat instruction is turned into a
  JSON patch (`[QUOTE_PATCH: {...}]`) validated against a fixed whitelist of known
  numeric field names (`EDITABLE_KEYS`) AND the current snapshot's actual present
  keys. The total is **always recalculated in code** from the patched line items
  (`applyPatch()`) — never trusted from the model's own arithmetic or from a number
  that merely appears in background JSON context (that exact failure mode caused a
  bug where a model treated `quote_snapshot.total_quote_myr` as if the admin had
  typed it).
- **Safety net on the admin-chat decision**: if Claude says `approve` but the
  admin's *current* message (not full history — history-scoped checks caused a
  separate stuck-loop bug) contains edit-intent language or a number with no
  patch produced, the server forces `decision: "clarify"` rather than silently
  sending an unchanged draft.
- **Safe Mode**: `src/data/fallbackPayload.js` holds 3 scripted SSE event arrays
  (initial quote, negotiation, alternate-date) replayed via `setTimeout` through the
  same `routeEvent()` dispatcher, for offline/no-API-key demo safety. The WhatsApp
  admin-chat stays **real** even in Safe Mode — it's the single most novel
  capability being demonstrated, so a scripted "admin typed: approve" would be
  exactly what a technical observer would catch as fake.
- **Dynamic client & RFQ extraction**: `extract_rfq_data` does not return canned data
  — it takes Claude's own structured reading of the pasted email as tool args (client
  name, contact, route, cargo, `required_by_date`, etc.), normalized with business-rule
  defaults (insurance/escort thresholds) rather than re-derived from the raw text
  server-side. The result reaches the frontend via a dedicated `client_info` SSE event
  into `App.jsx`'s `clientInfo` state; `effectiveClient = clientInfo ||
  DEFAULT_CLIENT_INFO` (the latter in `src/data/defaultRfq.js`) is the single source of
  truth used everywhere identity/route/deadline is needed — negotiation emails, the
  RateCard's RFQ tag/route line, alternate-date negotiation. There is no hardcoded
  identity path once something has actually been deployed; `DEFAULT_CLIENT_INFO` only
  covers Safe Mode / pre-deploy fallback.
- **Deadline-aware alternate scheduling**: the extracted `required_by_date` threads
  end-to-end — `client_info` → `effectiveClient.required_by_date` →
  `/api/negotiate`'s `deadline_date` param → `check_alternate_schedule`'s tool schema.
  The mock tool tries shifting the ship date forward by `[4, 3, 2, 1]` days, picking
  the largest shift that still lands on/before the deadline; if even a 1-day shift
  would miss it, it returns `feasible: false` with no date at all rather than
  fabricating one past the deadline. `negotiate.js`'s prompt is told explicitly to
  hold firm and draft an honest "the approved floor price stands" email in that case
  — never to invent or override the tool's own date. **Known gap**: if the deadline
  itself is unknown (extraction found none), there's nothing to clamp against and the
  flow can get stuck asking a clarifying question with no way to resume — see §11.

## 6. The 11-step agent mission (`api/lib/systemPrompt.js` + `api/agent.js`)

In order, each its own narrated step + tool call:

1. `extract_rfq_data` — Claude's own structured reading of the pasted email (client
   identity, contact, route, cargo, `required_by_date`) passed as tool args and
   normalized with business-rule defaults — never re-guessed server-side, never falls
   back to canned example data (§5)
2. `get_route` — base routing/traffic data
3. `get_distance_real` — **the one real integration** (§8)
4. `calculate_cost_per_km` — pure math, no API
5. `get_weather_forecast` — simulated (§8)
6. `get_route_incident_log` — 5 fixed dummy incidents for the KL→Penang route
   (`ROUTE_INCIDENT_LOG['KUA-PEN-001']` in `mockTools.js`), narrated one at a time
7. `get_fleet_status` — 4-truck fixed fleet (`FLEET_TABLE`); `NHT-014` is always
   flagged unsuitable (poor brakes, 86% tire wear) so the agent has something
   concrete to exclude
8. `select_truck_and_driver` — confirms the pick as its own discrete step
9. `calculate_quote` — final pricing (line items + auto 5% "goodwill" discount —
   this was the "hidden discount" the user found and asked to be able to edit; it's
   intentional/pre-existing, now fully editable via the Rate Card and chat)
10. Draft client email (`[EMAIL_DRAFT]`)
11. Draft WhatsApp approval request (`[WHATSAPP_MESSAGE]`) — explicitly NOT a
    confirmation; the system prompt forbids saying "sent."

## 7. Admin-chat decision model (`api/admin-chat.js`)

Two distinct prompt/marker conventions depending on whether a `pending_action` is open.

**With an open `pending_action`** (`ADMIN_CHAT_PROMPT`) — single Claude call (no
tools), ends with:
```
[DECISION: approve|reject|clarify]
[QUOTE_PATCH: {...}|none]
```
- `approve` + no patch → flip the referenced email to `'sent'`, nothing else changes.
- `approve` + patch → patch validated against the current `quote_snapshot`'s actual
  numeric fields → total recalculated in code → a **second**, tool-free Claude call
  redrafts the email/WhatsApp text using the new figures as authoritative (told
  explicitly not to recalculate) → email marked `'sent'` with the new body.
- `reject` / `clarify` → conversation continues, nothing changes.

**With no `pending_action`** (`GENERAL_CHAT_PROMPT`) — this is what keeps the WhatsApp
chat always-on instead of freezing once nothing is pending. Still a single bounded
call, but ends with a different marker:
```
[ACTION: send_email|none]
```
- `none` → plain conversational reply, nothing else happens (the default — most
  messages in this mode are just chat/questions, answered from whatever client/email
  context is passed in).
- `send_email` → the admin's instruction (this message + chat history) is a confirmed
  ask to compose and send a brand-new client email not tied to any existing draft
  (e.g. "draft email asking about his deadline" → ARIA asks a clarifying question →
  admin confirms with "yes") → a second, tool-free Claude call (same shape as the
  quote-patch regen above) drafts a fresh `[EMAIL_DRAFT]`/`[WHATSAPP_MESSAGE]` pair
  from the full conversation → `App.jsx`'s `handleAdminChatSend` appends it as a
  brand-new `emails` entry (`id: email-adhoc-<timestamp>`, status `'sent'`
  immediately — the admin's confirmation *within this same chat* is the approval,
  there's no further gate after that).
  - **Known model quirk**: Claude sometimes echoes the literal `send_email|none`
    template instead of substituting one value. The parser treats any occurrence of
    the substring `send_email` inside the `[ACTION: ...]` tag as the positive signal
    rather than requiring an exact match — every observed case of the literal echo
    co-occurred with a reply that had already confirmed intent in plain text (e.g.
    "Perfect, sending that to Ahmad now"), so this is a safe loosening, not a blind
    override.
  - **Not yet built**: this same freeform-instruction pattern is the natural building
    block for a planned next step — simulated client deadline replies feeding a
    repeated admin-directed requote loop, ending in a final "can't drop any further"
    email — see §11.

## 8. Real vs. simulated integrations — current status

| Capability | Status | Notes |
|---|---|---|
| **Google Maps Distance Matrix** | Built, **not yet activated** | `get_distance_real()` in `api/lib/mockTools.js` makes one real `GET https://maps.googleapis.com/maps/api/distancematrix/json` call (hub→origin→destination→hub in a single request) when `GOOGLE_MAPS_API_KEY` is set in the environment. **As of this doc, that key is NOT present in `.env` or confirmed in Vercel's project settings** — the user deferred this ("I'll handle it later"). Until it's set, every run silently uses the deterministic fallback (`internal_estimation_model`), which is narration-identical (the system prompt forbids ever mentioning "Maps," "API," or "fallback"). **To activate**: create a Google Cloud project → enable Distance Matrix API → create + restrict an API key → add `GOOGLE_MAPS_API_KEY` to local `.env` AND to Vercel → Project Settings → Environment Variables → redeploy. No code changes needed. |
| **Weather forecast** | Fully simulated, by design | `get_weather_forecast()` deterministically (hash of date+region, not random) picks from a fixed pool of Malaysia-appropriate seasonal conditions (`WEATHER_PATTERNS` in `mockTools.js`). This was **never meant to be real** per the original request — the client explicitly only wanted Google Maps as the real integration. **This is the natural next candidate if a second real integration is ever wanted** — e.g. a real weather API (OpenWeatherMap, WeatherAPI, etc.) keyed off `ship_date`/`destination_region`, with the same kind of deterministic, narration-identical fallback pattern already proven out for distance. |
| Route incident log | Simulated (fixed 5-entry dataset) | Not a candidate for "real" — there's no real backing data source for this in the original request. |
| Fleet/engine-management status | Simulated (fixed 4-truck dataset) | Same — no real data source intended. |
| Admin-chat decision interpretation | **Real** | Genuine Claude call, freeform — this was always meant to be real, not a fallback candidate. |

## 9. File map

```
api/
  agent.js            SSE endpoint — initial RFQ → quote flow, + dedicated
                       regenerate_email path (tool-free, used by manual Amend Quote)
  negotiate.js         SSE endpoint — counter-offer evaluation + alternate-date flow
  admin-chat.js         Plain JSON endpoint — WhatsApp admin decision/patch interpreter
  lib/
    systemPrompt.js     The 11-step ARIA mission prompt + narration/business rules
    mockTools.js        All 13 tool implementations + fixed mock datasets

src/
  App.jsx               Top-level state, SSE consumption, all handler functions
  lib/
    sseParser.js        Routes SSE events to App.jsx state dispatchers
    markdownToHtml.js    Three renderers sharing inline-bold/escape helpers:
                         `renderEmailBodyHtml` (emails), `renderNarrationHtml`
                         (terminal narration — truncates at output markers, strips
                         trailing junk lines), `renderChatHtml` (WhatsApp bubbles,
                         inline-bold only)
  components/
    InputMatrix.jsx      Left panel — RFQ input, Safe Mode toggle, Deploy button
    AgentTerminal.jsx    Middle panel — structured reasoning-trace timeline (condensed
                         IN/OUT per tool call via `toolMeta.js`, decision-step
                         highlighting, raw-JSON-on-demand toggle) — NOT a raw JSON/text
                         dump; this is the presentation layer for the tool-use loop,
                         distinct from the email/WhatsApp output views
    OutputPanel.jsx      Right panel — stacks RateCard + OutlookSimulator +
                         WhatsAppSimulator, plus the presenter action-button row
    RateCard.jsx         Editable line-item quote display ("Amend Quote" mode); RFQ
                         tag/route line are dynamic (`client_rfq_id`/`route_label`/
                         `route_distance_km` from the `rate_card` event) with
                         hardcoded-string fallback for Safe Mode
    OutlookSimulator.jsx Fake Outlook inbox — renders every entry in the `emails`
                         array as its own thread card (not single-email selection),
                         email bodies as HTML
    WhatsAppSimulator.jsx Fake WhatsApp thread — always-enabled input, real backend
                         call, renders message text via `renderChatHtml`
  data/
    defaultRfq.js        Default sample RFQ text + `DEFAULT_CLIENT_INFO` fallback
                         identity (used by Safe Mode / before anything is deployed)
    fallbackPayload.js    Safe Mode scripted event sequences (3 arrays, see §5)
    toolMeta.js           Per-tool presentation metadata for AgentTerminal — icon,
                         label, `isDecision` flag, `summarizeIn(args)`/
                         `summarizeOut(result)` for all known tools + a generic
                         fallback (`getToolMeta(name)`)

vercel.json              Function maxDuration overrides (agent 90s, negotiate 60s,
                         admin-chat 20s) + API rewrites
api/package.json         {"type": "commonjs"} — deliberate split from root ESM
masterplan-v3.md          (one level up) original raw client requirements
```

## 10. Safe development workflow for future changes

Established and proven on the dynamic-RFQ-extraction fix (see §6/§8 history) — use this
same sequence for future UX/feature work in this repo so `main` (and therefore the live
`mactrans-agent.vercel.app` deploy) is never at risk mid-change:

1. **Branch before touching anything**: `git checkout -b feature/<name>` off `main`.
   `main` stays untouched and deployable for the entire duration of the work — worst
   case is `git checkout main` or deleting the branch, zero blast radius.
2. **Plan non-trivial/multi-file changes before coding** — read the affected files fully
   first (this repo has cross-cutting hardcoded values that aren't obvious from a single
   file, e.g. client identity was duplicated across `api/agent.js`, `App.jsx`, and
   `RateCard.jsx`); confirm scope with the user before writing code if the change touches
   more than 1-2 files or has more than one reasonable approach.
3. **Verify locally before pushing anything**, in this order:
   - `npm run lint` — compare against a `git stash` baseline if unsure whether an error
     is pre-existing (this repo has ~30 pre-existing lint errors from the deliberate
     CommonJS/`api` split and some React effect patterns — don't chase those).
   - `npm run build` — catches JSX/syntax errors fast.
   - For `api/*.js` changes: a throwaway Node script (in the OS scratch/temp dir, never
     committed) that `require()`s the handler directly and feeds it a mock `req`/`res`
     capturing `res.write()` calls, with **two test inputs**: the existing default
     scenario (regression check) and a fabricated different one (to prove the change
     generalizes). This is the standard way to exercise real Claude calls + real
     `mockTools.js` logic without a backend dev server — `npm run dev` only serves the
     Vite frontend, and `vercel dev`'s OAuth flow doesn't complete unattended here.
   - For UI changes: launch `npm run dev`, drive it with browser automation
     (`browser_navigate`/`browser_snapshot`/`browser_click`/`browser_console_messages`)
     against the LAN IP from the Vite output, not `localhost` (browser tooling runs in a
     separate network namespace) — exercise Safe Mode at minimum, since it's the one
     flow that doesn't need a live backend, and check the console for errors.
4. **Push the branch (not `main`) to get a Vercel Preview Deployment**: a real,
   isolated URL with the real backend and real Claude calls, completely separate from
   the production domain. This is the only way to test the live agentic flow (Deploy
   button, negotiation round-trip) end-to-end before it's anywhere near production.
   Confirm correct behavior there with the user before merging.
5. **Merge to `main` only once confirmed**: since `main` hasn't moved during the work,
   this is a fast-forward (`git checkout main && git merge <branch> --ff-only`) — no
   merge commit, no conflict risk. `git push origin main` triggers the real production
   deploy.

## 11. Known gaps / good next steps

1. **Set `GOOGLE_MAPS_API_KEY`** (local `.env` + Vercel env vars) to actually
   activate the real integration — currently running on fallback silently.
2. **Real weather API** — natural second real integration if wanted; reuse the
   `get_distance_real` pattern (try real call with timeout → deterministic fallback
   with identical narration on any failure).
3. `parseOutputBlocks()` is duplicated three times (agent.js, negotiate.js,
   admin-chat.js) — could be factored into `api/lib/` if doing further work there.
4. The Safe Mode scripted payloads (`fallbackPayload.js`) reflect example numbers
   from earlier test runs — if pricing logic changes again, re-verify those
   scripted totals still arithmetically reconcile.
5. No automated test suite — verification throughout has been via direct
   handler invocation scripts (mock `req`/`res`, real Anthropic API calls) since
   `vercel dev`'s OAuth flow couldn't be completed unattended in this environment.
6. **Alternate-date negotiation can get "stuck" when the deadline is unknown** — if
   RFQ extraction didn't find a `required_by_date`, the deadline-aware
   `check_alternate_schedule` logic (§5) has nothing to clamp against, and
   `negotiate.js`'s prompt currently tells Claude to hold firm rather than guess — so
   ARIA asks a clarifying question in plain text with no mechanism to actually receive
   an answer and resume. Repeated "Client Pushes for More" clicks just repeat the same
   dead-end response. Two directions were scoped but not yet built:
   (a) **full ask-and-resume** — `negotiate.js` detects the missing deadline up front,
   asks the admin via WhatsApp with a resumable `pending_action` carrying enough
   context to continue (original/minimum/counter prices, client/route/ship-date), and
   `admin-chat.js` gets a branch that recognizes the admin is answering ARIA's own
   question, parses the date, and re-runs `check_alternate_schedule` directly; or
   (b) **smaller stopgap** — drop the "non-negotiable" framing and have ARIA proceed
   with judgement, flagging the missing date inline in the same drafted message
   instead of refusing to draft at all. The new freeform `send_email` capability (§7)
   is a useful building block for option (a) if/when this is revisited — it's also
   the foundation for the user's next planned step: simulated client deadline replies
   feeding a repeated admin-directed requote loop, ending in a final "can't drop
   further" email.
7. **Minor trailing-markdown artifacts can still appear** in admin-chat WhatsApp
   confirmation text (e.g. a stray `---` separator before a short closing line) — same
   general class of issue already solved for terminal narration
   (`renderNarrationHtml`'s junk-line stripping in `markdownToHtml.js`) but not yet
   applied to this code path; low priority, cosmetic only. Similarly, an unconfirmed
   offer remains open to apply the same trailing-cleanup technique to the email draft
   panel if a `---`/`##` artifact is spotted there again.
