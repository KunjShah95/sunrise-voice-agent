import type {
  VoiceProvider,
  NormalizedCall,
  CallStatus,
  StructuredQualification,
  TranscriptTurn,
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Bolna returns the transcript as a PLAIN STRING with "assistant:" / "user:"
// prefixes, newline-separated:
//   "assistant: Hello ji...\nuser: Haan bolo\nassistant: ..."
// Parse it into clean speaker turns (Ria vs Customer). Lines with no speaker
// prefix are treated as a continuation of the previous turn (multi-line replies).
const SPEAKER_RE = /^\s*(assistant|agent|bot|ai|ria|user|customer|human|recipient|caller)\s*:\s*(.*)$/i;

function parseTranscriptString(s: string): TranscriptTurn[] | undefined {
  const turns: TranscriptTurn[] = [];
  for (const rawLine of s.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(SPEAKER_RE);
    if (m) {
      const isUser = /^(user|customer|human|recipient|caller)$/i.test(m[1]);
      const text = m[2].trim();
      turns.push({ role: isUser ? "user" : "assistant", text });
    } else if (turns.length) {
      // Continuation line of the current turn.
      turns[turns.length - 1].text =
        `${turns[turns.length - 1].text} ${line}`.trim();
    }
  }
  const cleaned = turns.filter((t) => t.text);
  return cleaned.length ? cleaned : undefined;
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
    service: g("service") ?? g("occasion") ?? g("event_type") ?? g("need"),
    event_date: g("event_date") ?? g("date") ?? g("when"),
    guest_count: g("guest_count") ?? g("guests") ?? g("pax"),
    location: g("location") ?? g("venue") ?? g("city"),
    proposal_agreed:
      g("proposal_agreed") ?? g("proposal_sent") ?? g("whatsapp_agreed"),
    interested: g("interested"),
    language: g("language"),
  };
  const hasAny = Object.values(out).some((v) => v !== undefined);
  return hasAny ? out : undefined;
}

// Normalize a raw Bolna execution object (from GET /executions/{id} OR a
// completion webhook payload) into our provider-agnostic shape. Kept separate
// from getCall so the webhook route can reuse the exact same mapping.
export function normalizeBolnaExecution(c: any, fallbackId: string): NormalizedCall {
  // Bolna bills in RUPEES. `total_cost` (= platform + network + llm +
  // synthesizer + transcriber) is already in INR — verified against a live
  // call: total_cost 3.75 for a 67s call = ~₹3.4/min, matching Bolna's Indian
  // pricing (a $3.75/min USD reading would be absurd). So do NOT ×USD_TO_INR.
  const costInr: number | undefined =
    typeof c.total_cost === "number"
      ? c.total_cost
      : typeof c.cost === "number"
        ? c.cost
        : undefined;
  // Derive a USD figure only for parity of display; INR is the billed unit.
  const rate = Number(process.env.USD_TO_INR || "86");
  const costUsd =
    costInr !== undefined ? Math.round((costInr / rate) * 1000) / 1000 : undefined;

  // Bolna transcript may be a string or an array of {role, content}.
  let transcript: string | undefined;
  let turns: TranscriptTurn[] | undefined;
  if (typeof c.transcript === "string") {
    transcript = c.transcript;
    turns = parseTranscriptString(c.transcript);
  } else if (Array.isArray(c.transcript)) {
    transcript = c.transcript
      .map((m: any) => `${m.role ?? m.speaker ?? "?"}: ${m.content ?? m.text ?? ""}`)
      .join("\n");
    turns = c.transcript
      .map((m: any): TranscriptTurn | null => {
        const r = (m.role ?? m.speaker ?? "").toString().toLowerCase();
        const text = (m.content ?? m.text ?? "").toString().trim();
        if (!text) return null;
        const isUser = /user|customer|human|recipient/.test(r);
        return { role: isUser ? "user" : "assistant", text };
      })
      .filter((t: TranscriptTurn | null): t is TranscriptTurn => t !== null);
    if (turns && !turns.length) turns = undefined;
  }

  return {
    id: String(c.id ?? fallbackId),
    status: mapStatus(c.status),
    endedReason: c.status,
    transcript,
    turns,
    // Bolna has no top-level summary. Surface one from whichever shape the
    // agent's extraction produces: a flat "summary" field, or Bolna's default
    // nested General → "Call Summary" → subjective.
    summary:
      c.summary ??
      c.extracted_data?.summary ??
      c.extracted_data?.General?.["Call Summary"]?.subjective ??
      c.extracted_data?.["Call Summary"]?.subjective,
    structured: mapExtracted(c.extracted_data ?? c.extraction),
    costUsd,
    costInr,
    recordingUrl: c.telephony_data?.recording_url,
    conversationDuration:
      typeof c.conversation_duration === "number"
        ? Math.round(c.conversation_duration)
        : undefined,
  };
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
    return normalizeBolnaExecution(c, id);
  },
};
