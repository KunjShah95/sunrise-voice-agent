import type { VoiceProvider } from "./types";
import { vapiProvider } from "./vapi";
import { bolnaProvider } from "./bolna";

// Pick the active provider from env. Default: vapi (ship-safe).
// Flip VOICE_PROVIDER=bolna to route every call through the Indian-native stack.
export function getProvider(): VoiceProvider {
  const choice = (process.env.VOICE_PROVIDER || "vapi").toLowerCase();
  switch (choice) {
    case "bolna":
      return bolnaProvider;
    case "vapi":
      return vapiProvider;
    default:
      throw new Error(`Unknown VOICE_PROVIDER: ${choice} (use "vapi" or "bolna")`);
  }
}
