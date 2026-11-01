import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SwaggerUi } from './swagger-ui';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('apiDocs.title') };
}

// The agent API for a shop's own app (lib/api/openapi.ts), in Swagger UI, so a developer can read
// it and try the endpoints with an API key. The document itself is at /api/openapi.
export default async function ApiDocsPage() {
  const t = await getTranslations('nav');
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 font-paypal text-pp-ink md:px-8">
      <h1 className="text-2xl font-semibold">{t('apiDocs.title')}</h1>
      <p className="mt-2 max-w-3xl text-sm text-pp-muted">{t('apiDocs.intro')}</p>
      <a href="/api/openapi" download="payment-guard-openapi.json" className="mt-3 inline-block text-sm font-semibold text-pp-blue hover:underline">
        {t('apiDocs.download')}
      </a>
      <SwaggerUi url="/api/openapi" failed={t('apiDocs.failed')} />
    </main>
  );
}
