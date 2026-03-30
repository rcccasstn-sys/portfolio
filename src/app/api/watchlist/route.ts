import { NextRequest, NextResponse } from "next/server";
import { getWatchlist, saveWatchlist } from "@/lib/store";
import { WatchItem } from "@/lib/holdings";

export async function GET() {
  return NextResponse.json(await getWatchlist());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, item } = body as { action: string; item?: WatchItem };
  const list = await getWatchlist();

  if (action === "add" && item) {
    list.push(item);
    await saveWatchlist(list);
    return NextResponse.json({ ok: true, list });
  }

  if (action === "remove" && item) {
    const filtered = list.filter((w) => w.code !== item.code);
    await saveWatchlist(filtered);
    return NextResponse.json({ ok: true, list: filtered });
  }

  if (action === "update" && item) {
    const idx = list.findIndex((w) => w.code === item.code);
    if (idx >= 0) list[idx] = item;
    await saveWatchlist(list);
    return NextResponse.json({ ok: true, list });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
