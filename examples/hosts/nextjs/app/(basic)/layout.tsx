import type { ReactNode } from "react";
import { DROPLETS_PUBLIC_URL } from "@/lib/droplets";

export const metadata = { title: "Droplets in Next.js" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* The droplets entry client; it defines the droplet element. */}
        <script type="module" src={`${DROPLETS_PUBLIC_URL}/index.js`} />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f8fafc", margin: 0, padding: "2rem" }}>
        {children}
      </body>
    </html>
  );
}
