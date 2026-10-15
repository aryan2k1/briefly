import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Briefly · Relationship intelligence",
  description:
    "A local synthetic CRM foundation with linked relationship records.",
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
