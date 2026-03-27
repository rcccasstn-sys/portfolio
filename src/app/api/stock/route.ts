import { NextRequest, NextResponse } from "next/server";

// 使用新浪财经接口获取实时行情
async function fetchSinaQuote(codes: string[]): Promise<Record<string, { price: number; change: number; changePercent: number; name: string }>> {
  const sinaCodes = codes.map((c) => {
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
  const text = await res.text();
  const result: Record<string, { price: number; change: number; changePercent: number; name: string }> = {};

  const lines = text.trim().split("\n");
  for (const line of lines) {
    const match = line.match(/hq_str_(s[hz]\d+)="(.*)"/);
    if (!match) continue;
    const fullCode = match[1];
    const code = fullCode.slice(2);
    const parts = match[2].split(",");
    if (parts.length < 32) continue;

    const name = parts[0];
    const prevClose = parseFloat(parts[2]);
    const currentPrice = parseFloat(parts[3]) || prevClose;
    const change = currentPrice - prevClose;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

    result[code] = { price: currentPrice, change, changePercent, name };
  }

  return result;
}

// 获取 K 线数据（日线）
async function fetchKline(code: string, market: string): Promise<Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>> {
  const prefix = market === "sh" ? "sh" : "sz";
  // 使用网易财经接口获取历史数据
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 6);
  const startStr = start.toISOString().slice(0, 10).replace(/-/g, "");
  const endStr = end.toISOString().slice(0, 10).replace(/-/g, "");

  const symbol = market === "sh" ? `0${code}` : `1${code}`;
  const url = `https://quotes.money.163.com/service/chddata.html?code=${symbol}&start=${startStr}&end=${endStr}&fields=TOPEN;HIGH;LOW;TCLOSE;VOTURNOVER`;

  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // skip header

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "quote") {
    const codes = searchParams.get("codes")?.split(",") || [];
    if (!codes.length) return NextResponse.json({ error: "No codes" }, { status: 400 });
    const quotes = await fetchSinaQuote(codes);
    return NextResponse.json(quotes);
  }

  if (action === "kline") {
    const code = searchParams.get("code") || "";
    const market = searchParams.get("market") || "sh";
    if (!code) return NextResponse.json({ error: "No code" }, { status: 400 });
    const kline = await fetchKline(code, market);
    return NextResponse.json(kline);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
