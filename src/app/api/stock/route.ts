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
  start.setMonth(start.getMonth() - 6);
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

interface SignalResult {
  macd: { dif: number; dea: number; macd: number; signal: string };
  rsi: { value: number; signal: string };
  summary: string;
}

function analyzeSignals(kline: Array<{ close: number }>): SignalResult {
  const closes = kline.map((d) => d.close);
  const { dif, dea, macd } = calcMACD(closes);
  const rsi = calcRSI(closes);
  const last = closes.length - 1;
  const prev = last - 1;

  let macdSignal = "观望";
  if (dif[prev] <= dea[prev] && dif[last] > dea[last]) macdSignal = "金叉买入";
  else if (dif[prev] >= dea[prev] && dif[last] < dea[last]) macdSignal = "死叉卖出";
  else if (macd[last] > 0 && macd[last] > macd[prev]) macdSignal = "多头增强";
  else if (macd[last] < 0 && macd[last] < macd[prev]) macdSignal = "空头增强";
  else if (macd[last] > 0) macdSignal = "多头";
  else if (macd[last] < 0) macdSignal = "空头";

  let rsiSignal = "中性";
  const rsiVal = rsi[last];
  if (rsiVal > 80) rsiSignal = "超买警告";
  else if (rsiVal > 70) rsiSignal = "偏强";
  else if (rsiVal < 20) rsiSignal = "超卖机会";
  else if (rsiVal < 30) rsiSignal = "偏弱";

  let summary = "";
  if (macdSignal === "金叉买入" && rsiVal < 50) summary = "买入信号";
  else if (macdSignal === "死叉卖出" && rsiVal > 50) summary = "卖出信号";
  else if (rsiVal > 80) summary = "超买预警";
  else if (rsiVal < 20) summary = "超卖机会";
  else if (macdSignal.includes("多头")) summary = "偏多";
  else if (macdSignal.includes("空头")) summary = "偏空";
  else summary = "观望";

  return {
    macd: { dif: dif[last], dea: dea[last], macd: macd[last], signal: macdSignal },
    rsi: { value: rsiVal, signal: rsiSignal },
    summary,
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
