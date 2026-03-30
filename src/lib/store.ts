import { Holding, defaultHoldings, WatchItem, defaultWatchlist } from "./holdings";
import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// === Storage Backend ===
// 有 UPSTASH_REDIS_REST_URL 时用 Redis，否则用本地 JSON 文件
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    _redis = new Redis({ url, token });
  }
  return _redis;
}

async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const redis = getRedis();
  if (redis) {
    const data = await redis.get<T>(`portfolio:${key}`);
    return data ?? fallback;
  }
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* ignore */ }
  return fallback;
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(`portfolio:${key}`, value);
    return;
  }
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(value, null, 2));
}

// === Holdings ===
export async function getHoldings(): Promise<Holding[]> {
  return kvGet("holdings", defaultHoldings);
}

export async function saveHoldings(holdings: Holding[]): Promise<void> {
  await kvSet("holdings", holdings);
}

// === Watchlist ===
export async function getWatchlist(): Promise<WatchItem[]> {
  return kvGet("watchlist", defaultWatchlist);
}

export async function saveWatchlist(list: WatchItem[]): Promise<void> {
  await kvSet("watchlist", list);
}

// === Alert State ===
export interface AlertEntry {
  lastSentAt: number;
  acknowledged: boolean;
  acknowledgedRating?: number; // 已读时的原始评分（连续值1-10）
}

export type AlertState = Record<string, AlertEntry>;

export async function loadAlertState(): Promise<AlertState> {
  return kvGet("alert-state", {});
}

export async function saveAlertState(state: AlertState): Promise<void> {
  await kvSet("alert-state", state);
}

// === Telegram Offset ===
export async function loadOffset(): Promise<number> {
  const data = await kvGet<{ offset: number }>("telegram-offset", { offset: 0 });
  return data.offset || 0;
}

export async function saveOffset(offset: number): Promise<void> {
  await kvSet("telegram-offset", { offset });
}
