// Read-only system query used by the installed Convex CLI's tables tool.
// A matching production deploy key is required; never log the key or log in.
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

const key = process.env.CONVEX_DEPLOY_KEY;
if (!key?.startsWith('prod:example-deployment|')) throw new Error('Matching production deploy key required');
const client = new ConvexHttpClient('http://localhost:3210');
client.setAdminAuth(key);
try {
  const result = await client.query(makeFunctionReference('_system/frontend/getSchemas'), {});
  if (!result.active) throw new Error('No active production schema returned');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch {
  console.error('Production schema read failed; no secret or backend error body emitted');
  process.exitCode = 1;
}
