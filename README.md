# Sunrise Interiors — Live Voice Agent Demo

A web page with one button. Click it, and an AI voice agent places a **real
outbound phone call** to an allowlisted Indian mobile within ~10 seconds, has a
natural 60–90s conversation in **Hindi / Hinglish / English**, qualifies the
lead, books a designer slot, and then shows the **transcript, extracted
qualification fields, booking, and cost in ₹** on the page.

Built for the demo moment: open the page in a client meeting, click, put the
phone on speaker, let the client hear the agent talk.

---

## Architecture

```
┌─────────────┐   click     ┌──────────────────────────────┐
│  Browser    │────────────▶│  Next.js on Vercel           │
│  (page.tsx) │  POST        │                              │
│             │  { index }   │  /api/config  → masked list  │
│             │◀────────────│  /api/call    → place call    │
│  polls      │  { callId }  │  /api/call-status → poll      │
│  every 2s   │─────────────▶│                              │
└─────────────┘             │  ── allowlist (server only) ──│
      ▲                     │  ── provider adapter ─────────│
      │ transcript,         └───────────────┬──────────────┘
      │ fields, ₹cost                       │  server-side key
      │                                      ▼
      │                          ┌───────────────────────┐
      │                          │  Vapi  (default)      │
      │                          │  STT (Deepgram multi) │
      │                          │  LLM (gpt-4o-mini)    │
      │                          │  TTS (Indian voice)   │
      │                          │  + Twilio number      │
      │                          └───────────┬───────────┘
      │                                      │ PSTN
      │                                      ▼
      └──────────────────────────  📱 Indian mobile (Jio/Airtel)

Swap VOICE_PROVIDER=bolna to route the same flow through Bolna + Plivo/Exotel.
```

**Key design choices**

- **Browser never sees a phone number.** It sends an *index* into a server-side
  allowlist (`ALLOWED_NUMBERS`). The server maps index → number. A visitor
  cannot express an arbitrary number to dial — the enforcement is structural,
  not a validation check that can be bypassed. (`lib/allowlist.ts`,
  `app/api/call/route.ts`)
- **No keys in the browser.** Every secret is a server-only env var (no
  `NEXT_PUBLIC_` prefix). Keys never enter the frontend bundle or the repo.
- **Provider-agnostic.** `lib/providers/*` implements one `VoiceProvider`
  interface. Vapi and Bolna are both fully wired; switching is one env var.
- **No database needed.** Status/transcript/cost are polled from the provider's
  own `GET /call/{id}` server-side, so there is no extra storage account and no
  webhook to expose.

---

## Run locally

```bash
npm install
cp .env.example .env.local     # then fill in real values (see below)
npm run dev                    # http://localhost:3000
```

> Local dev can trigger a real call once keys are set — it costs real money.

---

## Deploy (Vercel)

1. Push this repo to GitHub (public).
2. Import into Vercel (Framework: **Next.js**, auto-detected).
3. Add the environment variables below in **Project → Settings → Environment
   Variables** (Production).
4. Deploy. You get a public URL.

---

## One-time setup checklist (Vapi + Twilio — the default stack)

1. **Twilio** → create account (trial credit covers the demo). Buy or use the
   trial number. On a trial account, verify your own Indian number under
   *Verified Caller IDs* — trial accounts can only call verified numbers, which
   conveniently doubles as a hard allowlist.
2. **Vapi** → sign up at `dashboard.vapi.ai` ($10 free credit).
   - **API Keys** → copy the **private** key → `VAPI_PRIVATE_KEY`.
   - **Phone Numbers** → *Import from Twilio* (paste Twilio SID + auth token +
     the number) → copy the resulting phone-number **id** → `VAPI_PHONE_NUMBER_ID`.
   - **Voice**: default is bundled 11labs. For the best Hinglish, add a Sarvam
     key in Vapi and set `VOICE_PROVIDER_NAME=sarvam` + `VOICE_ID=<sarvam voice>`.
3. **Allowlist** → `ALLOWED_NUMBERS=+9198XXXXXXXX` (your consented phone), and
   optional `ALLOWED_LABELS=Demo lead`.
4. Deploy. Open the URL, pick the lead, click **Call me now**.

### Alternative stack (Bolna) — set `VOICE_PROVIDER=bolna`

1. **Bolna** → `platform.bolna.ai`. Create an **agent**: paste the same system
   prompt from `lib/providers/vapi.ts`, attach a telephony provider
   (Plivo/Exotel/Twilio) and an Indian voice (Sarvam/Smallest), and configure
   post-call extraction with keys `need, urgency, slot_offered, slot_confirmed,
   interested, caller_is_right_person, language`.
2. Copy `BOLNA_API_KEY` + `BOLNA_AGENT_ID`. Set `VOICE_PROVIDER=bolna`. Deploy.

---

## Environment variables

| Var | Required | What |
|-----|----------|------|
| `VOICE_PROVIDER` | no | `vapi` (default) or `bolna` |
| `VAPI_PRIVATE_KEY` | vapi | Vapi private API key (server-only) |
| `VAPI_PHONE_NUMBER_ID` | vapi | Imported Twilio number id in Vapi |
| `BOLNA_API_KEY` | bolna | Bolna API key |
| `BOLNA_AGENT_ID` | bolna | Bolna agent id |
| `BOLNA_FROM_NUMBER` | no | Outbound caller number in Bolna |
| `ALLOWED_NUMBERS` | **yes** | Comma-sep E.164 numbers the app may dial |
| `ALLOWED_LABELS` | no | Friendly labels, same order |
| `VOICE_PROVIDER_NAME` | no | TTS provider (default `11labs`) |
| `VOICE_ID` | no | Voice id for the chosen TTS provider |
| `LLM_MODEL` | no | Default `gpt-4o-mini` |
| `USD_TO_INR` | no | Rate for ₹ display (default `86`) |

Full annotated list: **`.env.example`**.

---

## Cost per call

The page shows the exact cost of each call in ₹ (from the provider's own cost
field × `USD_TO_INR`). Model + measured numbers are in **`DECISIONS.md`**.
Ballpark for a ~75-second call (STT + LLM + TTS + telephony combined):
**≈ ₹23–30 on Vapi + Twilio** (Twilio's India termination is the costly part),
vs. **≈ ₹11–17 on Bolna + Plivo/Exotel** — which is why the low-cost path is
Bolna. The measured value from the live call is the source of truth.

---

## Security / safety notes

- Server-side allowlist by **index** — arbitrary dialing is impossible by design.
- All keys server-only; nothing secret in the client bundle or git history.
- 20-second per-IP throttle (`lib/ratelimit.ts`) to stop spamming paid calls.
- `maxDurationSeconds` + `silenceTimeoutSeconds` + end-call phrases prevent dead
  air, infinite loops, and hung lines.

See **`DECISIONS.md`** for platform comparison, latency, regulatory analysis,
and the two-week roadmap.
