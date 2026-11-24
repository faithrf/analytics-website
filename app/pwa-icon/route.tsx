import { iconImage } from "./icon-image";

export function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const size = params.get("size") === "192" ? 192 : 512;
  return iconImage(size, params.get("pad") === "1");
}
