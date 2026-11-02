import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

/** "1.1.0" -> "1.01": the minor number is the small bump, shown as two digits. */
function appVersion(v: string) {
  const [major, minor] = v.split(".");
  return `${major}.${minor.padStart(2, "0")}`;
}

const nextConfig: NextConfig = {
  // yahoo-finance2 is used server-side only; keep it out of the bundle.
  serverExternalPackages: ["yahoo-finance2"],
  // Shown in the footer as v1.00, v1.01, ... v2.00; bump with `npm run bump:small` or `bump:big`.
  env: { NEXT_PUBLIC_APP_VERSION: appVersion(pkg.version) },
  devIndicators: false, // keeps the dev "N" badge out of README screenshots
};

export default nextConfig;
