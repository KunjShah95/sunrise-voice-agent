# Sunrise Interiors — Live Voice Agent Demo

A web page with one button. Click it, and an AI voice agent places a **real
outbound phone call** to an Indian mobile within ~10 seconds, has a natural
60–90s conversation in **Hindi / Hinglish / English**, qualifies the lead, books
a designer slot, and then shows the **transcript (as speaker turns), extracted
qualification, booking, connect-latency, and cost in ₹** on the page.

Built for the demo moment: open the page in a client meeting, click, put the
phone on speaker, let the client hear the agent talk.

**Live-verified:** two real calls to a Jio/Airtel handset — **₹2.5 and ₹3.75**
(~₹2.6–3.4/min), transcript + summary + booking captured. See `DECISIONS.md` §8.

> **Primary stack = Bolna (Indian): Sarvam voice + Indian telephony**, chosen for
> cost (~6–8× cheaper than a US stack dialing +91) and native Hinglish. **Vapi +
> Twilio** is a fully-wired fallback (`VOICE_PROVIDER=vapi`). Same code, one env.

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
      │                          │  Bolna  (primary)     │
      │                          │  STT + LLM + TTS =     │
      │                          │  Sarvam (Hinglish)    │
      │                          │  + Indian number      │
      │                          └───────────┬───────────┘
      │                                      │ PSTN (domestic)
      │                                      ▼
      └──────────────────────────  📱 Indian mobile (Jio/Airtel)

Swap VOICE_PROVIDER=vapi to route the same flow through Vapi + Twilio (fallback).
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

## One-time setup checklist (Bolna — the primary stack)

1. **Bolna** → `platform.bolna.ai` (trial credit covers the demo).
   - **API Keys** → copy → `BOLNA_API_KEY`.
   - **Create an agent** → paste the prompt + welcome message from
     **`lib/prompt.ts`** (`SYSTEM_PROMPT` → Prompt, `FIRST_MESSAGE` → Welcome).
     Remove any transfer/handoff node — Ria handles the whole call herself.
   - **Voice / STT** → **Sarvam** (Bulbul TTS + Saarika STT), multilingual /
     code-switch ON, Hindi female voice. Copy the **agent id** → `BOLNA_AGENT_ID`.
   - **Post-call extraction** → add fields `caller_is_right_person, need,
     urgency, slot_offered, slot_confirmed, interested, language, summary`.
   - **Telephony** → for the demo, Bolna places calls from the **agent's default
     number** — `BOLNA_FROM_NUMBER` can stay blank. For production, buy a
     DLT-cleared Indian number (Bolna → Vobiz/Plivo, ~$5/mo) and set it.
2. Set `VOICE_PROVIDER=bolna`. Add your consented phone to `ALLOWED_NUMBERS`.
3. Deploy. Open the URL, pick the lead (or type a number in demo mode), click
   **Call now**.

> **Live-verified:** this exact setup placed real calls at **₹2.5–3.75/call**
> (~₹2.6–3.4/min) with transcript + summary + booking. Bolna bills in **₹**.

### Fallback stack (Vapi + Twilio) — set `VOICE_PROVIDER=vapi`

1. **Vapi** → `dashboard.vapi.ai` ($10 credit). **API Keys** → private key →
   `VAPI_PRIVATE_KEY`. **Phone Numbers** → *Import from Twilio* → id →
   `VAPI_PHONE_NUMBER_ID`.
2. **Voice** — Vapi does **not** support Sarvam. Indian-capable Vapi voices:
   `azure` (`hi-IN-SwaraNeural`, bundled), `smallest-ai`, or Indian `11labs`.
   Ships with `VOICE_PROVIDER_NAME=azure`, `VOICE_ID=hi-IN-SwaraNeural`.
3. Set `VOICE_PROVIDER=vapi`. Deploy.

> **Cost caveat:** a US Twilio number dialing +91 bills as **international**
> (~₹18–24/min) — ~6–8× Bolna. Plus Twilio trial prepends a "press any key"
> preamble and only dials verified numbers. This is why Bolna is the primary.

---

## Environment variables

| Var | Required | What |
|-----|----------|------|
| `VOICE_PROVIDER` | no | `bolna` (primary) or `vapi` (fallback) |
| `BOLNA_API_KEY` | bolna | Bolna API key |
| `BOLNA_AGENT_ID` | bolna | Bolna agent id |
| `BOLNA_FROM_NUMBER` | no | Outbound caller number (blank = agent default) |
| `VAPI_PRIVATE_KEY` | vapi | Vapi private API key (server-only) |
| `VAPI_PHONE_NUMBER_ID` | vapi | Imported Twilio number id in Vapi |
| `ALLOWED_NUMBERS` | **yes**¹ | Comma-sep E.164 numbers the app may dial |
| `ALLOWED_LABELS` | no | Friendly labels, same order |
| `DEMO_MODE` | no | `1` = "Call my number" tab dials any typed number (consent-gated, IP-limited). **Leave blank on a public deploy** — see Security |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_VERIFY_SERVICE_SID` | no² | Enables OTP verify-then-call so a lead can self-serve their own number safely |
| `VOICE_PROVIDER_NAME` | no | Vapi TTS provider: `azure` (default), `11labs`, `smallest-ai` |
| `VOICE_ID` | no | Voice id, e.g. `hi-IN-SwaraNeural` |
| `LLM_MODEL` | no | Default `gpt-4o-mini` (Vapi path) |
| `USD_TO_INR` | no | Rate for the USD parity figure (default `86`; Bolna bills in ₹) |

¹ Required unless `DEMO_MODE=1` (which dials typed numbers instead).
² All three needed together, or the OTP feature stays hidden.

Full annotated list: **`.env.example`**.

---

## Cost per call

The page shows the exact ₹ cost of each call, read from the provider's own cost
field. **Measured on live calls (Bolna, source of truth):**

| Call | Duration | Cost | Per-minute |
|------|----------|------|-----------|
| A | 67 s | **₹3.75** | ~₹3.4/min |
| B | 58 s | **₹2.50** | ~₹2.6/min |

Bolna bills in ₹ (`platform + network`, ~6–8× cheaper than a US Twilio number
dialing +91 at ~₹18–24/min international). Full model, the ₹2/min self-host path,
and the cost-unit gotcha are in **`DECISIONS.md`** §8–§10.

---

## Security / safety notes

- **Server-side allowlist by index** — the browser sends an *index*, never a raw
  number. Arbitrary dialing is impossible by design (`lib/allowlist.ts`).
- **OTP verify-then-call** (optional) — a lead can enter their **own** number,
  prove ownership via SMS code (Twilio Verify), and only then is it dialed. Lets
  users self-serve without opening arbitrary dialing (`lib/verify.ts`).
- **`DEMO_MODE` boundary (read this before deploying):** with `DEMO_MODE=1` the
  "Call my number" tab dials any typed number — gated by E.164 validation, a
  per-IP throttle, and an explicit **consent checkbox**. This is an **operator
  tool for a supervised live demo, not a public feature.** On a public deploy it
  would let any visitor dial any number. **The graded/public URL must run with
  `DEMO_MODE` unset**, which re-enables the allowlist/OTP paths.
- All keys server-only; nothing secret in the client bundle or git history.
- 20-second per-IP throttle (`lib/ratelimit.ts`) to stop spamming paid calls.
- `maxDurationSeconds` + `silenceTimeoutSeconds` + end-call phrases prevent dead
  air, infinite loops, and hung lines.

See **`DECISIONS.md`** for platform comparison, latency, regulatory analysis,
and the two-week roadmap.
