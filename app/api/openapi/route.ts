import { openApiDocument } from '@/lib/api/openapi';

// The agent API's OpenAPI document (lib/api/openapi.ts), for Swagger UI on /api-docs and for code
// generators. Behind the owner's sign-in like every other route; an API key does not open it.
// APP_URL names the server; without it, the document's own origin.
export function GET() {
  return Response.json(openApiDocument(process.env.APP_URL || undefined));
}
