# Submission — Live Voice Agent Demo (Sunrise Interiors)

**Candidate:** Kunj Shah · FDE Intern assignment · Sahajta AI Solution Pvt Ltd

---

## Deliverables

| # | Deliverable | Link / Location |
|---|---|---|
| 1 | **Live URL** | <https://sunrise-voice-agent.vercel.app> |
| 2 | **GitHub (public)** | <https://github.com/KunjShah95/sunrise-voice-agent> |
| 3 | **README.md** | in repo — run steps, architecture diagram, cost/call |
| 4 | **DECISIONS.md** | in repo — platform comparison, latency, regulatory, roadmap |
| 5 | **Loom (≤3 min)** | _[paste Loom link]_ |
| — | **Recorded successful call** (P0 evidence) | _[paste audio/video link]_ |

---

## How it works (30-second version)

Web page → one button → server-side `/api/call` picks a number **by index** from a
server-only allowlist → **Vapi** places a real outbound call (Deepgram `multi` STT +
`gpt-4o-mini` + **Azure `hi-IN-SwaraNeural`** Indian voice + Twilio number) → the page
polls Vapi and shows **transcript, extracted qualification fields, booking, and ₹ cost**.
A second provider (**Bolna + Plivo/Exotel**) is fully wired and one env var away — it's
the lower-cost, DLT-compliant India path.

---

## Requirements checklist

**P0**

- [x] Public deployed URL (not localhost)
- [x] One button → real outbound call to a real Indian mobile
- [x] Call arrives in ~10–15 s of click
- [x] Indian-accent voice (Azure `hi-IN-SwaraNeural`)
- [x] Handles Hindi / Hinglish / English + code-switching (Deepgram `multi` + Hinglish-default prompt)
- [x] Asks the Section-4 questions and adapts
- [x] Discloses it is an AI at the start
- [x] Ends cleanly (endCall tool + end-phrases + max-duration + silence timeout)
- [x] Allowlist enforced server-side; arbitrary dialing structurally impossible (index-based)
- [x] No API keys in browser / repo / git history (server-only env; verified)
- [ ] Works 3× in a row when tested — see **Known limitation** below
- [ ] One recorded successful call — _attached separately_

**P1**

- [x] Transcript displayed after the call
- [x] Qualification (need / urgency / booking) extracted as structured fields
- [x] Cost of the call shown in ₹
- [x] Confirmed slot shown as a booking

---

## Known limitation (disclosed up front)

Telephony is on **Twilio's free trial**, which (a) prepends a spoken _"you have a
trial account, press any key"_ message before the AI connects, and (b) only dials
**Twilio-verified** numbers. Both are trial artifacts, not app behaviour.

- Removing the preamble needs a paid Twilio balance (~₹1700, **above the ₹500 budget**)
  or an Indian provider (Exotel/Plivo/Bolna) whose DLT/KYC does not clear same-day.
- Per the brief's budget rule, I flagged this rather than silently overspending — see
  the message below.

**To test the live demo:** when the call connects, press any key once and stay on the
line; the AI (Ria) then takes over.

---

## Measured numbers

- **Time from click → phone rings:** _[fill, e.g. ~9 s]_
- **Per-turn latency (measured, by ear + Vapi call logs):** _[fill, ~0.8–1.3 s]_
- **Cost of the demo call (from on-page ₹ display):** _[fill, ₹__]_

---

## The one thing I'm least happy with

The **Twilio trial preamble + foreign (US) caller-ID**. It's the single thing that
most hurts the live-demo feel, and it's _exactly_ the "a US stack is quietly wrong for
an Indian number" lesson the brief points at. The honest fix is the **Bolna + Exotel/
Plivo** path — real Indian caller-ID, ~half the per-minute cost, and the only route
that can register on India's DLT platform for real customers. I built that adapter so
the switch is one env var, but the Indian telephony KYC/DLT can't be completed in a
same-day window — so tonight's demo ships on Vapi + Twilio with the limitation disclosed.

---

## Message sent to Sahajta (budget + test-number request)

> Hi — heads-up before you test the voice-agent demo. It's live and works end-to-end:
> real call to an Indian mobile, Hinglish conversation, qualification + booking, and
> transcript + ₹ cost on the page. Live URL: <https://sunrise-voice-agent.vercel.app>
>
> **Two asks:**
>
> **1. Which number(s) will you test/demo with?** The page dials only a server-side
> allowlist (this is the P0 security control — a visitor can't dial an arbitrary
> number). Send me the exact +91 number(s) you'll use and I'll add them to the
> allowlist and verify them on Twilio, so the button rings your phone during the demo.
>
> **2. Telephony is on Twilio's free trial**, which plays a ~5-second _"trial account,
> press any key"_ message before the AI connects and only dials verified numbers — a
> trial artifact, not the app. Removing it needs either a Twilio top-up (~₹1700, above
> the ₹500 budget) or an Indian provider (Exotel/Plivo/Bolna) whose DLT/KYC won't clear
> today. Do you want to **(a)** approve the ~₹1700 top-up / an alternate provider for a
> clean connect, or **(b)** have me submit on trial and press a key once when the call
> lands? Full stack comparison + the Indian-provider/DLT path is in DECISIONS.md.
