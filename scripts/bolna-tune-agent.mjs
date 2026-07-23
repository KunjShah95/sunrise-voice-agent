#!/usr/bin/env node
// ---------------------------------------------------------------------------
// bolna-tune-agent.mjs — make Ria feel HUMAN and stop the mid-call failures.
//
// WHY THIS EXISTS
// Bolna drives calls through an AGENT object that lives in the Bolna dashboard,
// not in this repo. Every "it dropped / went silent / I had to say hello hello /
// it repeated the question / it sounds like a robot" symptom is NOT the prompt —
// it is the agent's turn-taking / endpointing / silence / synthesizer config.
// This script makes that config REPRODUCIBLE from the repo: it reads the live
// agent, overlays the tuned knobs at their exact Bolna paths, re-pushes the
// canonical prompt from lib/prompt.ts, and PUTs it back. Run it once; commit the
// diff of intent here so the dashboard can never silently drift again.
//
// USAGE
//   node scripts/bolna-tune-agent.mjs            # apply tuning + prompt
//   node scripts/bolna-tune-agent.mjs --dry-run  # print merged config, no write
//   node scripts/bolna-tune-agent.mjs --no-prompt# tune knobs only, keep prompt
//
// Needs BOLNA_API_KEY + BOLNA_AGENT_ID (read from env or .env.local).
//
// Docs: https://www.bolna.ai/docs/api-reference/agent/v2/overview
// Each param below is annotated with the symptom it fixes.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- tiny .env.local loader (no dependency) --------------------------------
function loadEnvLocal() {
  for (const f of [".env.local", ".env"]) {
    try {
      const txt = readFileSync(join(ROOT, f), "utf8");
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const k = m[1];
        let v = m[2].replace(/^["']|["']$/g, "");
        if (process.env[k] === undefined && v !== "") process.env[k] = v;
      }
    } catch {
      /* file may not exist — fine */
    }
  }
}
loadEnvLocal();

const BASE = process.env.BOLNA_BASE_URL || "https://api.bolna.ai";
const KEY = process.env.BOLNA_API_KEY;
const AGENT_ID = process.env.BOLNA_AGENT_ID;
const DRY = process.argv.includes("--dry-run");
const NO_PROMPT = process.argv.includes("--no-prompt");

if (!KEY || !AGENT_ID) {
  console.error(
    "Missing BOLNA_API_KEY / BOLNA_AGENT_ID. Set them in .env.local or the shell."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// THE TUNING — every value maps to a symptom the client heard.
// ---------------------------------------------------------------------------
const TASK_CONFIG = {
  // Calls were disconnecting "in between" — the agent had a 90s hard ceiling.
  // A real qualification call breathes; give it room. (Whole call still ~60-90s
  // by design in the prompt; this is just the safety kill-switch.)
  call_terminate: 300,

  // Ria went silent and the caller had to say "hello hello". Do NOT hang up on a
  // human thinking — wait, then RE-ENGAGE with a warm line instead of dead air.
  hangup_after_silence: 12,
  check_if_user_online: true,
  check_user_online_message: "Haan ji, main line pe hoon — aap sun rahe ho?",
  trigger_user_online_message_after: 6,

  // Ria kept re-asking the same question. Cause: the caller's natural "haan",
  // "acha", "hmm" (1-2 words) was treated as an interruption, so Ria aborted her
  // turn and started over. Require more words before counting it as a barge-in.
  number_of_words_for_interruption: 3,

  // Small human beat before she starts talking on interim ASR — not so long it
  // feels laggy, not so short she talks over the tail of your sentence.
  incremental_delay: 400,

  // "Sounds like a robot." Natural acknowledgements ("haan", "got it") while you
  // speak + a soft room tone so it isn't an eerie dead-quiet AI void.
  backchanneling: true,
  backchanneling_message_gap: 5,
  backchanneling_start_delay: 4,
  // ambient_noise OFF: on a narrow/compressed telephony line, background room
  // tone muddies Ria's voice — a live caller reported "aapki awaaz theek se nahi
  // aa rahi". Clarity beats fake ambience for a client demo. Toggle back on only
  // if the line is crystal clear and you want the room-presence feel.
  ambient_noise: false,

  // Let Ria use natural fillers in her OWN speech ("umm", "acha", "haan") — was
  // off, which is a big part of the "sounds like AI" feel.
  use_fillers: true,

  // Warm, clean goodbye so the call never just cuts to silence.
  call_hangup_message:
    "Bahut badhiya! Main WhatsApp pe details bhej deti hoon. Thank you ji, take care!",
};

// transcriber.endpointing (ms) — how long a silence means "caller finished".
// Too low split one Hinglish sentence (people pause mid-thought) into two turns,
// so Ria answered half a question then re-asked. Give the pause room.
// endpointing only. (Code-switch / multilingual is a nested object on Sarvam and
// is left to the dashboard — saaras:v3 already transcribes Hinglish natively.)
const TRANSCRIBER = { endpointing: 500 };

// synthesizer — stream in small buffers so first audio is fast (no lead-in gap
// that reads as a "drop").
const SYNTHESIZER = { stream: true, buffer_size: 250 };

// llm — TWO fixes:
//  (1) Model was `openrouter/openai/gpt-oss-20b`. Live executions showed
//      `provider_connected: false` + 0 conversation tokens on EVERY call — the
//      route is flaky, which is the "leaves in between" mid-call stall. Also a
//      weak 20B model ignores "reply in 1-2 sentences" and dumps long blocks,
//      so Sarvam TTS gaps mid-utterance (sounds like it left). Switch to a
//      reliable, instruction-following model on Bolna's native OpenAI provider.
//  (2) 150 tokens truncated Ria mid-sentence; 300 + temp 0.4 = complete + warm.
const LLM = {
  provider: "openai",
  model: "gpt-4o-mini",
  family: "openai",
  base_url: null,
  max_tokens: 300,
  temperature: 0.4,
  agent_flow_type: "streaming",
};

// --- pull the canonical prompt straight from lib/prompt.ts -----------------
function extractPrompt() {
  const src = readFileSync(join(ROOT, "lib", "prompt.ts"), "utf8");
  const grab = (name) => {
    // matches:  export const NAME = `...`;   (backtick template, no ${} inside)
    const re = new RegExp("export const " + name + "\\s*=\\s*`([\\s\\S]*?)`", "m");
    const m = src.match(re);
    return m ? m[1] : undefined;
  };
  return { system: grab("SYSTEM_PROMPT"), welcome: grab("FIRST_MESSAGE") };
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== "object" || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] =
      typeof over[k] === "object" && over[k] !== null && !Array.isArray(over[k])
        ? deepMerge(base?.[k] ?? {}, over[k])
        : over[k];
  }
  return out;
}

async function main() {
  const headers = {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };

  console.log(`Fetching agent ${AGENT_ID} …`);
  const getRes = await fetch(`${BASE}/v2/agent/${AGENT_ID}`, { headers });
  if (!getRes.ok) {
    console.error(`GET failed (${getRes.status}): ${await getRes.text()}`);
    console.error(
      "If your account uses a different path, check https://www.bolna.ai/docs/api-reference/agent/v2/overview"
    );
    process.exit(1);
  }
  const agent = await getRes.json();

  // Bolna returns the agent under `data` or flat; the editable body is agent_config.
  const cfg = agent.agent_config ?? agent.data?.agent_config ?? agent;
  const tasks = cfg.tasks;
  if (!Array.isArray(tasks) || !tasks.length) {
    console.error("Could not find agent_config.tasks[]. Raw response:");
    console.error(JSON.stringify(agent, null, 2).slice(0, 2000));
    process.exit(1);
  }

  // Tune the conversation task (task_type === "conversation", else the first).
  const task =
    tasks.find((t) => t.task_type === "conversation") ?? tasks[0];
  task.task_config = deepMerge(task.task_config ?? {}, TASK_CONFIG);
  task.tools_config = task.tools_config ?? {};
  task.tools_config.transcriber = deepMerge(
    task.tools_config.transcriber ?? {},
    TRANSCRIBER
  );
  task.tools_config.synthesizer = deepMerge(
    task.tools_config.synthesizer ?? {},
    SYNTHESIZER
  );
  // llm knobs can sit on llm_agent or llm_agent.llm_config depending on version.
  const la = (task.tools_config.llm_agent = task.tools_config.llm_agent ?? {});
  if (la.llm_config) la.llm_config = deepMerge(la.llm_config, LLM);
  else Object.assign(la, LLM);

  // Re-push the canonical prompt so the dashboard can't drift from the repo.
  let promptBlock = agent.agent_prompts ?? agent.data?.agent_prompts;
  if (!NO_PROMPT) {
    const { system, welcome } = extractPrompt();
    if (system) {
      promptBlock = promptBlock ?? {};
      promptBlock.task_1 = { ...(promptBlock.task_1 ?? {}), system_prompt: system };
    }
    if (welcome) cfg.agent_welcome_message = welcome;
  }

  const payload = { agent_config: cfg, ...(promptBlock ? { agent_prompts: promptBlock } : {}) };

  if (DRY) {
    console.log("--- DRY RUN — merged payload (not sent) ---");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Applying tuned config …");
  const putRes = await fetch(`${BASE}/v2/agent/${AGENT_ID}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  if (!putRes.ok) {
    console.error(`PUT failed (${putRes.status}): ${await putRes.text()}`);
    process.exit(1);
  }
  console.log("✅ Agent tuned. Place a fresh call — no config caching, effective now.");
  console.log("   Fixed: mid-call drops, dead-air/'hello hello', re-asked questions, robotic tone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
