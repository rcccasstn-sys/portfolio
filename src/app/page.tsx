"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Holding {
  code: string;
  name: string;
  cost: number;
  quantity: number;
  market: "sh" | "sz" | "bj";
}

interface Quote {
  price: number;
  change: number;
  changePercent: number;
  name: string;
}

interface HoldingRow extends Holding {
  currentPrice: number;
  change: number;
  changePercent: number;
  marketValue: number;
  totalCost: number;
  profit: number;
  profitPercent: number;
}

export default function Home() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newHolding, setNewHolding] = useState<{ code: string; name: string; cost: string; quantity: string; market: "sh" | "sz" | "bj" }>({ code: "", name: "", cost: "", quantity: "", market: "sh" });
  const [lastUpdate, setLastUpdate] = useState("");

  const fetchData = useCallback(async () => {
    const holdRes = await fetch("/api/holdings");
    const holds: Holding[] = await holdRes.json();
    setHoldings(holds);

    if (!holds.length) { setRows([]); setLoading(false); return; }

    const codes = holds.map((h) => h.code).join(",");
    const quoteRes = await fetch(`/api/stock?action=quote&codes=${codes}`);
    const quotes: Record<string, Quote> = await quoteRes.json();

    const newRows = holds.map((h) => {
      const q = quotes[h.code] || { price: 0, change: 0, changePercent: 0, name: h.name };
      const totalCost = h.cost * h.quantity;
      const marketValue = q.price * h.quantity;
      const profit = marketValue - totalCost;
      const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;
      return { ...h, name: q.name || h.name, currentPrice: q.price, change: q.change, changePercent: q.changePercent, marketValue, totalCost, profit, profitPercent };
    });

    setRows(newRows);
    setLastUpdate(new Date().toLocaleTimeString("zh-CN"));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const handleAdd = async () => {
    const holding: Holding = {
      code: newHolding.code,
      name: newHolding.name,
      cost: parseFloat(newHolding.cost),
      quantity: parseInt(newHolding.quantity),
      market: newHolding.market as "sh" | "sz" | "bj",
    };
    await fetch("/api/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", holding }),
    });
    setNewHolding({ code: "", name: "", cost: "", quantity: "", market: "sh" });
    setShowAdd(false);
    fetchData();
  };

  const handleRemove = async (code: string) => {
    await fetch("/api/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", holding: { code } }),
    });
    fetchData();
  };

  const pnlColor = (v: number) => (v > 0 ? "text-[var(--color-red)]" : v < 0 ? "text-[var(--color-green)]" : "text-[var(--color-text-muted)]");
  const fmt = (v: number) => v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen text-[var(--color-text-muted)]">加载中...</div>;
  }

  return (
    <div className="min-h-screen p-4 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">持仓管理</h1>
        <div className="text-xs text-[var(--color-text-muted)]">
          {lastUpdate && <>最后更新: {lastUpdate} | 每15秒自动刷新</>}
        </div>
      </header>

      {/* 总览卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--color-card)] rounded-lg p-4 border border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">总市值</div>
          <div className="text-xl font-bold">{fmt(totalValue)}</div>
        </div>
        <div className="bg-[var(--color-card)] rounded-lg p-4 border border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">总成本</div>
          <div className="text-xl font-bold">{fmt(totalCost)}</div>
        </div>
        <div className="bg-[var(--color-card)] rounded-lg p-4 border border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">总盈亏</div>
          <div className={`text-xl font-bold ${pnlColor(totalProfit)}`}>
            {totalProfit > 0 ? "+" : ""}{fmt(totalProfit)}
          </div>
        </div>
        <div className="bg-[var(--color-card)] rounded-lg p-4 border border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">总收益率</div>
          <div className={`text-xl font-bold ${pnlColor(totalProfitPercent)}`}>
            {totalProfitPercent > 0 ? "+" : ""}{totalProfitPercent.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* 持仓列表 */}
      <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs">
              <th className="text-left p-3">股票</th>
              <th className="text-right p-3">现价</th>
              <th className="text-right p-3">涨跌</th>
              <th className="text-right p-3">成本</th>
              <th className="text-right p-3">持仓</th>
              <th className="text-right p-3">市值</th>
              <th className="text-right p-3">盈亏</th>
              <th className="text-right p-3">收益率</th>
              <th className="text-center p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-[var(--color-border)] hover:bg-[#1a1a1a]">
                <td className="p-3">
                  <Link href={`/stock/${r.code}?market=${r.market}&name=${encodeURIComponent(r.name)}`} className="hover:text-[var(--color-blue)]">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)]">{r.code}</div>
                  </Link>
                </td>
                <td className={`text-right p-3 font-mono ${pnlColor(r.change)}`}>{fmt(r.currentPrice)}</td>
                <td className={`text-right p-3 font-mono ${pnlColor(r.change)}`}>
                  {r.change > 0 ? "+" : ""}{r.changePercent.toFixed(2)}%
                </td>
                <td className="text-right p-3 font-mono">{fmt(r.cost)}</td>
                <td className="text-right p-3 font-mono">{r.quantity}</td>
                <td className="text-right p-3 font-mono">{fmt(r.marketValue)}</td>
                <td className={`text-right p-3 font-mono ${pnlColor(r.profit)}`}>
                  {r.profit > 0 ? "+" : ""}{fmt(r.profit)}
                </td>
                <td className={`text-right p-3 font-mono ${pnlColor(r.profitPercent)}`}>
                  {r.profitPercent > 0 ? "+" : ""}{r.profitPercent.toFixed(2)}%
                </td>
                <td className="text-center p-3">
                  <button onClick={() => handleRemove(r.code)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-red)]">
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="text-center p-8 text-[var(--color-text-muted)]">暂无持仓，点击下方添加</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 添加持仓 */}
      {showAdd ? (
        <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] p-4 mb-4">
          <h3 className="font-bold mb-3">添加持仓</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <input placeholder="股票代码" value={newHolding.code} onChange={(e) => setNewHolding({ ...newHolding, code: e.target.value })}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
            <input placeholder="股票名称" value={newHolding.name} onChange={(e) => setNewHolding({ ...newHolding, name: e.target.value })}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
            <input placeholder="成本价" type="number" step="0.01" value={newHolding.cost} onChange={(e) => setNewHolding({ ...newHolding, cost: e.target.value })}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
            <input placeholder="持仓数量" type="number" value={newHolding.quantity} onChange={(e) => setNewHolding({ ...newHolding, quantity: e.target.value })}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
            <select value={newHolding.market} onChange={(e) => setNewHolding({ ...newHolding, market: e.target.value as Holding["market"] })}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm">
              <option value="sh">上海</option>
              <option value="sz">深圳</option>
              <option value="bj">北京</option>
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAdd} className="bg-[var(--color-blue)] text-white px-4 py-2 rounded text-sm hover:opacity-80">确认添加</button>
            <button onClick={() => setShowAdd(false)} className="bg-[var(--color-border)] text-white px-4 py-2 rounded text-sm hover:opacity-80">取消</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="bg-[var(--color-card)] border border-dashed border-[var(--color-border)] rounded-lg p-3 w-full text-sm text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-blue)]">
          + 添加持仓
        </button>
      )}
    </div>
  );
}
