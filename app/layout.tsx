import "./globals.css";
import { fontVariables } from "./fonts";
import { Providers } from "./providers";

export const metadata = {
  title: "DeliveryOps",
  description:
    "The single source of truth for everything that happens to a customer after the deal closes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={fontVariables}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
