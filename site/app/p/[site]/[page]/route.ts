import { relayPage } from "../../../../lib/pages-proxy";

type Context = { params: Promise<{ site: string; page: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  return relayPage(request, await context.params, process.env);
}

export async function POST(request: Request, context: Context) {
  return relayPage(request, await context.params, process.env);
}
