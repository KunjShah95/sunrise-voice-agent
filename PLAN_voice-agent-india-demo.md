# Plan — Live-demo dialing, real transcript/analysis, crafted UI, Indian low-latency ₹2/min stack

## CONFIRMED SCOPE (user approved) — build order
1. **Frontend number → call** (DEMO_MODE), no `.env` step — test on the client's own number live. [runs on current Vapi stack = guaranteed for the demo]
2. **Speaker-turn transcript** — map provider messages → Ria/Customer turns, render + style.
3. **Humanize + latency** — better Indian voice, VAD/endpointing turn-taking, faster first-response.
4. **Sarvam voice via Bolna provider** — finish `lib/providers/bolna.ts` (Sarvam voice + Plivo configured in Bolna dashboard). Indian infra, lower latency, ~₹3–5/min self-serve. Swap via `VOICE_PROVIDER=bolna`.
5. **₹2/min** — true ₹2/min = self-host Pipecat + Sarvam + Plivo (documented; external service, not inside this Next.js app). Cost/INR display + DECISIONS.md write-up.

Sarvam models can't place calls alone → they run under Bolna (managed) or self-host Pipecat (pure ₹2/min). Vapi path stays as the guaranteed demo fallback.


Bundles 5 asks: (A) type client number on frontend → call live, no `.env`; (B) transcript as proper speaker turns; (C) qualification/summary reliably generated; (D) stop it feeling AI-generated; (E) cut latency + cost to ~₹2/min using Indian providers (research list included).

---

## A. Live-demo dialing — type number → call now

**Decision (from user):** free-text number, dial immediately. No OTP, no `.env` allowlist step. Keep E.164 validation + 20s rate-limit. Gate behind `DEMO_MODE` so the public deploy isn't an open dialer.

**Changes**
- `lib/demo.ts` (new) — `demoEnabled()` = `process.env.DEMO_MODE === "1"`.
- `app/api/call/route.ts` — add Path C: `{ number }` accepted **only when `demoEnabled()`**. Validate E.164 (`isValidE164` from `lib/verify.ts`), rate-limit, dial. Keep index + verifiedToken paths.
- `app/api/config/route.ts` — expose `demo: demoEnabled()`.
- `app/page.tsx` — when `demo` true, the "Call my number" tab becomes a plain number field + "Call now" (skip OTP). Keep OTP path for when `DEMO_MODE` off but Twilio set. Guard blurb updates: "demo mode — dials the number you type."
- `.env.example` — document `DEMO_MODE=1` (local/demo only; leave unset in prod).

**Security note for SUBMISSION.md/DECISIONS.md:** demo mode is an explicit, env-gated relaxation for in-person testing; production keeps allowlist/OTP. Honest to the grader.

---

## B. Transcript as speaker turns

Today `app/page.tsx` renders `{call.transcript}` — one raw blob. Vapi returns `messages[]` (role + message) on the call object; `artifact.transcript` is the flat string.

**Changes**
- `lib/providers/types.ts` — add `turns?: { role: "assistant"|"user"; text: string }[]` to `NormalizedCall`.
- `lib/providers/vapi.ts` `getCall()` — map `c.messages` (filter roles bot/assistant → "Ria", user → "Customer"; drop system/tool) into `turns`. Fallback: parse the flat `transcript` string on `\n` if `messages` absent.
- `app/page.tsx` — render `turns` as alternating labelled rows (Ria / Customer); fall back to blob if no turns.
- `app/globals.css` — `.turn`, `.turn.ria`, `.turn.cust` styles (label + bubble).

---

## C. Analysis reliably generated

`analysisPlan` (summary + structuredData) already defined in `vapi.ts`. "Not proper" is usually **poll timing** — Vapi finalizes analysis a few seconds after status flips `ended`; `page.tsx` already keeps polling to 12 tries. Verify + harden:
- Confirm `c.analysis.structuredData` / `c.analysis.summary` field paths against a live call response (log once).
- Extend end-poll cap 12→15 and only stop when summary+structured present or cap hit (already close — tighten condition).
- If switching provider (section E), re-implement structured extraction there.

---

## D. Stop it feeling AI-generated

**Scope (from user):** transcript + results panels are the priority; overall feel. Recommend **targeted** pass, not full teardown:
- Real speaker-turn transcript (B) alone removes the biggest "template" tell.
- Results panels: tighten spacing rhythm, use real content states (empty/failed), remove generic filler copy.
- Keep the dawn theme; add 1–2 crafted details (call-summary as a written note, booked-slot as a real ticket chip).
- Defer full-page redesign unless asked.

---

## E. Indian low-latency stack → ~₹2/min  (RESEARCH DELIVERABLE)

**Why latency is high now:** current stack = **Vapi (US-hosted)** + Deepgram + OpenAI + Azure voice → transatlantic RTT from Indian callers. Fix = India-hosted models + streaming + VAD turn-taking.

**"Stops calling STT/TTS constantly":** use **VAD/endpointing** (Silero) so STT transcribes only on detected speech and TTS fires only on a completed agent turn — turn-based, not continuous streaming. Managed platforms (Bolna/Vapi) do this already; self-host must wire it.

### Provider list (Indian, mid-2026, $1≈₹84 — verify live before quoting)

**Voice-agent platforms (managed, fastest to ship):**
| Platform | Notes | ~Cost |
|---|---|---|
| **Bolna** | Indian-built, BYOK, Plivo/Exotel native, Hinglish | platform ~$0.02/min (₹1.7) + STT/LLM/TTS/telephony → ~₹5–8/min |
| **Smallest.ai — Atoms** | real-time agent, sub-100ms TTS, Indian voices | TTS from $0.01/min; agent bundle higher |
| **Sarvam — Samvaad** | conversational agents, sub-200ms Hindi | Indic-native |

**STT (Indian):** Sarvam **Saarika** ₹0.50/min (₹30/hr), 11 Indic • **Gnani** (telephonic, 12+ Indic, enterprise) • **Reverie** (pluggable ASR into Vapi/Retell) • **AI4Bharat / Bhashini** IndicConformer (open-source, free self-host).

**TTS (Indian):** Sarvam **Bulbul** ₹15–30/10k chars (~₹0.5–1/min) • **Smallest.ai Waves/Lightning** sub-100ms, Hindi code-switch, from $0.01/min • **AI4Bharat IndicTTS** (open-source free).

**LLM (Indic/cheap):** **Sarvam-M** (Indic-tuned) • **Krutrim** (Indic text) • **gpt-4o-mini** (cheap, code-switches fine).

**Telephony (India):** **Plivo** (Indian-origin; outbound ~₹1/min, SIP ~₹0.27/min) • **Exotel** (DLT-native) • **Ozonetel / Knowlarity** • **direct SIP trunk** ₹0.60–1.20/min.

**Orchestration to KILL the platform fee (this is what unlocks ₹2/min):** **Pipecat** (OSS, Sarvam integration docs exist) • **LiveKit Agents** (OSS, Sarvam docs exist) • **Dograh** (OSS Bolna alt).

### The ₹2/min stack (recommended)
Self-hosted **Pipecat or LiveKit Agents** (₹0 platform fee) +
- Sarvam **Saarika** STT — ₹0.50/min
- Sarvam **Bulbul** TTS — ~₹0.70/min (agent talks ~half the minute)
- **gpt-4o-mini** or **Sarvam-M** LLM — ~₹0.20/min
- **Plivo direct SIP** telephony — ~₹0.60/min
- **≈ ₹2.0/min** + minor compute. Silero VAD endpointing for turn-based STT/TTS.

**Cannot hit ₹2/min on Vapi or Bolna** — their platform fee alone is ₹1.7–3.5/min. Managed = faster to demo but ~₹5–8/min; self-host = ₹2/min but ops work.

**Migration:** the app is already provider-abstracted (`lib/providers/types.ts` `VoiceProvider`). Add `lib/providers/pipecat.ts` (or `sarvam.ts`) implementing `placeCall`/`getCall` against a self-hosted Pipecat service; flip `VOICE_PROVIDER`. Nothing else in the app changes.

### Deep-dive addendum: open-weight Indian voice models (Maya & friends)
**Maya Research (Bengaluru) — open weights, self-host, ₹0 TTS API fee (GPU only):**
- **Veena** — India's first Hindi/Hinglish TTS. 3B Llama + SNAC codec, 24kHz, sub-80ms on H100, 4 studio voices, code-mixed. Most-downloaded Indian voice model (50k+ HF). **Pipecat integration requested (issue #2605)** → drops into the stack.
- **Maya1** — Nov 2025, 3B, 20+ emotions, *promptable* voice design, Apache 2.0, single 16GB+ GPU, realtime streaming. #2 open-weight voice. Promptable emotion = strong fit for warm "Ria" persona.
- Caveat: self-hosting 3B TTS needs 16GB+ GPU (L4/A10 ~₹0.7–1.4/min if dedicated to ONE call; cheap only when batching concurrent calls). Demo → managed Sarvam API; production scale → self-host Veena/Maya1.

**Other open Indian TTS/STT:** AI4Bharat (Indic-TTS, Indic Parler-TTS 16 langs, VITS-Rasa-13) · BharatGen (ASR+TTS) · Svara-TTS · SYSPIN/IISc (9 langs) · Bhashini (govt).

**Commercial managed:** Sarvam **Bulbul V3** (beat ElevenLabs v3-alpha/v2.5-flash + Cartesia Sonic-3 in telephony category — top managed pick) · Smallest.ai Waves/Lightning (sub-100ms) · Cartesia (India region, US co) · Gnani (enterprise-only, not for this timeline).

**"Raavan" — not found;** likely misremembered (AI4Bharat **Rasa**? Reverie?). Confirm name to chase.

**Recommendation unchanged:** demo on Sarvam managed; production ₹2/min via self-hosted Veena/Maya1 + AI4Bharat/Sarvam STT + Pipecat + Plivo.

---

## Critical files
- `app/api/call/route.ts` (demo path)
- `app/api/config/route.ts` (demo flag)
- `app/page.tsx` (demo field, speaker-turn transcript, results polish)
- `app/globals.css` (turn styles, panel polish)
- `lib/providers/types.ts` + `lib/providers/vapi.ts` (turns mapping, analysis paths)
- `lib/demo.ts` (new), `.env.example`
- `lib/providers/pipecat.ts` (new, only if doing the ₹2/min migration)
- `DECISIONS.md` / `SUBMISSION.md` (document demo mode + provider choice)

## Verification
1. `DEMO_MODE=1 npm run dev` → open app → "Call my number" tab → type your phone → "Call now" → phone rings.
2. Complete a call, hang up → transcript renders as Ria/Customer turns; summary + qualification fields populate within ~15 poll cycles; cost shows ₹.
3. `DEMO_MODE` unset → demo field hidden, only allowlist/OTP paths (regression check).
4. `npx tsc --noEmit && npx next build` clean.
5. (If migrating) place a call through Pipecat provider; measure first-audio latency (target <500ms) and per-min cost vs ₹2 target.

## Suggested sequencing (pick scope)
- **Phase 1 (demo-ready, do first):** A + B + C + light D. Ships the live-demo experience on current Vapi stack. ~half day.
- **Phase 2 (cost/latency):** E migration to self-hosted Sarvam+Pipecat+Plivo. Bigger; do after the demo works.
