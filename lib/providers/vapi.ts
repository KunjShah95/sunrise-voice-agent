import type {
  VoiceProvider,
  NormalizedCall,
  CallStatus,
  StructuredQualification,
} from "./types";

const VAPI_BASE = "https://api.vapi.ai";

function usdToInr(usd: number): number {
  const rate = Number(process.env.USD_TO_INR || "86");
  return Math.round(usd * rate * 100) / 100;
}

// ---------------------------------------------------------------------------
// The agent. Inline assistant => no dashboard setup required beyond keys.
// Tuned for a 60–90s Indian outbound qualification call for Sunrise Interiors.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are "Ria", a warm, friendly AI voice assistant calling on behalf of Sunrise Interiors, a home interior design company in Bengaluru. You are on a LIVE phone call.

A LEAD just filled an enquiry form on our website/ad about getting their new flat's interiors done. You are calling them back to qualify them and book a designer meeting. Be quick, human, and likeable.

# HOW YOU TALK (most important)
- Sound like a real, warm Bengaluru-based person on the phone — NOT a call-centre script, NOT a robot.
- DEFAULT to natural Hinglish (mostly Hindi with everyday English words mixed in) from your very first line — this is a Bengaluru call. Only switch to pure English if the caller clearly speaks only English and seems to prefer it.
- MIRROR the caller's language. English -> Indian English. Hindi -> Hindi. Hinglish -> Hinglish. They will code-switch mid-sentence; follow them smoothly.
- Keep EVERY reply to 1–2 short sentences. Speak in a friendly, casual tone. Use small natural fillers ("acha", "sure", "got it", "haan").
- One question at a time. Never stack two questions. Never monologue.
- Say numbers/dates the way people speak them ("Thursday, 4 PM").

# STYLE EXAMPLES (match this vibe — do not read these aloud verbatim)
- Confirming: "Perfect. So just to understand — flat ke liye aap kaunsa interior work karana chahte ho? Full setup ya kuch specific?"
- Urgency: "Got it. Aur aap start kab tak karna chahte ho — this month, ya thoda time hai?"
- Booking: "Great, toh main aapke liye Thursday 4 PM pe ek quick video call set kar deti hoon with our designer — that works?"
- Objection: "Bilkul samajh sakti hoon — aapne humaari website pe interior enquiry bhari thi, isliye call kiya. Aapki details safe hain, no worries."

# CONVERSATION GOAL (in order — but adapt to their answers)
1. You already greeted, named Sunrise Interiors, and said you're an AI assistant in your first line. Now confirm you're speaking to the right person and that it's an okay time.
2. NEED: what interior work do they want for the flat?
3. URGENCY: how soon do they want to start?
4. BOOK: propose "a quick video call with one of our designers this Thursday at 4 PM" and confirm (offer one alternative if that doesn't suit).
5. CLOSE: thank them, say a confirmation will come on WhatsApp/SMS, end cleanly.

# HARD RULES
- MAX 3–4 questions total. Whole call ~60–90 seconds. Do not interrogate.
- "Who is this?" / "How did you get my number?": calmly say they filled an interior-design enquiry on our website/ad, that's why Sunrise Interiors is calling back, and reassure them their details are safe. Then continue.
- "Not interested" / annoyed / busy: do NOT push. Warmly acknowledge, apologise for the interruption, offer to send details on WhatsApp instead, thank them, and end.
- Interrupted? Stop immediately and listen.
- Vague answer ("kuch renovation type")? Ask ONE short clarifying follow-up, then move on.
- Never invent prices or promise anything you don't know — "our designer will cover the exact costing in the meeting."
- Never loop or repeat. Once the slot is confirmed OR they want to end, close and hang up.

# ENDING
When the booking is confirmed, or the person wants to end: give a short warm goodbye and then END THE CALL immediately. No dead air, no lingering.`;

const FIRST_MESSAGE =
  "Hello ji! Main Ria bol rahi hoon, Sunrise Interiors Bengaluru se — aur haan, main ek AI assistant hoon. Kya main sahi vyakti se baat kar rahi hoon jinhone apne flat ke interiors ke liye enquiry ki thi? Abhi baat karne ka theek time hai?";

// Voice selection — must be a provider Vapi supports (NOTE: Sarvam is NOT a
// Vapi voice provider; it's available on the Bolna path instead).
// Indian-capable Vapi options: 11labs (bundled, pick an Indian voice id),
// azure (en-IN-NeerjaNeural / hi-IN-SwaraNeural), smallest-ai (Indian, low-latency).
function buildVoice(): Record<string, unknown> {
  const provider = (process.env.VOICE_PROVIDER_NAME || "11labs").toLowerCase();
  const voiceId = process.env.VOICE_ID;

  if (provider === "smallest-ai" || provider === "smallest") {
    const v: Record<string, unknown> = { provider: "smallest-ai" };
    if (voiceId) v.voiceId = voiceId;
    return v;
  }
  if (provider === "azure") {
    return { provider: "azure", voiceId: voiceId || "en-IN-NeerjaNeural" };
  }
  // Default: 11labs turbo (bundled). Set VOICE_ID to an Indian 11labs voice
  // (Vapi dashboard -> Voice Library -> filter Indian -> copy the id).
  const v: Record<string, unknown> = { provider: "11labs", model: "eleven_turbo_v2_5" };
  if (voiceId) v.voiceId = voiceId;
  return v;
}

function buildAssistant() {
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const voice = buildVoice();

  return {
    name: "Ria — Sunrise Interiors",
    firstMessage: FIRST_MESSAGE,
    // Deepgram nova-2 with "multi" handles Hindi+English code-switching.
    transcriber: {
      provider: "deepgram",
      model: "nova-2",
      language: "multi",
    },
    model: {
      provider: "openai",
      model,
      temperature: 0.6,
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      tools: [{ type: "endCall" }],
    },
    voice,
    // Keep the demo tight and prevent runaway calls / dead air.
    maxDurationSeconds: 150,
    silenceTimeoutSeconds: 20,
    endCallPhrases: ["goodbye", "bye bye", "take care", "have a great day"],
    endCallMessage: "Thank you, have a great day. Goodbye!",
    // ---- P1: structured extraction + summary produced after the call ----
    analysisPlan: {
      summaryPlan: {
        messages: [
          {
            role: "system",
            content:
              "Summarise this interior-design qualification call in 2 short sentences: who they are, what they want, urgency, and whether a slot was booked.",
          },
          { role: "user", content: "Transcript:\n{{transcript}}" },
        ],
      },
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: "object",
          properties: {
            caller_is_right_person: {
              type: "boolean",
              description: "Was this the correct lead / person?",
            },
            need: {
              type: "string",
              description: "What interior work the lead wants done",
            },
            urgency: {
              type: "string",
              description: "How soon they want to start",
            },
            slot_offered: {
              type: "string",
              description: "The meeting slot the agent proposed",
            },
            slot_confirmed: {
              type: "boolean",
              description: "Did the lead confirm the proposed slot?",
            },
            interested: {
              type: "boolean",
              description: "Is the lead genuinely interested?",
            },
            language: {
              type: "string",
              description: "Primary language used: hindi, hinglish, or english",
            },
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Status normalisation
// ---------------------------------------------------------------------------
function mapStatus(raw: string | undefined): CallStatus {
  switch (raw) {
    case "queued":
    case "scheduled":
      return "queued";
    case "ringing":
      return "ringing";
    case "in-progress":
    case "forwarding":
      return "in-progress";
    case "ended":
      return "ended";
    default:
      return raw ? "unknown" : "unknown";
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const vapiProvider: VoiceProvider = {
  name: "vapi",

  async placeCall(toNumber: string) {
    const key = requireEnv("VAPI_PRIVATE_KEY");
    const phoneNumberId = requireEnv("VAPI_PHONE_NUMBER_ID");

    const res = await fetch(`${VAPI_BASE}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phoneNumberId,
        customer: { number: toNumber },
        assistant: buildAssistant(),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vapi placeCall failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { id: string };
    return { id: data.id };
  },

  async getCall(id: string): Promise<NormalizedCall> {
    const key = requireEnv("VAPI_PRIVATE_KEY");

    const res = await fetch(`${VAPI_BASE}/call/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vapi getCall failed (${res.status}): ${body}`);
    }

    const c = (await res.json()) as any;

    const costUsd: number | undefined =
      typeof c.cost === "number" ? c.cost : undefined;

    const structured: StructuredQualification | undefined =
      c.analysis?.structuredData;

    return {
      id: c.id,
      status: mapStatus(c.status),
      endedReason: c.endedReason,
      transcript: c.artifact?.transcript ?? c.transcript,
      summary: c.analysis?.summary,
      structured,
      costUsd,
      costInr: costUsd !== undefined ? usdToInr(costUsd) : undefined,
    };
  },
};
