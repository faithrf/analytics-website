import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Disclaimer and privacy - Meridian" };

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "Not financial advice",
    body: [
      "Everything on Meridian is general information only. It is not financial, investment, tax or legal advice, and it is not a recommendation to buy, sell or hold any security.",
      "Nothing here takes into account your objectives, financial situation or needs. Before making any investment decision, consider whether it is appropriate for you and speak to a licensed financial adviser.",
      "Meridian does not hold an Australian Financial Services Licence or any equivalent licence elsewhere.",
    ],
  },
  {
    title: "A hobby project",
    body: [
      "Meridian is a personal, non-commercial hobby project built for learning and experimentation. It is provided as is and as available, with no warranty of any kind, express or implied.",
      "It may be changed, broken, paused or shut down at any time without notice, and accounts and saved data may be removed.",
    ],
  },
  {
    title: "Data accuracy",
    body: [
      "Prices, charts, fundamentals, news and filings come from third-party sources, including unofficial Yahoo Finance data, SEC EDGAR and public STOCK Act disclosures. Quotes are delayed (typically ~20 minutes) and may be incomplete, out of date or wrong.",
      "Always check figures against an official source, such as your broker or the exchange, before relying on them. Past performance is not a reliable indicator of future performance.",
      "The trading simulator is for learning only. Option prices come from Yahoo Finance (delayed) when available and are otherwise estimated with a model, and results do not reflect real trading outcomes. Selling options can lose more than the premium collected, and sold calls have unlimited risk.",
      "Meridian is not affiliated with or endorsed by Yahoo, any exchange, any news publisher or any person named on the Leaders tab. Trademarks and headlines belong to their owners.",
    ],
  },
  {
    title: "Your responsibility",
    body: [
      "You use Meridian at your own risk. To the maximum extent permitted by law, Meridian and its author are not liable for any loss or damage, including trading or investment losses, arising from use of or reliance on the site or its data.",
      "Nothing here excludes any right you have under the Australian Consumer Law or other laws that cannot be excluded.",
    ],
  },
  {
    title: "Accounts and privacy",
    body: [
      "You can use Meridian without an account. If you sign up, Meridian stores your email address, optional display name, a salted hash of your password (never the password itself), your dashboards, the leaders you follow and your trading simulator (paper) trades.",
      "When you are logged in, Meridian records simple usage events such as logins, tabs viewed and stocks pinned. These may be sent to an analytics tool run by the author to test and improve the site. Your data is not sold or shared for advertising.",
      "The author can view and access accounts for testing and support. Don't use a password you use anywhere else, and don't store anything sensitive here.",
      "Data is held with the hosting providers (Vercel and Upstash). You can delete your account at any time from the account menu; this removes your account and saved data immediately.",
    ],
  },
  {
    title: "Cookies and local storage",
    body: [
      "Meridian sets one essential cookie to keep you logged in. Your browser's local storage keeps your theme and, when logged out, your dashboards and simulator trades. There are no advertising or third-party tracking cookies.",
    ],
  },
];

export default function LegalPage() {
  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Disclaimer, terms and privacy</h1>
        <p className="text-xs text-muted">By using Meridian you accept these terms. Last updated 2 November 2026.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.map((s) => (
          <section key={s.title} className="rounded-md border border-line bg-panel p-3">
            <h2 className="mb-1.5 text-sm font-semibold">{s.title}</h2>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted">
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Source code is open under the MIT licence.{" "}
        <Link href="/" className="text-accent hover:underline">
          Back to the market overview
        </Link>
      </p>
    </div>
  );
}
