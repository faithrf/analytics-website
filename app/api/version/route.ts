/** The deploy this server is running; static per build, so each deploy serves its own id. */
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID });
}
