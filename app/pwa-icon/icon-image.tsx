import { ImageResponse } from "next/og";

const svg = (rounded: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${rounded ? 7 : 0}" fill="#0b1a3a"/><path d="M6 24h20" stroke="#2c4a80" stroke-width="2" stroke-linecap="round"/><path d="M6 20l6-6 5 4 9-9" fill="none" stroke="#4f8cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 9h6v6" fill="none" stroke="#4f8cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** PNG app icon. `pad` shrinks the glyph into the safe zone for maskable icons. */
export function iconImage(size: number, pad = false) {
  const inner = pad ? Math.round(size * 0.7) : size;
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(svg(!pad))}`;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1a3a" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={inner} height={inner} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}
