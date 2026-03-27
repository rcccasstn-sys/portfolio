"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import KlineChart from "@/components/KlineChart";

interface KlineData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Signal {
  time: string;
  type: "buy" | "sell" | "warning";
  price: number;
  text: string;
}

function generateSignals(data: KlineData[]): Signal[] {
  const signals: Signal[] = [];
  if (data.length < 20) return signals;

  for (let i = 20; i < data.length; i++) {
    // MA5 金叉 MA20
    const ma5Prev = avg(data, i - 1, 5);
    const ma5Curr = avg(data, i, 5);
    const ma20Prev = avg(data, i - 1, 20);
    const ma20Curr = avg(data, i, 20);

    if (ma5Prev <= ma20Prev && ma5Curr > ma20Curr) {
      signals.push({ time: data[i].time, type: "buy", price: data[i].close, text: "MA金叉" });
    }
    if (ma5Prev >= ma20Prev && ma5Curr < ma20Curr) {
      signals.push({ time: data[i].time, type: "sell", price: data[i].close, text: "MA死叉" });
    }

    // 放量大跌警告（跌幅>3%，成交量>前5日均量2倍）
    const changePercent = ((data[i].close - data[i - 1].close) / data[i - 1].close) * 100;
    const avgVol = data.slice(i - 5, i).reduce((s, d) => s + d.volume, 0) / 5;
    if (changePercent < -3 && data[i].volume > avgVol * 2) {
      signals.push({ time: data[i].time, type: "warning", price: data[i].close, text: "放量大跌" });
    }

    // 连续3日新高
    if (i >= 3 && data[i].high > data[i - 1].high && data[i - 1].high > data[i - 2].high && data[i - 2].high > data[i - 3].high) {
      signals.push({ time: data[i].time, type: "buy", price: data[i].close, text: "三连新高" });
    }
  }

  return signals;
}

function avg(data: KlineData[], endIdx: number, period: number): number {
  let sum = 0;
  for (let j = 0; j < period && endIdx - j >= 0; j++) sum += data[endIdx - j].close;
  return sum / period;
}

export default function StockPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const code = params.code as string;
  const market = searchParams.get("market") || "sh";
  const name = searchParams.get("name") || code;

  const [klineData, setKlineData] = useState<KlineData[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<{ price: number; change: number; changePercent: number } | null>(null);

  useEffect(() => {
    async function load() {
      const [kRes, qRes] = await Promise.all([
        fetch(`/api/stock?action=kline&code=${code}&market=${market}`),
        fetch(`/api/stock?action=quote&codes=${code}`),
      ]);
      const kData: KlineData[] = await kRes.json();
      const qData = await qRes.json();

      setKlineData(kData);
      setSignals(generateSignals(kData));
      if (qData[code]) setQuote(qData[code]);
      setLoading(false);
    }
    load();
  }, [code, market]);

  const pnlColor = (v: number) => (v > 0 ? "text-[var(--color-red)]" : v < 0 ? "text-[var(--color-green)]" : "");

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-[var(--color-text-muted)]">加载K线数据...</div>;
  }

  return (
    <div className="min-h-screen p-4 max-w-6xl mx-auto">
      <header className="flex items-center gap-4 mb-6">
        <Link href="/" className="text-[var(--color-blue)] hover:underline text-sm">&larr; 返回持仓</Link>
        <div>
          <h1 className="text-2xl font-bold">{decodeURIComponent(name)} <span className="text-sm text-[var(--color-text-muted)]">{code}</span></h1>
          {quote && (
            <div className="flex gap-4 items-baseline">
              <span className={`text-xl font-bold font-mono ${pnlColor(quote.change)}`}>
                {quote.price.toFixed(2)}
              </span>
              <span className={`text-sm font-mono ${pnlColor(quote.change)}`}>
                {quote.change > 0 ? "+" : ""}{quote.change.toFixed(2)} ({quote.changePercent > 0 ? "+" : ""}{quote.changePercent.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] p-4 mb-4">
        <KlineChart data={klineData} signals={signals} name={decodeURIComponent(name)} />
      </div>

      {/* 信号列表 */}
      {signals.length > 0 && (
        <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] p-4">
          <h3 className="font-bold mb-3">信号记录</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {signals.slice().reverse().map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-sm py-1 border-b border-[var(--color-border)]">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  s.type === "buy" ? "bg-red-900/30 text-[var(--color-red)]" :
                  s.type === "sell" ? "bg-green-900/30 text-[var(--color-green)]" :
                  "bg-yellow-900/30 text-[var(--color-yellow)]"
                }`}>
                  {s.type === "buy" ? "买入" : s.type === "sell" ? "卖出" : "警告"}
                </span>
                <span className="text-[var(--color-text-muted)]">{s.time}</span>
                <span>{s.text}</span>
                <span className="font-mono">{s.price.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
