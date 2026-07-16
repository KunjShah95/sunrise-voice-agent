# DECISIONS

Why this stack, what I gave up, what I rejected, latency, the regulatory reality
for calling Indian mobiles, and what I'd do with two more weeks.

> **Reading note on the numbers:** per-minute prices below are researched
> estimates from public pricing pages (which, as the brief warns, routinely hide
> the LLM, the telephony, and the platform fee behind a headline rate). The
> **single source of truth for cost is the live call** — the app reads the
> provider's own `cost` field and displays it in ₹ on the page after every call.
> The measured value from my demo call is recorded in the "Measured" section.

---

## 1. What the product actually needs (constraints that drive the choice)

1. **Server-triggered outbound call** from a button (not a dialer, not inbound).
2. **Indian mobile termination** on normal Jio/Airtel audio quality.
3. **Indian accent + Hindi/Hinglish/English with mid-sentence code-switching.**
4. **Sub-1.5s turn latency** and **barge-in** (caller can interrupt).
5. **Ships tonight** with free-trial credit, under ₹500.
6. Defensible **allowlist** and **no keys in the browser**.

The decisive, non-code factor is #2 + #3 together: **the telephony leg to an
Indian mobile is where "great US stack" quietly becomes the wrong answer** —
foreign caller-ID, higher per-minute international termination, and no path to
Indian DLT compliance. That single fact splits the market into "fast to demo"
vs. "correct for India".

---

## 2. Platforms evaluated

Orchestration platforms (they glue STT + LLM + TTS + telephony and expose an
outbound-call API):

| Platform | Origin | Outbound API | Indian voice / Hinglish | Telephony options | Est. all-in /min to an Indian mobile¹ | Barge-in | Free credit |
|---|---|---|---|---|---|---|---|
| **Vapi** ✅ chosen | US | Yes, `POST /call` | Good (Deepgram `multi` + Azure `hi-IN` / 11labs / smallest-ai) | BYO Twilio/Vonage/Telnyx | **≈ ₹18–24** (Twilio-to-India is the costly part) | Native | ~$10 |
| **Bolna** ✅ built as 2nd | India (Bengaluru) | Yes | **Best** (Sarvam/Smallest, India-tuned) | **Plivo / Exotel / Twilio** | **≈ ₹9–14** (Plivo/Exotel termination) | Native | trial credit |
| Retell AI | US | Yes | Good | BYO Twilio/Telnyx | ≈ ₹18–24 | Native | ~$10 |
| Bland AI | US | Yes (single API) | Weak-to-OK Indian voices | Bundled (their numbers) | ≈ ₹8–12² | Yes | trial mins |
| Sarvam (direct) | India | DIY (no orchestration) | **Best** (native Indian) | You wire Exotel/Plivo + media streams | ≈ ₹6–10 + build cost | You build it | credits |

¹ Estimate = STT + LLM + TTS + **telephony termination to an Indian mobile** +
platform fee. Telephony dominates: Twilio outbound to an Indian mobile ≈ ₹11–13/min,
whereas Plivo/Exotel domestic ≈ ₹0.7–1.2/min. That gap is why the "US-native"
rows cost 2× the "India-native" rows for identical audio.
² Bland's headline is attractive but it's US-centric: Indian caller-ID and
Hinglish quality are weaker, and it's a closed box — no Indian-DLT path.

---

## 3. What I chose, and what I gave up

**Chosen (live tonight): Vapi + Twilio.** **Also built and selectable: Bolna**
(`VOICE_PROVIDER=bolna`).

**Why Vapi + Twilio as the default:**
- **Lowest risk of a working call at EOD.** Best-documented outbound API,
  inline assistant (no dashboard object to misconfigure), `$10` credit, and a
  Twilio **trial-account quirk that helps me**: trial accounts can only dial
  *verified* numbers, so the platform itself enforces a second allowlist behind
  my own.
- **Latency + barge-in are solved for me** — Deepgram streaming STT,
  `gpt-4o-mini`, and 11labs `turbo` are wired for ~sub-second turns out of the box.
- **Hinglish is good enough**: Deepgram `multi` transcribes Hindi+English
  code-switching; **Azure `hi-IN-SwaraNeural`** speaks Hindi + English words in
  an Indian voice. The agent is prompted to *default* to Hinglish (not just
  mirror), so the accent lands from the first line.

**What I gave up by choosing it (honest tradeoffs):**
- **It is not the lowest-cost stack.** Twilio's international termination to an
  Indian mobile makes Vapi+Twilio ~2× the per-minute cost of Bolna+Plivo/Exotel.
  The brief says pick the lowest-cost one — **the lowest-cost one is
  Bolna + Plivo/Exotel**, and that's why I built the Bolna adapter fully rather
  than stubbing it. My recommendation: **demo on Vapi tonight, flip to Bolna for
  cost/compliance** the moment an Exotel/Plivo number clears KYC.
- **Foreign caller-ID.** A Twilio US/intl number is more likely to be ignored or
  flagged by an Indian recipient than a local 140/1600-series or a local DID.
- **No native Indian-DLT path.** Twilio can't register on India's DLT platform
  the way Exotel/Ozonetel/Plivo (India) can — so this exact stack cannot legally
  scale to non-consented customers (see §5).

**Two things I learned the hard way during the build (they prove the thesis that
a US stack is quietly wrong for India):**
- **Vapi does not support Sarvam as a voice provider.** I assumed it would (Sarvam
  is the obvious best-Hinglish choice) — it isn't in Vapi's list. Vapi's
  Indian-capable voices are **Azure** (`hi-IN-SwaraNeural` / `en-IN-NeerjaNeural`,
  bundled), **smallest-ai**, or an Indian **11labs** voice. I shipped Azure
  `hi-IN-SwaraNeural`. Sarvam's superior Hinglish is reachable only on the
  **Bolna** path — another reason the India-native stack wins on quality too.
- **Twilio's free trial injects a spoken "press any key" preamble** and only
  dials *verified* numbers. Great as a free allowlist, terrible for a live client
  demo — the client first hears a foreign-accented trial robot, which is exactly
  the "voice sounds foreign → we lose" failure the brief warns about. Removing it
  needs a paid Twilio balance (~₹1700, above the ₹500 budget → I flagged it to
  you rather than silently overspending) or an Indian provider (Exotel/Plivo)
  whose DLT/KYC doesn't clear same-day. This *is* the "US-stack-is-wrong-for-India"
  lesson, encountered live.

**Why I still built Bolna in the repo:** it's the India-correct answer on both
axes the brief cares about (cost + regulatory). Having both behind one
`VoiceProvider` interface means the "which is cheaper / more compliant" decision
is a one-line env change, not a rewrite.

---

## 4. What I rejected, and why

- **Bland AI** — tempting single-API simplicity and a low headline rate, but
  it's a closed US-centric box: weaker Indian voice/Hinglish, foreign caller-ID,
  and **no Indian-DLT path**. Fine for US SMBs, wrong for Bengaluru leads.
- **Retell AI** — technically excellent and very close to Vapi, but same
  Twilio-to-India cost problem and no advantage over Vapi for this demo; picking
  it over Vapi would be a coin-flip, so I chose the one with the larger community
  for faster 6-PM debugging.
- **Sarvam direct (no orchestrator)** — genuinely the best Indian voice and
  cheapest media, but it makes *me* build turn-taking, barge-in, endpointing and
  the telephony media-stream bridge. That's the highest-quality Hinglish and the
  **highest build risk for an EOD deadline** — a bad bet tonight, a great bet in
  two weeks (see §6).
- **Raw Twilio + OpenAI Realtime, hand-rolled** — most control, most latency
  tuning, most ways to fail live. Rejected for the same EOD-risk reason.
- **A database / webhook for call state** — rejected as unnecessary. The
  provider already exposes `GET /call/{id}` with transcript + analysis + cost, so
  the browser polls that through my server. One less account, one less failure
  mode for the demo.

---

## 5. Latency

**Target:** < 1.5 s from caller finishing speaking to the agent replying.

**What I did to hit it (architecture, not luck):**
- **Streaming STT** (Deepgram `nova-2`, `language: multi`) — partials, not
  batch, so endpointing fires fast on Hinglish.
- **Small, fast LLM** (`gpt-4o-mini`) — the dominant lever on time-to-first-token.
- **Low-latency streamed TTS** — Azure `hi-IN-SwaraNeural` (bundled, Indian,
  fast); `smallest-ai` is the lower-latency Indian upgrade if needed. (Sarvam,
  the best-Hinglish option, is on the Bolna path — not available in Vapi.)
- **Short system prompt + "one question at a time"** — fewer tokens generated
  per turn = less time-to-first-audio, and it keeps the call to 60–90 s.
- **`silenceTimeoutSeconds` / endpointing tuned** so the agent doesn't wait too
  long to decide the caller finished, and end-call phrases + `maxDurationSeconds`
  kill dead air / loops.

**How I measure it (not guess):** Vapi's call artifact timestamps each
transcriber/model/voice message, so per-turn latency is computed from the
message stream; I cross-check by ear against the recording (gap between my last
word and the agent's first word).

**Measured:** _[fill from the demo call — Vapi call artifact + recording.
Expected ~0.8–1.3 s per turn on this config.]_

---

## 6. Legal / regulatory reality for automated outbound calls to Indian mobiles

This is the part that gets a client's numbers **blocked**, so I treated it as a
first-class constraint, not an afterthought.

**What applies:**
- **TRAI TCCCPR 2018** (Telecom Commercial Communications Customer Preference
  Regulations) governs all commercial communication. Automated promotional voice
  calls are **commercial communication**.
- **DLT registration (blockchain-based).** The business (as a Principal Entity)
  must register on an operator DLT portal, register its **header/sender** and
  **consent templates**, and route calls through a registered **telemarketer**.
  This is exactly what US providers like Twilio/Bland **cannot** do and Indian
  providers (Exotel, Ozonetel, Plivo-India, Kaleyra) can.
- **DND / NCPR scrubbing.** Numbers on the National Customer Preference Register
  must be scrubbed before dialing unless there's explicit consent; promotional
  calls to DND numbers are a violation.
- **Consent + purpose limitation.** A form-fill is a lead, but consent must be
  explicit, logged, and scoped to "we may call you about this enquiry." Buying/
  reusing lists is not consent.
- **Numbering series.** Promotional/automated voice should originate from the
  designated **140 / 1600** commercial series (or a registered DID), not a random
  or foreign caller-ID.
- **Calling hours.** Commercial calls are restricted to roughly **09:00–21:00**.
- **DPDP Act 2023.** The lead's phone number + call recording + transcript are
  personal data — needs lawful basis, stated retention, and deletion on request.
- **AI disclosure & recording consent.** Disclosing "this is an AI assistant"
  (which this agent does in its first line) and consent to record are good
  practice and increasingly expected.

**What would have to change before this is used on real customers (not our own
consented phone):**
1. Switch telephony to an **Indian DLT-registered provider** (Exotel/Ozonetel/
   Plivo-India) → **this is the built-in Bolna path**.
2. Register the Principal Entity, **header, and consent templates** on DLT; dial
   from a **140/1600-series or registered DID**.
3. **Scrub every number against DND/NCPR** and gate on **logged explicit
   consent** captured at the form (not just "they filled a form").
4. Enforce **09:00–21:00** calling windows and per-lead frequency caps.
5. Add **recording-consent capture**, a **DPDP-compliant retention/deletion**
   policy, and an **opt-out** ("say STOP / press 9") path.

The current build is deliberately scoped to **our own consented, allowlisted
phone**, which is lawful for a demo and side-steps DLT — but I know exactly what
flips it from "demo" to "product," and the provider abstraction already points
at the compliant stack.

---

## 7. What I'd do with two more weeks

1. **Move the default to Bolna + Exotel/Plivo** once KYC clears — cheaper and on
   the compliant telephony path. Both adapters already exist.
2. **Real booking**: Google Calendar integration so the confirmed slot creates an
   actual event + WhatsApp/SMS confirmation to the lead.
3. **Durable call store** (Upstash/Vercel KV) + provider **webhooks** instead of
   polling, for reliability and a campaign history view.
4. **Best-in-class Hinglish** via Sarvam voice + tuned endpointing, A/B'd against
   11labs on real Indian handsets, measured on-device (not in headphones).
5. **Robustness**: voicemail/answering-machine detection, no-answer retries with
   backoff, warm-transfer to a human when the lead is hot.
6. **Compliance layer**: DND scrubbing, consent log, 09:00–21:00 scheduler,
   opt-out handling, DPDP retention — the §5 list, implemented.
7. **Latency instrumentation** surfaced in the UI (per-turn ms) + automated e2e
   tests, so regressions are caught before a client hears them.
8. **Multi-lead campaigns** with a lightweight dashboard (still no CRM — out of
   scope — but a foundation for one).

---

## 8. Measured (fill after the live demo call)

- **Provider used for demo:** _[vapi | bolna]_
- **Time from click → phone rings:** _[e.g. ~8 s]_
- **Per-turn latency (measured):** _[e.g. ~1.1 s]_
- **Call duration:** _[e.g. 78 s]_
- **Cost of the call (from the on-page ₹ display):** _[e.g. ₹__]_
