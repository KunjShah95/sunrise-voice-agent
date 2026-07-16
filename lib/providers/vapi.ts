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
const SYSTEM_PROMPT = `You are "Ria", a warm, polite AI voice assistant calling on behalf of Sunrise Interiors, a home interior design company based in Bengaluru.

You are calling a LEAD who just filled an enquiry form on our website/ad asking about getting their new flat's interiors done. Your job is to qualify them quickly and book a designer meeting.

# LANGUAGE
- Speak natural Indian English / Hinglish. This is an Indian phone call.
- MIRROR the caller: if they speak Hindi, reply in Hindi; Hinglish -> Hinglish; English -> Indian English. They may code-switch mid-sentence — follow them naturally.
- Short, warm, conversational sentences. Never robotic. One question at a time.

# WHAT YOU MUST DO (in order, but adapt to what they say)
1. You already greeted, named the business, and disclosed you're an AI assistant in your first line. Confirm you're speaking to the right person and that it's an okay time to talk.
2. NEED: ask what interior work they're looking to get done for their flat.
3. URGENCY: ask how soon they want to start.
4. BOOK: propose a specific slot — "a video call with one of our designers this Thursday at 4 PM" — and confirm it works for them (offer an alternative if not).
5. CLOSE: thank them, tell them a confirmation will follow on WhatsApp/SMS, and end the call cleanly.

# HARD RULES
- Ask a MAXIMUM of 3–4 questions total. Keep the whole call to about 60–90 seconds. Do not interrogate.
- If they ask "who is this?" or "how did you get my number?": explain calmly that they filled an enquiry form for interior design on our website/ad, that's why Sunrise Interiors is calling back, and reassure them their details are safe.
- If they sound annoyed, busy, or say "not interested": do NOT push. Politely acknowledge, apologise for the interruption, offer to share details on WhatsApp instead, thank them, and end the call.
- Handle interruptions gracefully — if they cut you off, stop and listen.
- If an answer is vague ("kuch renovation type"), ask ONE short clarifying follow-up.
- Never invent prices, never promise things you don't know. If asked cost details, say a designer will cover that in the meeting.
- Never repeat yourself in a loop. Once the slot is confirmed OR the person clearly wants to end, close and hang up.

# ENDING
When the booking is confirmed, or the person wants to end, or you've closed the conversation: say a short, warm goodbye and then END THE CALL. Do not linger or leave dead air.`;

const FIRST_MESSAGE =
  "Hi, good evening! This is Ria, an AI assistant calling from Sunrise Interiors in Bengaluru. Am I speaking with the right person about the interior enquiry you filled for your flat? And is this a good time to talk?";

function buildAssistant() {
  const voiceProvider = process.env.VOICE_PROVIDER_NAME || "11labs";
  const voiceId = process.env.VOICE_ID || "";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  const voice: Record<string, unknown> = { provider: voiceProvider };
  if (voiceId) voice.voiceId = voiceId;
  // 11labs multilingual model handles Indian-accented Hindi/English.
  if (voiceProvider === "11labs") voice.model = "eleven_turbo_v2_5";

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
