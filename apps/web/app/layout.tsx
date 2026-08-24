import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Tally — Reconciliation Control Room",
  description: "Bank-to-books reconciliation dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
