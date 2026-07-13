import "./globals.css";
import { StoreProvider } from "@/lib/store";

export const metadata = {
  title: "CertFlow — Automated COI Issuance",
  description:
    "Trigger, auto-fill, review and distribute ACORD 25 Certificates of Insurance from your email + AMS data.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
