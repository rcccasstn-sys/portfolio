import { Holding, defaultHoldings } from "./holdings";
import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "holdings.json");

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
