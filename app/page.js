// The public front page.
//
// Signed-in users never see it: middleware.ts sends them to /inbox, which is
// where the dashboard now lives. The markup is the marketing page in
// app/welcome-landing; this wraps it in the landing fonts (the same wrapper
// that page's own layout applies) so "/" and "/welcome-landing" render
// identically.

import { landingFonts } from "@/components/landing/fonts";
import WelcomeLanding from "./welcome-landing/page";

export { metadata } from "./welcome-landing/layout";

export default function HomePage() {
  return (
    <div className={`${landingFonts} landing font-body`}>
      <WelcomeLanding />
    </div>
  );
}
