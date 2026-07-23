import type { NormalizedCall } from "./providers/types";

// ---------------------------------------------------------------------------
// Durable call store — the source of truth for finished calls, keyed by
// provider execution id.
//
// A call is a business event: the lead + transcript must be captured
// server-side the moment the Bolna completion webhook fires, whether or not a
// browser tab is open and polling. That requires DURABLE, CROSS-INSTANCE
// storage — an in-process Map fails on serverless (webhook lands on instance A,
// the poll hits instance B).
//
// Backend resolves at runtime:
//   • Redis over REST (Upstash / Vercel Marketplace) when the env vars are set
//     — HTTP-based, no persistent socket, correct for Fluid Compute. Zero npm
//     dependency: we speak the Upstash REST command protocol with plain fetch.
//   • In-memory Map fallback for local dev (single instance) when no store is
//     configured.
//
// Error policy is asymmetric on purpose:
//   • WRITE (cacheCall) throws on failure -> the webhook returns non-2xx ->
//     Bolna retries. Durable capture beats swallowing the error.
//   • READ (getCachedCall) swallows failure and returns undefined -> callers
//     degrade gracefully to polling the provider. A store blip must not break
//     live status.
// ---------------------------------------------------------------------------

const TTL_S = Number(process.env.CALL_STORE_TTL_SECONDS || 7 * 24 * 3600); // 7d
const KEY = (id: string) => `call:${id}`;

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

// Upstash REST: POST a Redis command as a JSON array; response is { result }.
async function redisCmd(
  cfg: { url: string; token: string },
  cmd: (string | number)[],
): Promise<unknown> {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Redis ${cmd[0]} failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { result?: unknown };
  return data.result;
}

// ---- In-memory fallback (local dev only) ----------------------------------
interface Entry {
  call: NormalizedCall;
  at: number;
}
const mem = new Map<string, Entry>();
let warnedNoStore = false;

function memSweep() {
  const now = Date.now();
  for (const [id, e] of mem) {
    if (now - e.at > TTL_S * 1000) mem.delete(id);
  }
}

// ---- Public API ------------------------------------------------------------
export async function cacheCall(call: NormalizedCall): Promise<void> {
  if (!call?.id) return;
  const cfg = redisConfig();
  if (!cfg) {
    if (!warnedNoStore) {
      console.warn(
        "[callStore] No Redis env (KV_REST_API_URL/TOKEN) — using in-memory fallback. Leads are NOT durable across serverless instances.",
      );
      warnedNoStore = true;
    }
    memSweep();
    mem.set(String(call.id), { call, at: Date.now() });
    return;
  }
  // Throw on failure so the webhook returns non-2xx and Bolna retries.
  await redisCmd(cfg, ["SET", KEY(String(call.id)), JSON.stringify(call), "EX", TTL_S]);
}

export async function getCachedCall(
  id: string,
): Promise<NormalizedCall | undefined> {
  const cfg = redisConfig();
  if (!cfg) {
    const e = mem.get(String(id));
    if (!e) return undefined;
    if (Date.now() - e.at > TTL_S * 1000) {
      mem.delete(String(id));
      return undefined;
    }
    return e.call;
  }
  try {
    const raw = await redisCmd(cfg, ["GET", KEY(String(id))]);
    return typeof raw === "string" ? (JSON.parse(raw) as NormalizedCall) : undefined;
  } catch (err) {
    // Degrade to polling — never break live status on a store blip.
    console.warn(`[callStore] read failed, falling back to poll: ${String(err)}`);
    return undefined;
  }
}
