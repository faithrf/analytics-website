import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yahoo-finance2 is used server-side only; keep it out of the bundle.
  serverExternalPackages: ["yahoo-finance2"],
  devIndicators: false, // keeps the dev "N" badge out of README screenshots
};

export default nextConfig;
