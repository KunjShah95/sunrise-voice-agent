import type {
  VoiceProvider,
  NormalizedCall,
  CallStatus,
  StructuredQualification,
  TranscriptTurn,
} from "./types";

import { SYSTEM_PROMPT, FIRST_MESSAGE } from "../prompt";

const VAPI_BASE = "https://api.vapi.ai";

// Map Vapi's message log into clean speaker turns (Ria vs Customer). Skips
// system/tool rows. Falls back to parsing the flat transcript string.
function buildTurns(c: any): TranscriptTurn[] | undefined {
  const raw: any[] | undefined = Array.isArray(c.messages)
    ? c.messages
    : Array.isArray(c.artifact?.messages)
      ? c.artifact.messages
      : undefined;

  if (raw && raw.length) {
    const turns: TranscriptTurn[] = [];
    for (const m of raw) {
      const role = m.role;
      if (role !== "user" && role !== "bot" && role !== "assistant") continue;
      const text = (m.message ?? m.content ?? "").toString().trim();
      if (!text) continue;
      turns.push({ role: role === "user" ? "user" : "assistant", text });
    }
    if (turns.length) return turns;
  }

  // Fallback: flat "AI: ... \n User: ..." style transcript.
  const flat: string | undefined = c.artifact?.transcript ?? c.transcript;
  if (typeof flat === "string" && flat.includes("\n")) {
    const turns: TranscriptTurn[] = [];
    for (const line of flat.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const m = t.match(/^(AI|Assistant|Bot|Ria|User|Customer|Human)\s*[:\-]\s*(.+)$/i);
      if (m) {
        const isUser = /^(user|customer|human)$/i.test(m[1]);
        turns.push({ role: isUser ? "user" : "assistant", text: m[2].trim() });
      }
    }
    if (turns.length) return turns;
  }
  return undefined;
}

function usdToInr(usd: number): number {
  const rate = Number(process.env.USD_TO_INR || "86");
  return Math.round(usd * rate * 100) / 100;
}

// The agent prompt + first line live in lib/prompt.ts (single source of truth,
// shared with the Bolna path). Inline assistant => no dashboard setup for Vapi.

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
    // ---- Humanization + latency: natural turn-taking ----
    // Smart endpointing lets the model detect when the caller has *finished*
    // speaking (not just paused), so Ria replies fast without talking over
    // them. This is also the "don't run STT/TTS continuously" control — audio
    // is turned into a turn only on a real end-of-speech, not every fragment.
    startSpeakingPlan: {
      waitSeconds: 0.4, // brief, human beat before replying
      smartEndpointingEnabled: true,
    },
    // Barge-in: if the caller starts talking, Ria stops immediately and listens.
    stopSpeakingPlan: {
      numWords: 1,
      voiceSeconds: 0.2,
      backoffSeconds: 1,
    },
    // Cleaner phone audio -> better STT -> fewer re-asks -> lower latency/cost.
    backgroundDenoisingEnabled: true,
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
        // Extract even on very short calls (a 30s "not interested" still yields
        // interested=false). Without this, short calls can return no structured
        // data and the Qualification panel stays empty.
        minMessagesThreshold: 1,
        messages: [
          {
            role: "system",
            content:
              "You extract structured qualification data from an interior-design callback. Return ONLY the schema fields, inferred from the transcript. If a field is unknown, omit it.",
          },
          { role: "user", content: "Transcript:\n{{transcript}}" },
        ],
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
      turns: buildTurns(c),
      summary: c.analysis?.summary,
      structured,
      costUsd,
      costInr: costUsd !== undefined ? usdToInr(costUsd) : undefined,
    };
  },
};
