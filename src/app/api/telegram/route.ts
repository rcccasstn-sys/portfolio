import { NextResponse } from "next/server";
import { sendTelegram, getUpdates, isTargetChat } from "@/lib/telegram";
import { getHoldings, saveHoldings, getWatchlist, saveWatchlist, loadAlertState, saveAlertState, loadOffset, saveOffset } from "@/lib/store";
import { Holding, WatchItem } from "@/lib/holdings";

// Fetch quotes
async function fetchQuotes(codes: string[], markets: string[]) {
  const sinaCodes = codes.map((c, i) => {
    const m = markets[i];
    if (m === "hk") return `hk${c}`;
    if (c.startsWith("6")) return `sh${c}`;
    if (c.startsWith("0") || c.startsWith("3")) return `sz${c}`;
    if (c.startsWith("8") || c.startsWith("4")) return `bj${c}`;
    return `sh${c}`;
  });
  if (!sinaCodes.length) return {};
  const url = `https://hq.sinajs.cn/list=${sinaCodes.join(",")}`;
  try {
    const res = await fetch(url, { headers: { Referer: "https://finance.sina.com.cn" }, cache: "no-store" });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("gbk").decode(buf);
    const result: Record<string, { price: number; change: number; changePercent: number; name: string }> = {};
    for (const line of text.trim().split("\n")) {
      const matchA = line.match(/hq_str_(s[hz]\d+)="(.*)"/);
      if (matchA) {
        const code = matchA[1].slice(2);
        const parts = matchA[2].split(",");
        if (parts.length < 32) continue;
        const prevClose = parseFloat(parts[2]);
        const currentPrice = parseFloat(parts[3]) || prevClose;
        const change = currentPrice - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
        result[code] = { price: currentPrice, change, changePercent, name: parts[0] };
        continue;
      }
      const matchHK = line.match(/hq_str_hk(\d+)="(.*)"/);
      if (matchHK) {
        const code = matchHK[1];
        const parts = matchHK[2].split(",");
        if (parts.length < 10) continue;
        const currentPrice = parseFloat(parts[6]) || 0;
        const prevClose = parseFloat(parts[3]) || 0;
        const change = currentPrice - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
        result[code] = { price: currentPrice, change, changePercent, name: parts[1] };
      }
    }
    return result;
  } catch { return {}; }
}

function fmt(v: number) { return v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pnl(v: number) { return v >= 0 ? `+${fmt(v)}` : fmt(v); }
function pct(v: number) { return v >= 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`; }

const MARKET_MAP: Record<string, Holding["market"]> = { 上海: "sh", 深圳: "sz", 北京: "bj", 港股: "hk", sh: "sh", sz: "sz", bj: "bj", hk: "hk" };

function guessMarket(code: string): Holding["market"] {
  if (code.startsWith("6")) return "sh";
  if (code.startsWith("0") || code.startsWith("3")) return "sz";
  if (code.startsWith("8") || code.startsWith("4")) return "bj";
  return "sh";
}

// Auto-resolve stock: fetch name and detect market from code
async function resolveStock(code: string, marketHint?: string): Promise<{ name: string; market: Holding["market"] } | null> {
  if (marketHint && MARKET_MAP[marketHint]) {
    const market = MARKET_MAP[marketHint];
    const quotes = await fetchQuotes([code], [market]);
    if (quotes[code]?.name) return { name: quotes[code].name, market };
  }
  // Try HK first for 4-5 digit codes
  if (code.length <= 5) {
    const padded = code.padStart(5, "0");
    const quotes = await fetchQuotes([padded], ["hk"]);
    if (quotes[padded]?.name && quotes[padded].price > 0) return { name: quotes[padded].name, market: "hk" };
  }
  // Try A-share markets
  const aMarket = guessMarket(code);
  const quotes = await fetchQuotes([code], [aMarket]);
  if (quotes[code]?.name && quotes[code].price > 0) return { name: quotes[code].name, market: aMarket };
  return null;
}

async function handleCommand(text: string): Promise<string> {
  const cmd = text.trim();

  // === 持仓快照 ===
  if (cmd === "持仓" || cmd === "/holdings") {
    const holdings = await getHoldings();
    if (!holdings.length) return "📋 暂无持仓";
    const codes = holdings.map((h) => h.code);
    const markets = holdings.map((h) => h.market);
    const quotes = await fetchQuotes(codes, markets);

    let totalValue = 0, totalCost = 0;
    const lines = holdings.map((h) => {
      const q = quotes[h.code];
      const price = q?.price || 0;
      const mv = price * h.quantity;
      const tc = h.cost * h.quantity;
      const profit = mv - tc;
      const profitPct = tc > 0 ? (profit / tc) * 100 : 0;
      totalValue += mv;
      totalCost += tc;
      const chg = q ? pct(q.changePercent) : "-";
      return `*${q?.name || h.name}* (${h.code})\n  现价 ${fmt(price)} ${chg}\n  成本 ${fmt(h.cost)} × ${h.quantity}\n  盈亏 ${pnl(profit)} (${pct(profitPct)})`;
    });

    const totalProfit = totalValue - totalCost;
    const totalPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    return [
      `📊 *持仓快照*`,
      ``,
      ...lines,
      ``,
      `━━━━━━━━━━━━`,
      `总市值: ${fmt(totalValue)}`,
      `总成本: ${fmt(totalCost)}`,
      `总盈亏: ${pnl(totalProfit)} (${pct(totalPct)})`,
      ``,
      `🕐 ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
    ].join("\n");
  }

  // === 备选快照 ===
  if (cmd === "备选" || cmd === "关注" || cmd === "/watchlist") {
    const watchlist = await getWatchlist();
    if (!watchlist.length) return "📋 备选股票池为空";
    const codes = watchlist.map((w) => w.code);
    const markets = watchlist.map((w) => w.market);
    const quotes = await fetchQuotes(codes, markets);

    const lines = watchlist.map((w) => {
      const q = quotes[w.code];
      const price = q?.price || 0;
      const chg = q ? pct(q.changePercent) : "-";
      const note = w.note ? ` | ${w.note}` : "";
      return `*${q?.name || w.name}* (${w.code})\n  现价 ${fmt(price)} ${chg}${note}`;
    });

    return [`📋 *备选股票池*`, ``, ...lines, ``, `🕐 ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`].join("\n");
  }

  // === 添加持仓: 买入 代码 [名称] 成本 数量 [市场] ===
  const addHoldingMatchFull = cmd.match(/^(?:买入|添加持仓)\s+(\d{4,6})\s+(\S+)\s+([\d.]+)\s+(\d+)(?:\s+(\S+))?$/);
  const addHoldingMatchShort = cmd.match(/^(?:买入|添加持仓)\s+(\d{4,6})\s+([\d.]+)\s+(\d+)(?:\s+(\S+))?$/);
  if (addHoldingMatchFull || addHoldingMatchShort) {
    let code: string, name: string | undefined, costStr: string, qtyStr: string, marketStr: string | undefined;
    if (addHoldingMatchFull) {
      [, code, name, costStr, qtyStr, marketStr] = addHoldingMatchFull;
    } else {
      [, code, costStr, qtyStr, marketStr] = addHoldingMatchShort!;
    }
    const resolved = await resolveStock(code, marketStr);
    const finalName = name || resolved?.name || code;
    const market = resolved?.market || (marketStr ? (MARKET_MAP[marketStr] || guessMarket(code)) : guessMarket(code));
    const holding: Holding = { code, name: finalName, cost: parseFloat(costStr), quantity: parseInt(qtyStr), market };
    const holdings = await getHoldings();
    const existing = holdings.find((h) => h.code === code);
    if (existing) return `⚠️ ${code} ${finalName} 已在持仓中，请用「修改持仓」命令`;
    holdings.push(holding);
    await saveHoldings(holdings);
    return `✅ 已添加持仓\n*${finalName}* (${code})\n成本 ${fmt(holding.cost)} × ${holding.quantity}`;
  }

  // === 删除持仓: 卖出 代码 / 删除持仓 代码 ===
  const removeHoldingMatch = cmd.match(/^(?:卖出|删除持仓)\s+(\d{4,6})$/);
  if (removeHoldingMatch) {
    const code = removeHoldingMatch[1];
    const holdings = await getHoldings();
    const target = holdings.find((h) => h.code === code);
    if (!target) return `⚠️ 未找到持仓 ${code}`;
    await saveHoldings(holdings.filter((h) => h.code !== code));
    // 清理关联的告警状态
    const alertState = await loadAlertState();
    if (alertState[`sell:${code}`]) { delete alertState[`sell:${code}`]; await saveAlertState(alertState); }
    return `✅ 已删除持仓 *${target.name}* (${code})`;
  }

  // === 修改持仓: 修改持仓 代码 成本 数量 ===
  const updateHoldingMatch = cmd.match(/^修改持仓\s+(\d{4,6})\s+([\d.]+)\s+(\d+)$/);
  if (updateHoldingMatch) {
    const [, code, costStr, qtyStr] = updateHoldingMatch;
    const holdings = await getHoldings();
    const idx = holdings.findIndex((h) => h.code === code);
    if (idx < 0) return `⚠️ 未找到持仓 ${code}`;
    holdings[idx].cost = parseFloat(costStr);
    holdings[idx].quantity = parseInt(qtyStr);
    await saveHoldings(holdings);
    return `✅ 已修改 *${holdings[idx].name}* (${code})\n成本 ${fmt(holdings[idx].cost)} × ${holdings[idx].quantity}`;
  }

  // === 添加备选: 关注 代码 [名称] [市场] ===
  const addWatchMatch = cmd.match(/^(?:关注|添加备选)\s+(\d{4,6})(?:\s+(\S+))?(?:\s+(\S+))?$/);
  if (addWatchMatch) {
    const [, rawCode, nameOrMarket, marketStr] = addWatchMatch;
    const list = await getWatchlist();
    // Determine if second arg is market or name
    const isMarket = nameOrMarket && MARKET_MAP[nameOrMarket];
    const hintMarket = marketStr || (isMarket ? nameOrMarket : undefined);
    const resolved = await resolveStock(rawCode, hintMarket);
    const code = resolved ? rawCode.padStart(5, "0").replace(/^0(?=\d{5})/, "") || rawCode : rawCode;
    const finalCode = resolved && rawCode.length <= 5 && resolved.market === "hk" ? rawCode.padStart(5, "0") : rawCode;
    const name = (isMarket ? undefined : nameOrMarket) || resolved?.name || finalCode;
    const market = resolved?.market || (hintMarket ? MARKET_MAP[hintMarket] : guessMarket(finalCode)) || guessMarket(finalCode);
    const existing = list.find((w) => w.code === finalCode);
    if (existing) return `⚠️ ${finalCode} ${name} 已在备选池中`;
    const item: WatchItem = { code: finalCode, name, market };
    list.push(item);
    await saveWatchlist(list);
    return `✅ 已添加备选 *${name}* (${finalCode})`;
  }

  // === 删除备选: 取消关注 代码 / 删除备选 代码 ===
  const removeWatchMatch = cmd.match(/^(?:取消关注|删除备选)\s+(\d{4,6})$/);
  if (removeWatchMatch) {
    const code = removeWatchMatch[1];
    const list = await getWatchlist();
    const target = list.find((w) => w.code === code);
    if (!target) return `⚠️ 未找到备选 ${code}`;
    await saveWatchlist(list.filter((w) => w.code !== code));
    // 清理关联的告警状态
    const alertState = await loadAlertState();
    if (alertState[`buy:${code}`]) { delete alertState[`buy:${code}`]; await saveAlertState(alertState); }
    return `✅ 已删除备选 *${target.name}* (${code})`;
  }

  // === 已读告警（指定股票）: 已读 代码/名称 ===
  const ackMatch = cmd.match(/^已读\s*(.+)$/);
  if (ackMatch) {
    const query = ackMatch[1].trim();
    const allItems = [...await getWatchlist(), ...await getHoldings()];
    const target = allItems.find((i) => i.code === query || i.name === query);
    if (!target) return `⚠️ 未找到股票: ${query}`;

    const state = await loadAlertState();
    const buyKey = `buy:${target.code}`;
    const sellKey = `sell:${target.code}`;

    // 获取当前评分作为已读基准
    const origin = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    let currentRawRating = 5;
    try {
      const res = await fetch(`${origin}/api/stock?action=signals&codes=${target.code}&markets=${target.market}`, { cache: "no-store" });
      const data = await res.json();
      const signal = data[target.code];
      if (signal) {
        currentRawRating = ((signal.totalScore + signal.maxScore) / (signal.maxScore * 2)) * 9 + 1;
      }
    } catch { /* ignore */ }

    let acked = false;
    if (state[buyKey]) {
      state[buyKey].acknowledged = true;
      state[buyKey].acknowledgedRating = currentRawRating;
      acked = true;
    }
    if (state[sellKey]) {
      state[sellKey].acknowledged = true;
      state[sellKey].acknowledgedRating = currentRawRating;
      acked = true;
    }

    if (acked) {
      await saveAlertState(state);
      return `✅ 已暂停 *${target.name}* (${target.code}) 的告警\n当前评分: ${currentRawRating.toFixed(1)}/10\n评分变化≥0.5且信号确认时将重新提醒`;
    }
    return `ℹ️ *${target.name}* (${target.code}) 当前没有活跃告警`;
  }

  // === 已读告警（全部）===
  if (cmd === "已读") {
    const state = await loadAlertState();
    const origin = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const allItems = [...await getWatchlist(), ...await getHoldings()];
    let count = 0;

    for (const key of Object.keys(state)) {
      if (key === "ratelimit" || state[key].acknowledged) continue;
      const codeMatch = key.match(/^(?:buy|sell):(.+)$/);
      if (!codeMatch) continue;
      const code = codeMatch[1];
      const item = allItems.find((i) => i.code === code);
      let rawRating = 5;
      if (item) {
        try {
          const res = await fetch(`${origin}/api/stock?action=signals&codes=${code}&markets=${item.market}`, { cache: "no-store" });
          const data = await res.json();
          const signal = data[code];
          if (signal) rawRating = ((signal.totalScore + signal.maxScore) / (signal.maxScore * 2)) * 9 + 1;
        } catch { /* ignore */ }
      }
      state[key].acknowledged = true;
      state[key].acknowledgedRating = rawRating;
      count++;
    }

    if (count > 0) {
      await saveAlertState(state);
      return `✅ 已暂停全部 ${count} 条告警\n评分变化≥0.5且信号确认时将重新提醒`;
    }
    return `ℹ️ 当前没有活跃告警`;
  }

  // === 帮助 ===
  if (cmd === "帮助" || cmd === "/help" || cmd === "菜单") {
    return [
      `📖 *命令列表*`,
      ``,
      `*查看*`,
      `持仓 — 查看持仓快照`,
      `备选 — 查看备选股票池`,
      ``,
      `*持仓管理*`,
      `买入 代码 成本 数量`,
      `买入 代码 名称 成本 数量`,
      `卖出 代码`,
      `修改持仓 代码 成本 数量`,
      ``,
      `*备选管理*`,
      `关注 代码`,
      `关注 代码 名称`,
      `取消关注 代码`,
      ``,
      `*告警管理*`,
      `已读 代码/名称 — 暂停该股告警`,
      `已读 — 暂停全部告警`,
      ``,
      `名称和市场自动识别，无需手动填写`,
      ``,
      `*示例*`,
      `买入 00981 25.5 1000`,
      `关注 09988`,
      `卖出 600519`,
      `已读 09988`,
      `已读 阿里巴巴`,
    ].join("\n");
  }

  // 未匹配指令，忽略（Claude 对话由 asstncc bot 通过 openclaw 处理）
  return "";
}

export async function GET() {
  let offset = await loadOffset();
  const updates = await getUpdates(offset);
  let processed = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const update of updates) {
    offset = update.update_id + 1;
    await saveOffset(offset); // 立即保存，推进 offset（包括群消息）

    // 只处理目标私聊的消息，跳过群消息
    if (!isTargetChat(update)) continue;

    const text = update.message?.text;
    if (!text) continue;

    // 跳过超过 2 分钟的旧消息，防止 offset 重置后批量重发
    const messageAge = now - (update.message?.date || 0);
    if (messageAge > 120) continue;

    const reply = await handleCommand(text);
    if (reply) {
      await sendTelegram(reply);
      processed++;
    }
  }

  await saveOffset(offset);
  return NextResponse.json({ processed, offset });
}
