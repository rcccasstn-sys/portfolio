import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "持仓管理",
  description: "实时持仓收益追踪",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
