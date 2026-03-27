import { NextRequest, NextResponse } from "next/server";

// 使用新浪财经接口获取实时行情（支持A股+港股）
async function fetchSinaQuote(codes: string[], markets?: string[]): Promise<Record<string, { price: number; change: number; changePercent: number; name: string }>> {
  const sinaCodes = codes.map((c, i) => {
    const m = markets?.[i];
    if (m === "hk") return `hk${c}`;
    if (c.startsWith("6")) return `sh${c}`;
    if (c.startsWith("0") || c.startsWith("3")) return `sz${c}`;
    if (c.startsWith("8") || c.startsWith("4")) return `bj${c}`;
    return `sh${c}`;
  });

  const url = `https://hq.sinajs.cn/list=${sinaCodes.join(",")}`;
  const res = await fetch(url, {
    headers: { Referer: "https://finance.sina.com.cn" },
    cache: "no-store",
  });
  const buf = await res.arrayBuffer();
  const decoder = new TextDecoder("gbk");
  const text = decoder.decode(buf);
  const result: Record<string, { price: number; change: number; changePercent: number; name: string }> = {};

  const lines = text.trim().split("\n");
  for (const line of lines) {
    // A股格式
    const matchA = line.match(/hq_str_(s[hz]\d+)="(.*)"/);
    if (matchA) {
      const code = matchA[1].slice(2);
      const parts = matchA[2].split(",");
      if (parts.length < 32) continue;
      const name = parts[0];
      const prevClose = parseFloat(parts[2]);
      const currentPrice = parseFloat(parts[3]) || prevClose;
      const change = currentPrice - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      result[code] = { price: currentPrice, change, changePercent, name };
      continue;
    }
    // 港股格式
    const matchHK = line.match(/hq_str_hk(\d+)="(.*)"/);
    if (matchHK) {
      const code = matchHK[1];
      const parts = matchHK[2].split(",");
      if (parts.length < 10) continue;
      const name = parts[1];
      const currentPrice = parseFloat(parts[6]) || 0;
      const prevClose = parseFloat(parts[3]) || 0;
      const change = currentPrice - prevClose;
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
      result[code] = { price: currentPrice, change, changePercent, name };
      continue;
    }
  }

  return result;
}

// 获取 K 线数据（日线，支持A股+港股）
async function fetchKline(code: string, market: string): Promise<Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>> {
  if (market === "hk") {
    return fetchKlineHK(code);
  }
  // A股：使用网易财经接口
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 18);
  const startStr = start.toISOString().slice(0, 10).replace(/-/g, "");
  const endStr = end.toISOString().slice(0, 10).replace(/-/g, "");

  const symbol = market === "sh" ? `0${code}` : `1${code}`;
  const url = `https://quotes.money.163.com/service/chddata.html?code=${symbol}&start=${startStr}&end=${endStr}&fields=TOPEN;HIGH;LOW;TCLOSE;VOTURNOVER`;

  const res = await fetch(url, { cache: "no-store" });
  const buf = await res.arrayBuffer();
  const decoder = new TextDecoder("gbk");
  const text = decoder.decode(buf);
  const lines = text.trim().split("\n").slice(1);

  const data = lines
    .map((line) => {
      const cols = line.split(",");
      if (cols.length < 7) return null;
      const date = cols[0].trim();
      const open = parseFloat(cols[3]);
      const high = parseFloat(cols[4]);
      const low = parseFloat(cols[5]);
      const close = parseFloat(cols[6]);
      const volume = parseFloat(cols[7]) || 0;
      if (isNaN(open) || isNaN(close)) return null;
      return { time: date, open, high, low, close, volume };
    })
    .filter(Boolean)
    .reverse();

  return data as Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
}

// 港股K线：使用新浪财经接口
async function fetchKlineHK(code: string): Promise<Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>> {
  const url = `https://finance.sina.com.cn/stock/hkstock/${code}/klc_kl.js`;
  const res = await fetch(url, { headers: { Referer: "https://finance.sina.com.cn" }, cache: "no-store" });
  const buf = await res.arrayBuffer();
  const decoder = new TextDecoder("gbk");
  const text = decoder.decode(buf);

  // 解析格式: KLC_KL_DB_DAILY = "日期,开盘,最高,最低,收盘,成交量\n..."
  const match = text.match(/"([\s\S]+?)"/);
  if (!match) return [];

  const lines = match[1].trim().split("\n");
  const data = lines
    .map((line) => {
      const cols = line.split(",");
      if (cols.length < 6) return null;
      const date = cols[0].trim();
      const open = parseFloat(cols[1]);
      const high = parseFloat(cols[2]);
      const low = parseFloat(cols[3]);
      const close = parseFloat(cols[4]);
      const volume = parseFloat(cols[5]) || 0;
      if (isNaN(open) || isNaN(close)) return null;
      return { time: date, open, high, low, close, volume };
    })
    .filter(Boolean);

  // 只取最近6个月
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoff = sixMonthsAgo.toISOString().slice(0, 10);

  return (data as Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>)
    .filter((d) => d.time >= cutoff);
}

// MACD/RSI 信号计算
function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [data[0]];
  const k = 2 / (period + 1);
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcMACD(closes: number[]) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = calcEMA(dif, 9);
  const macd = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, macd };
}

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(0);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

// KDJ 计算
function calcKDJ(highs: number[], lows: number[], closes: number[], period = 9) {
  const k: number[] = new Array(closes.length).fill(50);
  const d: number[] = new Array(closes.length).fill(50);
  const j: number[] = new Array(closes.length).fill(50);
  for (let i = period - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let p = 0; p < period; p++) { hh = Math.max(hh, highs[i - p]); ll = Math.min(ll, lows[i - p]); }
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    k[i] = i === period - 1 ? rsv : (2 / 3) * k[i - 1] + (1 / 3) * rsv;
    d[i] = i === period - 1 ? k[i] : (2 / 3) * d[i - 1] + (1 / 3) * k[i];
    j[i] = 3 * k[i] - 2 * d[i];
  }
  return { k, d, j };
}

// 布林带计算
function calcBoll(closes: number[], period = 20) {
  const mid: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { mid.push(0); upper.push(0); lower.push(0); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - j];
    const avg = sum / period;
    let variance = 0;
    for (let j = 0; j < period; j++) variance += (closes[i - j] - avg) ** 2;
    const std = Math.sqrt(variance / period);
    mid.push(avg);
    upper.push(avg + 2 * std);
    lower.push(avg - 2 * std);
  }
  return { mid, upper, lower };
}

// MA 计算
function calcMA(closes: number[], period: number): number[] {
  const result: number[] = new Array(closes.length).fill(0);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - j];
    result[i] = sum / period;
  }
  return result;
}

interface IndicatorScore {
  name: string;
  score: number; // -2 to +2
  signal: string;
  detail: string;
}

interface SignalResult {
  indicators: IndicatorScore[];
  totalScore: number;
  maxScore: number;
  grade: string;
  gradeLabel: string;
  summary: string;
  ema60w: { value: number; above: boolean }; // 60周EMA
  macd: { dif: number; dea: number; macd: number; signal: string };
  rsi: { value: number; signal: string };
}

function analyzeSignals(kline: Array<{ open: number; high: number; low: number; close: number; volume: number }>): SignalResult {
  const closes = kline.map((d) => d.close);
  const highs = kline.map((d) => d.high);
  const lows = kline.map((d) => d.low);
  const volumes = kline.map((d) => d.volume);
  const last = closes.length - 1;
  const prev = last - 1;

  const indicators: IndicatorScore[] = [];

  // 1. MACD 评分 (-2 to +2)
  const { dif, dea, macd } = calcMACD(closes);
  let macdScore = 0;
  let macdSignal = "观望";
  const goldenCross = dif[prev] <= dea[prev] && dif[last] > dea[last];
  const deathCross = dif[prev] >= dea[prev] && dif[last] < dea[last];
  if (goldenCross && dif[last] > 0) { macdScore = 2; macdSignal = "零上金叉"; }
  else if (goldenCross) { macdScore = 1; macdSignal = "金叉"; }
  else if (deathCross && dif[last] < 0) { macdScore = -2; macdSignal = "零下死叉"; }
  else if (deathCross) { macdScore = -1; macdSignal = "死叉"; }
  else if (macd[last] > 0 && macd[last] > macd[prev]) { macdScore = 1; macdSignal = "多头放大"; }
  else if (macd[last] < 0 && macd[last] < macd[prev]) { macdScore = -1; macdSignal = "空头放大"; }
  else if (macd[last] > 0) { macdScore = 0; macdSignal = "多头"; }
  else { macdScore = 0; macdSignal = "空头"; }
  indicators.push({ name: "MACD", score: macdScore, signal: macdSignal, detail: `DIF:${dif[last].toFixed(2)} DEA:${dea[last].toFixed(2)}` });

  // 2. RSI 评分 (-2 to +2)
  const rsi = calcRSI(closes);
  const rsiVal = rsi[last];
  let rsiScore = 0;
  let rsiSignal = "中性";
  if (rsiVal < 20) { rsiScore = 2; rsiSignal = "超卖"; }
  else if (rsiVal < 30) { rsiScore = 1; rsiSignal = "偏弱"; }
  else if (rsiVal > 80) { rsiScore = -2; rsiSignal = "超买"; }
  else if (rsiVal > 70) { rsiScore = -1; rsiSignal = "偏强"; }
  indicators.push({ name: "RSI", score: rsiScore, signal: rsiSignal, detail: `RSI:${rsiVal.toFixed(1)}` });

  // 3. KDJ 评分 (-2 to +2)
  const { k, d, j } = calcKDJ(highs, lows, closes);
  let kdjScore = 0;
  let kdjSignal = "中性";
  const kGolden = k[prev] <= d[prev] && k[last] > d[last];
  const kDeath = k[prev] >= d[prev] && k[last] < d[last];
  if (kGolden && k[last] < 30) { kdjScore = 2; kdjSignal = "低位金叉"; }
  else if (kGolden) { kdjScore = 1; kdjSignal = "金叉"; }
  else if (kDeath && k[last] > 70) { kdjScore = -2; kdjSignal = "高位死叉"; }
  else if (kDeath) { kdjScore = -1; kdjSignal = "死叉"; }
  else if (j[last] < 0) { kdjScore = 1; kdjSignal = "J值超卖"; }
  else if (j[last] > 100) { kdjScore = -1; kdjSignal = "J值超买"; }
  indicators.push({ name: "KDJ", score: kdjScore, signal: kdjSignal, detail: `K:${k[last].toFixed(1)} D:${d[last].toFixed(1)} J:${j[last].toFixed(1)}` });

  // 4. 均线排列 (-2 to +2)
  const ma5 = calcMA(closes, 5);
  const ma10 = calcMA(closes, 10);
  const ma20 = calcMA(closes, 20);
  let maScore = 0;
  let maSignal = "混合";
  if (ma5[last] > ma10[last] && ma10[last] > ma20[last]) {
    maScore = closes[last] > ma5[last] ? 2 : 1;
    maSignal = maScore === 2 ? "强势多头" : "多头排列";
  } else if (ma5[last] < ma10[last] && ma10[last] < ma20[last]) {
    maScore = closes[last] < ma5[last] ? -2 : -1;
    maSignal = maScore === -2 ? "强势空头" : "空头排列";
  } else if (ma5[last] > ma20[last]) {
    maScore = 0; maSignal = "偏多震荡";
  } else {
    maScore = 0; maSignal = "偏空震荡";
  }
  indicators.push({ name: "均线", score: maScore, signal: maSignal, detail: `MA5:${ma5[last].toFixed(2)} MA10:${ma10[last].toFixed(2)} MA20:${ma20[last].toFixed(2)}` });

  // 5. 布林带 (-2 to +2)
  const { mid, upper, lower } = calcBoll(closes);
  let bollScore = 0;
  let bollSignal = "中轨附近";
  if (closes[last] <= lower[last]) { bollScore = 2; bollSignal = "触及下轨"; }
  else if (closes[last] < mid[last] && closes[last] > lower[last]) {
    const pos = (closes[last] - lower[last]) / (mid[last] - lower[last]);
    bollScore = pos < 0.3 ? 1 : 0;
    bollSignal = bollScore === 1 ? "下轨附近" : "中下轨间";
  } else if (closes[last] >= upper[last]) { bollScore = -2; bollSignal = "触及上轨"; }
  else if (closes[last] > mid[last]) {
    const pos = (closes[last] - mid[last]) / (upper[last] - mid[last]);
    bollScore = pos > 0.7 ? -1 : 0;
    bollSignal = bollScore === -1 ? "上轨附近" : "中上轨间";
  }
  indicators.push({ name: "布林", score: bollScore, signal: bollSignal, detail: `上:${upper[last].toFixed(2)} 中:${mid[last].toFixed(2)} 下:${lower[last].toFixed(2)}` });

  // 6. 量价关系 (-2 to +2)
  let volScore = 0;
  let volSignal = "正常";
  if (last >= 5) {
    const avgVol5 = volumes.slice(last - 5, last).reduce((s, v) => s + v, 0) / 5;
    const volRatio = avgVol5 > 0 ? volumes[last] / avgVol5 : 1;
    const priceChange = (closes[last] - closes[prev]) / closes[prev] * 100;
    if (volRatio > 2 && priceChange > 2) { volScore = 2; volSignal = "放量大涨"; }
    else if (volRatio > 1.5 && priceChange > 0) { volScore = 1; volSignal = "放量上涨"; }
    else if (volRatio > 2 && priceChange < -2) { volScore = -2; volSignal = "放量大跌"; }
    else if (volRatio > 1.5 && priceChange < 0) { volScore = -1; volSignal = "放量下跌"; }
    else if (volRatio < 0.5 && priceChange > 0) { volScore = 0; volSignal = "缩量上涨"; }
    else if (volRatio < 0.5 && priceChange < 0) { volScore = 0; volSignal = "缩量下跌"; }
  }
  indicators.push({ name: "量价", score: volScore, signal: volSignal, detail: `量比:${volumes[last] > 0 ? (volumes[last] / (volumes.slice(last - 5, last).reduce((s, v) => s + v, 0) / 5)).toFixed(2) : "N/A"}` });

  // 综合评分
  const totalScore = indicators.reduce((s, i) => s + i.score, 0);
  const maxScore = indicators.length * 2;

  let grade: string, gradeLabel: string;
  if (totalScore >= 8) { grade = "A+"; gradeLabel = "强烈买入"; }
  else if (totalScore >= 5) { grade = "A"; gradeLabel = "买入"; }
  else if (totalScore >= 2) { grade = "B"; gradeLabel = "偏多"; }
  else if (totalScore >= -1) { grade = "C"; gradeLabel = "观望"; }
  else if (totalScore >= -4) { grade = "D"; gradeLabel = "偏空"; }
  else if (totalScore >= -7) { grade = "E"; gradeLabel = "卖出"; }
  else { grade = "E-"; gradeLabel = "强烈卖出"; }

  // EMA60周（约300个交易日），如果数据不够则用现有数据
  const ema300 = calcEMA(closes, Math.min(300, Math.floor(closes.length * 0.8)));
  const ema60wValue = ema300[last];
  const above = closes[last] > ema60wValue;

  return {
    indicators,
    totalScore,
    maxScore,
    grade,
    gradeLabel,
    summary: `${grade} ${gradeLabel}`,
    ema60w: { value: ema60wValue, above },
    macd: { dif: dif[last], dea: dea[last], macd: macd[last], signal: macdSignal },
    rsi: { value: rsiVal, signal: rsiSignal },
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "quote") {
    const codes = searchParams.get("codes")?.split(",") || [];
    const markets = searchParams.get("markets")?.split(",") || [];
    if (!codes.length) return NextResponse.json({ error: "No codes" }, { status: 400 });
    const quotes = await fetchSinaQuote(codes, markets.length ? markets : undefined);
    return NextResponse.json(quotes);
  }

  if (action === "kline") {
    const code = searchParams.get("code") || "";
    const market = searchParams.get("market") || "sh";
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 });
    const kline = await fetchKline(code, market);
    return NextResponse.json(kline);
  }

  if (action === "signals") {
    const codes = searchParams.get("codes")?.split(",") || [];
    const markets = searchParams.get("markets")?.split(",") || [];
    const result: Record<string, SignalResult> = {};
    for (let i = 0; i < codes.length; i++) {
      try {
        const kline = await fetchKline(codes[i], markets[i] || "sh");
        if (kline.length > 30) result[codes[i]] = analyzeSignals(kline);
      } catch { /* skip */ }
    }
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
