// Shared server-only Upstash Redis client. Null when no credentials are
// configured (local dev before provisioning) — callers fall back to their
// in-memory stores. Vercel's Upstash integration injects the KV_REST_API_*
// aliases; plain Upstash setups use UPSTASH_REDIS_REST_*. Both work.
import "server-only";
import { Redis } from "@upstash/redis";

function makeRedis(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) return new Redis({ url, token });
  return null;
}

export const redis = makeRedis();
