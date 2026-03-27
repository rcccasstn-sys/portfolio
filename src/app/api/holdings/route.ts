import { NextRequest, NextResponse } from "next/server";
import { getHoldings, saveHoldings } from "@/lib/store";
import { Holding } from "@/lib/holdings";

export async function GET() {
  const holdings = getHoldings();
  return NextResponse.json(holdings);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, holding } = body as { action: string; holding?: Holding };

  const holdings = getHoldings();

  if (action === "add" && holding) {
    holdings.push(holding);
    saveHoldings(holdings);
    return NextResponse.json({ ok: true, holdings });
  }

  if (action === "remove" && holding) {
    const filtered = holdings.filter((h) => h.code !== holding.code);
    saveHoldings(filtered);
    return NextResponse.json({ ok: true, holdings: filtered });
  }

  if (action === "update" && holding) {
    const idx = holdings.findIndex((h) => h.code === holding.code);
    if (idx >= 0) holdings[idx] = holding;
    saveHoldings(holdings);
    return NextResponse.json({ ok: true, holdings });
  }

  if (action === "replace") {
    const newHoldings = body.holdings as Holding[];
    saveHoldings(newHoldings);
    return NextResponse.json({ ok: true, holdings: newHoldings });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
