const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

export async function sendTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text,
          parse_mode: "Markdown",
        }),
      }
    );
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    date: number;
  };
}

export async function getUpdates(offset: number): Promise<TelegramUpdate[]> {
  if (!BOT_TOKEN) return [];
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=0`
    );
    const data = await res.json();
    if (!data.ok) return [];
    return (data.result || []).filter(
      (u: TelegramUpdate) => u.message && String(u.message.chat.id) === CHAT_ID
    );
  } catch {
    return [];
  }
}
