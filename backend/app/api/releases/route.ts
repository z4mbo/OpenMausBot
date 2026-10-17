import { releases } from "@/lib/releases";

export function GET() {
  return Response.json(releases, { headers: { "Cache-Control": "no-store" } });
}
