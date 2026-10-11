import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "sandstone — Minecraft Bedrock commissions",
  description: "Custom Minecraft Bedrock scripting, behaviour packs and asset implementation. Share your idea and build something playable.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
