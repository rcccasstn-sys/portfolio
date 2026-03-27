"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Holding {
  code: string;
  name: string;
  note?: string;
  cost: number;
  quantity: number;
  market: "sh" | "sz" | "bj";
}

interface WatchItem {
  code: string;
  name: string;
  note?: string;
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

interface WatchRow extends WatchItem {
  currentPrice: number;
  change: number;
  changePercent: number;
  signals?: { macd: { signal: string }; rsi: { value: number; signal: string }; summary: string };
}

export default function Home() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [watchRows, setWatchRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState("");

  const [holdingsOpen, setHoldingsOpen] = useState(true);
  const [watchOpen, setWatchOpen] = useState(true);

  const [showAddHolding, setShowAddHolding] = useState(false);
  const [newHolding, setNewHolding] = useState<{ code: string; name: string; note: string; cost: string; quantity: string; market: "sh" | "sz" | "bj" }>({ code: "", name: "", note: "", cost: "", quantity: "", market: "sh" });

  const [showAddWatch, setShowAddWatch] = useState(false);
  const [newWatch, setNewWatch] = useState<{ code: string; name: string; note: string; market: "sh" | "sz" | "bj" }>({ code: "", name: "", note: "", market: "sh" });

  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteTarget, setNoteTarget] = useState<"holding" | "watch">("holding");

  const fetchData = useCallback(async () => {
    // Fetch holdings
    const holdRes = await fetch("/api/holdings");
    const holds: Holding[] = await holdRes.json();
    setHoldings(holds);

    // Fetch watchlist
    const watchRes = await fetch("/api/watchlist");
    const watches: WatchItem[] = await watchRes.json();
    setWatchlist(watches);

    // Fetch all quotes
    const allCodes = [...holds.map((h) => h.code), ...watches.map((w) => w.code)];
    let quotes: Record<string, Quote> = {};
    if (allCodes.length) {
      const quoteRes = await fetch(`/api/stock?action=quote&codes=${[...new Set(allCodes)].join(",")}`);
      quotes = await quoteRes.json();
    }

    // Build holding rows
    const newRows = holds.map((h) => {
      const q = quotes[h.code] || { price: 0, change: 0, changePercent: 0, name: h.name };
      const totalCost = h.cost * h.quantity;
      const marketValue = q.price * h.quantity;
      const profit = marketValue - totalCost;
      const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;
      return { ...h, name: q.name || h.name, currentPrice: q.price, change: q.change, changePercent: q.changePercent, marketValue, totalCost, profit, profitPercent };
    });
    setRows(newRows);

    // Build watch rows (without signals first)
    const newWatchRows: WatchRow[] = watches.map((w) => {
      const q = quotes[w.code] || { price: 0, change: 0, changePercent: 0, name: w.name };
      return { ...w, name: q.name || w.name, currentPrice: q.price, change: q.change, changePercent: q.changePercent };
    });
    setWatchRows(newWatchRows);

    // Fetch signals for watchlist
    if (watches.length) {
      const sigRes = await fetch(`/api/stock?action=signals&codes=${watches.map((w) => w.code).join(",")}&markets=${watches.map((w) => w.market).join(",")}`);
      const sigs = await sigRes.json();
      setWatchRows((prev) => prev.map((w) => ({ ...w, signals: sigs[w.code] })));
    }

    setLastUpdate(new Date().toLocaleTimeString("zh-CN"));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const totalValue = rows.reduce((s, r) => s + r.marketValue, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const handleAddHolding = async () => {
    await fetch("/api/holdings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", holding: { code: newHolding.code, name: newHolding.name, note: newHolding.note || undefined, cost: parseFloat(newHolding.cost), quantity: parseInt(newHolding.quantity), market: newHolding.market } }),
    });
    setNewHolding({ code: "", name: "", note: "", cost: "", quantity: "", market: "sh" });
    setShowAddHolding(false);
    fetchData();
  };

  const handleRemoveHolding = async (code: string) => {
    await fetch("/api/holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", holding: { code } }) });
    fetchData();
  };

  const handleAddWatch = async () => {
    await fetch("/api/watchlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", item: { code: newWatch.code, name: newWatch.name, note: newWatch.note || undefined, market: newWatch.market } }),
    });
    setNewWatch({ code: "", name: "", note: "", market: "sh" });
    setShowAddWatch(false);
    fetchData();
  };

  const handleRemoveWatch = async (code: string) => {
    await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", item: { code } }) });
    fetchData();
  };

  const handleSaveNote = async (code: string) => {
    if (noteTarget === "holding") {
      const hold = holdings.find((h) => h.code === code);
      if (hold) await fetch("/api/holdings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", holding: { ...hold, note: noteText || undefined } }) });
    } else {
      const item = watchlist.find((w) => w.code === code);
      if (item) await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", item: { ...item, note: noteText || undefined } }) });
    }
    setEditingNote(null);
    fetchData();
  };

  const pnlColor = (v: number) => (v > 0 ? "text-[var(--color-red)]" : v < 0 ? "text-[var(--color-green)]" : "text-[var(--color-text-muted)]");
  const fmt = (v: number) => v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const signalColor = (s: string) => {
    if (s.includes("买入") || s.includes("超卖") || s.includes("偏多")) return "text-[var(--color-red)] bg-red-900/20";
    if (s.includes("卖出") || s.includes("超买") || s.includes("偏空")) return "text-[var(--color-green)] bg-green-900/20";
    return "text-[var(--color-text-muted)] bg-[var(--color-border)]";
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen text-[var(--color-text-muted)]">加载中...</div>;

  return (
    <div className="min-h-screen p-4 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">持仓管理</h1>
        <div className="text-xs text-[var(--color-text-muted)]">
          {lastUpdate && <>最后更新: {lastUpdate} | 每30秒刷新</>}
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
          <div className={`text-xl font-bold ${pnlColor(totalProfit)}`}>{totalProfit > 0 ? "+" : ""}{fmt(totalProfit)}</div>
        </div>
        <div className="bg-[var(--color-card)] rounded-lg p-4 border border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">总收益率</div>
          <div className={`text-xl font-bold ${pnlColor(totalProfitPercent)}`}>{totalProfitPercent > 0 ? "+" : ""}{totalProfitPercent.toFixed(2)}%</div>
        </div>
      </div>

      {/* 持仓列表（可折叠） */}
      <div className="mb-6">
        <button onClick={() => setHoldingsOpen(!holdingsOpen)} className="flex items-center gap-2 mb-3 text-lg font-bold hover:text-[var(--color-blue)]">
          <span className={`transition-transform ${holdingsOpen ? "rotate-90" : ""}`}>&#9654;</span>
          持仓 ({rows.length})
        </button>
        {holdingsOpen && (
          <>
            <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] overflow-x-auto mb-3">
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
                        {editingNote === r.code && noteTarget === "holding" ? (
                          <div className="flex items-center gap-1 mt-1">
                            <input autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleSaveNote(r.code); if (e.key === "Escape") setEditingNote(null); }}
                              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs w-28" placeholder="输入备注" />
                            <button onClick={() => handleSaveNote(r.code)} className="text-xs text-[var(--color-blue)]">保存</button>
                            <button onClick={() => setEditingNote(null)} className="text-xs text-[var(--color-text-muted)]">取消</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingNote(r.code); setNoteText(r.note || ""); setNoteTarget("holding"); }}
                            className="text-xs mt-0.5 text-[var(--color-yellow)] hover:underline">{r.note || "+ 备注"}</button>
                        )}
                      </td>
                      <td className={`text-right p-3 font-mono ${pnlColor(r.change)}`}>{fmt(r.currentPrice)}</td>
                      <td className={`text-right p-3 font-mono ${pnlColor(r.change)}`}>{r.change > 0 ? "+" : ""}{r.changePercent.toFixed(2)}%</td>
                      <td className="text-right p-3 font-mono">{fmt(r.cost)}</td>
                      <td className="text-right p-3 font-mono">{r.quantity}</td>
                      <td className="text-right p-3 font-mono">{fmt(r.marketValue)}</td>
                      <td className={`text-right p-3 font-mono ${pnlColor(r.profit)}`}>{r.profit > 0 ? "+" : ""}{fmt(r.profit)}</td>
                      <td className={`text-right p-3 font-mono ${pnlColor(r.profitPercent)}`}>{r.profitPercent > 0 ? "+" : ""}{r.profitPercent.toFixed(2)}%</td>
                      <td className="text-center p-3">
                        <button onClick={() => handleRemoveHolding(r.code)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-red)]">删除</button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={9} className="text-center p-6 text-[var(--color-text-muted)]">暂无持仓</td></tr>}
                </tbody>
              </table>
            </div>
            {showAddHolding ? (
              <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] p-4">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <input placeholder="股票代码" value={newHolding.code} onChange={(e) => setNewHolding({ ...newHolding, code: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
                  <input placeholder="股票名称" value={newHolding.name} onChange={(e) => setNewHolding({ ...newHolding, name: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
                  <input placeholder="成本价" type="number" step="0.01" value={newHolding.cost} onChange={(e) => setNewHolding({ ...newHolding, cost: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
                  <input placeholder="持仓数量" type="number" value={newHolding.quantity} onChange={(e) => setNewHolding({ ...newHolding, quantity: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
                  <select value={newHolding.market} onChange={(e) => setNewHolding({ ...newHolding, market: e.target.value as Holding["market"] })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm">
                    <option value="sh">上海</option><option value="sz">深圳</option><option value="bj">北京</option>
                  </select>
                  <div className="flex gap-2">
                    <button onClick={handleAddHolding} className="bg-[var(--color-blue)] text-white px-4 py-2 rounded text-sm hover:opacity-80">添加</button>
                    <button onClick={() => setShowAddHolding(false)} className="bg-[var(--color-border)] text-white px-4 py-2 rounded text-sm hover:opacity-80">取消</button>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddHolding(true)} className="bg-[var(--color-card)] border border-dashed border-[var(--color-border)] rounded-lg p-2 w-full text-sm text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-blue)]">+ 添加持仓</button>
            )}
          </>
        )}
      </div>

      {/* 备选股票池 */}
      <div className="mb-6">
        <button onClick={() => setWatchOpen(!watchOpen)} className="flex items-center gap-2 mb-3 text-lg font-bold hover:text-[var(--color-blue)]">
          <span className={`transition-transform ${watchOpen ? "rotate-90" : ""}`}>&#9654;</span>
          备选股票池 ({watchRows.length})
        </button>
        {watchOpen && (
          <>
            <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] overflow-x-auto mb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs">
                    <th className="text-left p-3">股票</th>
                    <th className="text-right p-3">现价</th>
                    <th className="text-right p-3">涨跌</th>
                    <th className="text-center p-3">MACD</th>
                    <th className="text-center p-3">RSI</th>
                    <th className="text-center p-3">综合信号</th>
                    <th className="text-center p-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {watchRows.map((w) => (
                    <tr key={w.code} className="border-b border-[var(--color-border)] hover:bg-[#1a1a1a]">
                      <td className="p-3">
                        <Link href={`/stock/${w.code}?market=${w.market}&name=${encodeURIComponent(w.name)}`} className="hover:text-[var(--color-blue)]">
                          <div className="font-medium">{w.name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{w.code}</div>
                        </Link>
                        {editingNote === w.code && noteTarget === "watch" ? (
                          <div className="flex items-center gap-1 mt-1">
                            <input autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleSaveNote(w.code); if (e.key === "Escape") setEditingNote(null); }}
                              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-0.5 text-xs w-28" placeholder="输入备注" />
                            <button onClick={() => handleSaveNote(w.code)} className="text-xs text-[var(--color-blue)]">保存</button>
                            <button onClick={() => setEditingNote(null)} className="text-xs text-[var(--color-text-muted)]">取消</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditingNote(w.code); setNoteText(w.note || ""); setNoteTarget("watch"); }}
                            className="text-xs mt-0.5 text-[var(--color-yellow)] hover:underline">{w.note || "+ 备注"}</button>
                        )}
                      </td>
                      <td className={`text-right p-3 font-mono ${pnlColor(w.change)}`}>{fmt(w.currentPrice)}</td>
                      <td className={`text-right p-3 font-mono ${pnlColor(w.change)}`}>{w.change > 0 ? "+" : ""}{w.changePercent.toFixed(2)}%</td>
                      <td className="text-center p-3">
                        {w.signals ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${signalColor(w.signals.macd.signal)}`}>{w.signals.macd.signal}</span>
                        ) : <span className="text-xs text-[var(--color-text-muted)]">计算中...</span>}
                      </td>
                      <td className="text-center p-3">
                        {w.signals ? (
                          <span className={`text-xs px-2 py-0.5 rounded ${signalColor(w.signals.rsi.signal)}`}>
                            {w.signals.rsi.value.toFixed(1)} {w.signals.rsi.signal}
                          </span>
                        ) : <span className="text-xs text-[var(--color-text-muted)]">...</span>}
                      </td>
                      <td className="text-center p-3">
                        {w.signals ? (
                          <span className={`text-xs px-2 py-1 rounded font-bold ${signalColor(w.signals.summary)}`}>{w.signals.summary}</span>
                        ) : <span className="text-xs text-[var(--color-text-muted)]">...</span>}
                      </td>
                      <td className="text-center p-3">
                        <button onClick={() => handleRemoveWatch(w.code)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-red)]">删除</button>
                      </td>
                    </tr>
                  ))}
                  {watchRows.length === 0 && <tr><td colSpan={7} className="text-center p-6 text-[var(--color-text-muted)]">暂无备选股票</td></tr>}
                </tbody>
              </table>
            </div>
            {showAddWatch ? (
              <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <input placeholder="股票代码" value={newWatch.code} onChange={(e) => setNewWatch({ ...newWatch, code: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
                  <input placeholder="股票名称" value={newWatch.name} onChange={(e) => setNewWatch({ ...newWatch, name: e.target.value })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
                  <select value={newWatch.market} onChange={(e) => setNewWatch({ ...newWatch, market: e.target.value as WatchItem["market"] })} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-3 py-2 text-sm">
                    <option value="sh">上海</option><option value="sz">深圳</option><option value="bj">北京</option>
                  </select>
                  <div className="flex gap-2">
                    <button onClick={handleAddWatch} className="bg-[var(--color-blue)] text-white px-4 py-2 rounded text-sm hover:opacity-80">添加</button>
                    <button onClick={() => setShowAddWatch(false)} className="bg-[var(--color-border)] text-white px-4 py-2 rounded text-sm hover:opacity-80">取消</button>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddWatch(true)} className="bg-[var(--color-card)] border border-dashed border-[var(--color-border)] rounded-lg p-2 w-full text-sm text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-blue)]">+ 添加备选股票</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
