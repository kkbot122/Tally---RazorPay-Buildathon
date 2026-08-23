import type { ReactNode } from "react";

export const metadata = {
  title: "Finance Reconciliation Agent",
  description: "Bank-to-books reconciliation dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
