export interface Holding {
  code: string;
  name: string;
  note?: string;
  cost: number;
  quantity: number;
  market: "sh" | "sz" | "bj" | "hk";
}

export interface HoldingWithPrice extends Holding {
  currentPrice: number;
  change: number;
  changePercent: number;
  marketValue: number;
  totalCost: number;
  profit: number;
  profitPercent: number;
}

export interface Signal {
  date: string;
  type: "buy" | "sell" | "warning";
  price: number;
  text: string;
}

// 默认持仓数据（后续可通过 API 修改）
export const defaultHoldings: Holding[] = [
  { code: "600519", name: "贵州茅台", cost: 1680.00, quantity: 100, market: "sh" },
  { code: "000858", name: "五粮液", cost: 145.50, quantity: 500, market: "sz" },
  { code: "300750", name: "宁德时代", cost: 210.00, quantity: 200, market: "sz" },
];

export interface WatchItem {
  code: string;
  name: string;
  note?: string;
  market: "sh" | "sz" | "bj" | "hk";
}

export const defaultWatchlist: WatchItem[] = [];

export function getFullCode(holding: Holding): string {
  return holding.market === "sh" ? `sh${holding.code}` : `sz${holding.code}`;
}
