import { NextResponse } from "next/server";
import { getWatchlist, getHoldings, loadAlertState, saveAlertState } from "@/lib/store";
import { sendTelegram } from "@/lib/telegram";

// Fetch quotes from Sina
async function fetchQuotes(codes: string[], markets: string[]) {
  const sinaCodes = codes.map((c, i) => {
    const m = markets[i];
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
}

// Fetch signals (reuse logic from stock route)
async function fetchSignals(code: string, market: string) {
  const origin = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${origin}/api/stock?action=signals&codes=${code}&markets=${market}`, { cache: "no-store" });
  const data = await res.json();
  return data[code] || null;
}

function rawRating(totalScore: number, maxScore: number): number {
  return ((totalScore + maxScore) / (maxScore * 2)) * 9 + 1;
}

const MACD_BUY = ["金叉", "零上金叉", "多头放大"];
const MACD_SELL = ["死叉", "零下死叉", "空头放大", "空头"];

function fmtR(v: number) { return v.toFixed(1); }
function pctFmt(v: number) { return v >= 0 ? `+${v.toFixed(2)}%` : `${v.toFixed(2)}%`; }

export async function GET() {
  // Only run during trading hours: Mon-Fri 8:00-16:00 CST
  const cst = new Date(Date.now() + 8 * 3600 * 1000);
  const dow = cst.getUTCDay(); // 0=Sun, 6=Sat
  const hour = cst.getUTCHours();
  if (dow === 0 || dow === 6 || hour < 8 || hour >= 16) {
    return NextResponse.json({ checked: 0, triggered: [], skipped: "outside trading hours" });
  }

  const watchlist = await getWatchlist();
  const holdings = await getHoldings();

  const state = await loadAlertState();
  const now = Date.now();
  const RESEND_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Collect all codes for quote fetching
  const allItems = [
    ...watchlist.map((w) => ({ code: w.code, market: w.market, name: w.name })),
    ...holdings.map((h) => ({ code: h.code, market: h.market, name: h.name })),
  ];
  const uniqueCodes = [...new Map(allItems.map((i) => [i.code, i])).values()];
  const quotes = uniqueCodes.length
    ? await fetchQuotes(uniqueCodes.map((i) => i.code), uniqueCodes.map((i) => i.market))
    : {};

  // Detect empty API response (rate limited)
  if (uniqueCodes.length > 0 && Object.keys(quotes).length === 0) {
    const rateLimitKey = "ratelimit";
    const existing = state[rateLimitKey];
    const RATELIMIT_INTERVAL = 10 * 60 * 1000; // 10 min cooldown
    if (!existing || (now - existing.lastSentAt >= RATELIMIT_INTERVAL)) {
      await sendTelegram("⚠️ *行情接口限流*\n\n新浪/腾讯接口返回空数据，可能被临时限流。告警暂停，恢复后自动继续。");
      state[rateLimitKey] = { lastSentAt: now, acknowledged: false };
      await saveAlertState(state);
    }
    return NextResponse.json({ checked: 0, triggered: [], rateLimited: true, time: new Date().toISOString() });
  }

  const triggered: string[] = [];

  // --- Buy alerts: watchlist ---
  for (const item of watchlist) {
    const signal = await fetchSignals(item.code, item.market);
    if (!signal) continue;

    const rating = signal.rating as number;
    const raw = rawRating(signal.totalScore, signal.maxScore);
    const ema60wAbove = signal.ema60w?.above as boolean;
    const macdSignal = signal.macd?.signal as string;
    const macdBearish = MACD_SELL.includes(macdSignal);
    const macdBullish = MACD_BUY.includes(macdSignal);

    const key = `buy:${item.code}`;

    // --- 低位买入：评分≥5.5 + 60周均线下方 + MACD非空头 ---
    if (raw >= 5.5 && !ema60wAbove && !macdBearish) {
      const existing = state[key];
      const quote = quotes[item.code];

      if (existing?.acknowledged) {
        const ackRating = existing.acknowledgedRating || 0;
        if (raw >= ackRating + 0.5 && macdBullish) {
          const priceLine = quote
            ? `现价: ${quote.price.toFixed(2)} (${pctFmt(quote.changePercent)})`
            : "";
          const msg = [
            `🔔 *备选股买入信号升级*`,
            ``,
            `*${item.name}* (${item.code})`,
            priceLine,
            `评分: ${fmtR(raw)}/10 (${signal.ratingLabel}) ⬆️ 从 ${fmtR(ackRating)} 升至 ${fmtR(raw)}`,
            `MACD: ${macdSignal} ← 买入确认`,
            `RSI: ${signal.rsi?.value?.toFixed(1) || "-"}`,
            `W60: 价格在60周均线下方`,
            ``,
            `⬆️ 评分上升${fmtR(raw - ackRating)}，MACD确认买入，建议关注`,
            ``,
            `回复「已读 ${item.code}」暂停提醒`,
          ].join("\n");
          await sendTelegram(msg);
          state[key] = { lastSentAt: now, acknowledged: false };
          triggered.push(key);
        }
        continue;
      }

      if (!existing || (now - existing.lastSentAt >= RESEND_INTERVAL)) {
        const priceLine = quote
          ? `现价: ${quote.price.toFixed(2)} (${pctFmt(quote.changePercent)})`
          : "";
        const msg = [
          `🔔 *备选股买入信号*`,
          ``,
          `*${item.name}* (${item.code})`,
          priceLine,
          `评分: ${fmtR(raw)}/10 (${signal.ratingLabel})`,
          `W60: 价格在60周均线下方`,
          `MACD: ${macdSignal}`,
          `RSI: ${signal.rsi?.value?.toFixed(1) || "-"}`,
          ``,
          `⬆️ 评分≥5.5 + 低于60周均线 + MACD非空头，关注买入`,
          ``,
          `回复「已读 ${item.code}」暂停提醒`,
        ].join("\n");
        await sendTelegram(msg);
        state[key] = { lastSentAt: now, acknowledged: false };
        triggered.push(key);
      }
    }
    // --- 追涨信号：评分≥7 + 60周均线上方 + MACD多头确认 ---
    else if (raw >= 6.5 && ema60wAbove && macdBullish) {
      const chaseKey = `chase:${item.code}`;
      const existing = state[chaseKey];
      const quote = quotes[item.code];

      if (existing?.acknowledged) {
        const ackRating = existing.acknowledgedRating || 0;
        if (raw >= ackRating + 0.5 && macdBullish) {
          const priceLine = quote
            ? `现价: ${quote.price.toFixed(2)} (${pctFmt(quote.changePercent)})`
            : "";
          const msg = [
            `🚀 *备选股追涨信号升级*`,
            ``,
            `*${item.name}* (${item.code})`,
            priceLine,
            `评分: ${fmtR(raw)}/10 (${signal.ratingLabel}) ⬆️ 从 ${fmtR(ackRating)} 升至 ${fmtR(raw)}`,
            `MACD: ${macdSignal} ← 多头确认`,
            `RSI: ${signal.rsi?.value?.toFixed(1) || "-"}`,
            `W60: 价格在60周均线上方（强势）`,
            ``,
            `🚀 评分上升${fmtR(raw - ackRating)}，强势追涨信号`,
            ``,
            `回复「已读 ${item.code}」暂停提醒`,
          ].join("\n");
          await sendTelegram(msg);
          state[chaseKey] = { lastSentAt: now, acknowledged: false };
          triggered.push(chaseKey);
        }
        continue;
      }

      if (!existing || (now - existing.lastSentAt >= RESEND_INTERVAL)) {
        const priceLine = quote
          ? `现价: ${quote.price.toFixed(2)} (${pctFmt(quote.changePercent)})`
          : "";
        const msg = [
          `🚀 *备选股追涨信号*`,
          ``,
          `*${item.name}* (${item.code})`,
          priceLine,
          `评分: ${fmtR(raw)}/10 (${signal.ratingLabel})`,
          `W60: 价格在60周均线上方（强势）`,
          `MACD: ${macdSignal} ← 多头确认`,
          `RSI: ${signal.rsi?.value?.toFixed(1) || "-"}`,
          ``,
          `🚀 评分≥6.5 + 突破60周均线 + MACD多头，强势追涨`,
          ``,
          `回复「已读 ${item.code}」暂停提醒`,
        ].join("\n");
        await sendTelegram(msg);
        state[chaseKey] = { lastSentAt: now, acknowledged: false };
        triggered.push(chaseKey);
      }
    } else {
      // 条件不再满足，只清除未已读的状态
      if (state[key] && !state[key].acknowledged) delete state[key];
      const chaseKey = `chase:${item.code}`;
      if (state[chaseKey] && !state[chaseKey].acknowledged) delete state[chaseKey];
    }
  }

  // Merge same-stock holdings (avoid duplicate sell alerts)
  const holdingMap = new Map<string, { code: string; name: string; market: string; cost: number; quantity: number }>();
  for (const h of holdings) {
    const ex = holdingMap.get(h.code);
    if (ex) {
      const newQty = ex.quantity + h.quantity;
      ex.cost = (ex.cost * ex.quantity + h.cost * h.quantity) / newQty;
      ex.quantity = newQty;
    } else {
      holdingMap.set(h.code, { code: h.code, name: h.name, market: h.market, cost: h.cost, quantity: h.quantity });
    }
  }
  const mergedHoldings = [...holdingMap.values()];

  // --- Sell alerts: mergedHoldings ---
  for (const item of mergedHoldings) {
    const signal = await fetchSignals(item.code, item.market);
    if (!signal) continue;

    const rating = signal.rating as number;
    const raw = rawRating(signal.totalScore, signal.maxScore);
    const macdSignal = signal.macd?.signal as string;
    const macdBearish = MACD_SELL.includes(macdSignal);

    const key = `sell:${item.code}`;

    if (raw <= 4.5 && macdBearish) {
      const existing = state[key];
      const quote = quotes[item.code];

      // 已读状态：检查是否满足重新告警条件
      if (existing?.acknowledged) {
        const ackRating = existing.acknowledgedRating || 10;
        if (raw <= ackRating - 0.5 && macdBearish) {
          // 评分走低 + MACD卖出确认 → 重新告警
          const priceLine = quote
            ? `现价: ${quote.price.toFixed(2)} (${pctFmt(quote.changePercent)})`
            : "";
          const profitLine = quote && item.cost > 0
            ? `盈亏: ${((quote.price - item.cost) / item.cost * 100).toFixed(2)}% (成本 ${item.cost.toFixed(2)})`
            : "";
          const msg = [
            `🔴 *持仓股卖出信号升级*`,
            ``,
            `*${item.name}* (${item.code})`,
            priceLine,
            profitLine,
            `评分: ${fmtR(raw)}/10 (${signal.ratingLabel}) ⬇️ 从 ${fmtR(ackRating)} 降至 ${fmtR(raw)}`,
            `MACD: ${macdSignal} ← 卖出确认`,
            `RSI: ${signal.rsi?.value?.toFixed(1) || "-"}`,
            ``,
            `⬇️ 评分下降${fmtR(ackRating - raw)}，MACD确认卖出，注意风险`,
            ``,
            `回复「已读 ${item.code}」暂停提醒`,
          ].filter(Boolean).join("\n");
          await sendTelegram(msg);
          state[key] = { lastSentAt: now, acknowledged: false };
          triggered.push(key);
        }
        // 未满足重新告警条件，保持暂停
        continue;
      }

      // 正常告警（未已读）
      if (!existing || (now - existing.lastSentAt >= RESEND_INTERVAL)) {
        const priceLine = quote
          ? `现价: ${quote.price.toFixed(2)} (${pctFmt(quote.changePercent)})`
          : "";
        const profitLine = quote && item.cost > 0
          ? `盈亏: ${((quote.price - item.cost) / item.cost * 100).toFixed(2)}% (成本 ${item.cost.toFixed(2)})`
          : "";
        const msg = [
          `🔴 *持仓股卖出信号*`,
          ``,
          `*${item.name}* (${item.code})`,
          priceLine,
          profitLine,
          `评分: ${fmtR(raw)}/10 (${signal.ratingLabel})`,
          `MACD: ${macdSignal}`,
          `RSI: ${signal.rsi?.value?.toFixed(1) || "-"}`,
          ``,
          `⬇️ 评分≤4 + MACD空头确认，注意卖出风险`,
          ``,
          `回复「已读 ${item.code}」暂停提醒`,
        ].filter(Boolean).join("\n");
        await sendTelegram(msg);
        state[key] = { lastSentAt: now, acknowledged: false };
        triggered.push(key);
      }
    } else {
      // 条件不再满足，只清除未已读的状态（保留已读标记防止重复告警）
      if (state[key] && !state[key].acknowledged) delete state[key];
    }
  }

  // 清理已不在备选/持仓中的残留告警
  const watchCodes = new Set(watchlist.map((w) => w.code));
  const holdCodes = new Set(holdings.map((h) => h.code));
  for (const key of Object.keys(state)) {
    if (key === "ratelimit") continue;
    const m = key.match(/^(buy|sell|chase):(.+)$/);
    if (!m) continue;
    const [, type, code] = m;
    if ((type === "buy" || type === "chase") && !watchCodes.has(code)) delete state[key];
    if (type === "sell" && !holdCodes.has(code)) delete state[key];
  }

  await saveAlertState(state);
  const total = watchlist.length + holdings.length;
  return NextResponse.json({ checked: total, triggered, time: new Date().toISOString() });
}
