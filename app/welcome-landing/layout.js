import { landingFonts } from "@/components/landing/fonts";

export const metadata = {
  title: "CertFlow — ACORD 25 certificates, drafted from your records",
  description:
    "CertFlow reads certificate requests in your agency inbox, drafts the ACORD 25 from your own policy records, and waits for a person to review and send it.",
};

export default function WelcomeLayout({ children }) {
  return <div className={`${landingFonts} landing font-body`}>{children}</div>;
}
