import { Holding, defaultHoldings, WatchItem, defaultWatchlist } from "./holdings";
import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "holdings.json");
const WATCH_FILE = path.join(process.cwd(), "data", "watchlist.json");

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getHoldings(): Holding[] {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultHoldings, null, 2));
    return defaultHoldings;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

export function saveHoldings(holdings: Holding[]) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(holdings, null, 2));
}

export function getWatchlist(): WatchItem[] {
  ensureDataDir();
  if (!fs.existsSync(WATCH_FILE)) {
    fs.writeFileSync(WATCH_FILE, JSON.stringify(defaultWatchlist, null, 2));
    return defaultWatchlist;
  }
  return JSON.parse(fs.readFileSync(WATCH_FILE, "utf-8"));
}

export function saveWatchlist(list: WatchItem[]) {
  ensureDataDir();
  fs.writeFileSync(WATCH_FILE, JSON.stringify(list, null, 2));
}
