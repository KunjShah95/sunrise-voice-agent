// Provider-agnostic contract. Swapping Vapi -> Bolna means writing one file
// that implements this interface. Nothing else in the app changes.

export type CallStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "ended"
  | "failed"
  | "unknown";

export interface StructuredQualification {
  caller_is_right_person?: boolean;
  need?: string; // what interior work the lead wants
  urgency?: string; // how soon they want to start
  slot_offered?: string; // e.g. "Thursday 4 PM"
  slot_confirmed?: boolean;
  interested?: boolean;
  language?: string; // hindi | hinglish | english
}

export interface TranscriptTurn {
  role: "assistant" | "user";
  text: string;
}

export interface NormalizedCall {
  id: string;
  status: CallStatus;
  endedReason?: string;
  transcript?: string; // flat fallback
  turns?: TranscriptTurn[]; // preferred: speaker-separated
  summary?: string;
  structured?: StructuredQualification;
  costUsd?: number;
  costInr?: number;
  recordingUrl?: string; // URL to the call recording for verification
  conversationDuration?: number; // duration in seconds
}

export interface VoiceProvider {
  name: string;
  /** Place an outbound call to an E.164 number. Returns provider call id. */
  placeCall(toNumber: string): Promise<{ id: string }>;
  /** Fetch current state of a call for polling. */
  getCall(id: string): Promise<NormalizedCall>;
}
