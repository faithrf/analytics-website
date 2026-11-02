import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

const nextConfig: NextConfig = {
  // yahoo-finance2 is used server-side only; keep it out of the bundle.
  serverExternalPackages: ["yahoo-finance2"],
  // Shown in the footer as v<major>.<minor>; bump with `npm run bump:small` or `bump:big`.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version.split(".").slice(0, 2).join(".") },
  devIndicators: false, // keeps the dev "N" badge out of README screenshots
};

export default nextConfig;
