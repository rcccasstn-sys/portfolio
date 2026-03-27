"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from "lightweight-charts";

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

export default function KlineChart({ data, signals, name }: { data: KlineData[]; signals?: Signal[]; name: string }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || !data.length) return;

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: "#141414" },
        textColor: "#a3a3a3",
      },
      grid: {
        vertLines: { color: "#1e1e1e" },
        horzLines: { color: "#1e1e1e" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#262626" },
      timeScale: { borderColor: "#262626", timeVisible: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#ef4444",
      downColor: "#22c55e",
      borderUpColor: "#ef4444",
      borderDownColor: "#22c55e",
      wickUpColor: "#ef4444",
      wickDownColor: "#22c55e",
    });

    candleSeries.setData(data);

    // MA5
    const ma5 = calcMA(data, 5);
    const ma5Series = chart.addSeries(LineSeries, { color: "#eab308", lineWidth: 1 });
    ma5Series.setData(ma5);

    // MA20
    const ma20 = calcMA(data, 20);
    const ma20Series = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1 });
    ma20Series.setData(ma20);

    // 成交量
    const volumeData = data.map((d) => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)",
    }));
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(volumeData);

    // 信号标记
    if (signals?.length) {
      const markers = signals.map((s) => ({
        time: s.time,
        position: s.type === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
        color: s.type === "buy" ? "#22c55e" : s.type === "sell" ? "#ef4444" : "#eab308",
        shape: s.type === "buy" ? ("arrowUp" as const) : s.type === "sell" ? ("arrowDown" as const) : ("circle" as const),
        text: s.text,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (candleSeries as any).setMarkers(markers);
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [data, signals]);

  return (
    <div>
      <h2 className="text-lg font-bold mb-2">{name} K线图</h2>
      <div className="flex gap-4 text-xs mb-2 text-[var(--color-text-muted)]">
        <span><span className="inline-block w-3 h-0.5 bg-[#eab308] mr-1 align-middle"></span>MA5</span>
        <span><span className="inline-block w-3 h-0.5 bg-[#3b82f6] mr-1 align-middle"></span>MA20</span>
        <span className="text-[#ef4444]">■ 涨</span>
        <span className="text-[#22c55e]">■ 跌</span>
      </div>
      <div ref={chartRef} />
    </div>
  );
}

function calcMA(data: KlineData[], period: number) {
  const result: { time: string; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}
