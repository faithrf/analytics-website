import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meridian",
    short_name: "Meridian",
    description: "Market dashboard: indices, movers, sectors, charts and models.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1a3a",
    theme_color: "#0b1a3a",
    icons: [
      { src: "/pwa-icon?size=192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon?size=512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon?size=512&pad=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
