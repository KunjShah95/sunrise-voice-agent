import type {
  VoiceProvider,
  NormalizedCall,
  CallStatus,
  StructuredQualification,
} from "./types";

// ---------------------------------------------------------------------------
// Bolna adapter — Indian-native voice-AI orchestrator (Bengaluru, YC).
// Fully wired alternative to Vapi. Select with VOICE_PROVIDER=bolna.
//
// Unlike the inline Vapi assistant, Bolna drives calls through an AGENT you
// create once in the Bolna dashboard (prompt + voice + telephony provider like
// Plivo/Exotel/Twilio + optional post-call extraction). We reference it by id.
//
// The SAME system prompt from lib/providers/vapi.ts should be pasted into the
// Bolna agent's prompt so behaviour is identical across providers.
// ---------------------------------------------------------------------------

const BOLNA_BASE = process.env.BOLNA_BASE_URL || "https://api.bolna.ai";

function usdToInr(usd: number): number {
  const rate = Number(process.env.USD_TO_INR || "86");
  return Math.round(usd * rate * 100) / 100;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function mapStatus(raw: string | undefined): CallStatus {
  switch (raw) {
    case "queued":
    case "scheduled":
      return "queued";
    case "ringing":
    case "initiated":
      return "ringing";
    case "in-progress":
    case "ongoing":
      return "in-progress";
    case "completed":
    case "ended":
      return "ended";
    case "busy":
    case "no-answer":
    case "failed":
    case "error":
      return "failed";
    default:
      return "unknown";
  }
}

// Bolna post-call extraction returns whatever keys the agent's extraction
// config defines. We map common ones onto our normalized shape.
function mapExtracted(data: any): StructuredQualification | undefined {
  if (!data || typeof data !== "object") return undefined;
  const g = (k: string) => data[k];
  const out: StructuredQualification = {
    caller_is_right_person: g("caller_is_right_person") ?? g("right_person"),
    need: g("need") ?? g("requirement") ?? g("interior_need"),
    urgency: g("urgency") ?? g("timeline"),
    slot_offered: g("slot_offered") ?? g("proposed_slot"),
    slot_confirmed: g("slot_confirmed") ?? g("booking_confirmed"),
    interested: g("interested"),
    language: g("language"),
  };
  const hasAny = Object.values(out).some((v) => v !== undefined);
  return hasAny ? out : undefined;
}

export const bolnaProvider: VoiceProvider = {
  name: "bolna",

  async placeCall(toNumber: string) {
    const key = requireEnv("BOLNA_API_KEY");
    const agentId = requireEnv("BOLNA_AGENT_ID");

    const res = await fetch(`${BOLNA_BASE}/call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: agentId,
        recipient_phone_number: toNumber,
        ...(process.env.BOLNA_FROM_NUMBER
          ? { from_phone_number: process.env.BOLNA_FROM_NUMBER }
          : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bolna placeCall failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as any;
    // Bolna returns the execution id under one of these keys.
    const id = data.execution_id ?? data.call_id ?? data.id;
    if (!id) throw new Error(`Bolna placeCall: no id in response ${JSON.stringify(data)}`);
    return { id: String(id) };
  },

  async getCall(id: string): Promise<NormalizedCall> {
    const key = requireEnv("BOLNA_API_KEY");

    const res = await fetch(`${BOLNA_BASE}/executions/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Bolna getCall failed (${res.status}): ${body}`);
    }

    const c = (await res.json()) as any;

    const costUsd: number | undefined =
      typeof c.total_cost === "number"
        ? c.total_cost
        : typeof c.cost === "number"
          ? c.cost
          : undefined;

    // Bolna transcript may be a string or an array of {role, content}.
    let transcript: string | undefined;
    if (typeof c.transcript === "string") {
      transcript = c.transcript;
    } else if (Array.isArray(c.transcript)) {
      transcript = c.transcript
        .map((m: any) => `${m.role ?? m.speaker ?? "?"}: ${m.content ?? m.text ?? ""}`)
        .join("\n");
    }

    return {
      id: String(c.id ?? id),
      status: mapStatus(c.status),
      endedReason: c.status,
      transcript,
      summary: c.summary,
      structured: mapExtracted(c.extracted_data ?? c.extraction),
      costUsd,
      costInr: costUsd !== undefined ? usdToInr(costUsd) : undefined,
    };
  },
};
