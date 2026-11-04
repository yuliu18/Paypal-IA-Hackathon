import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { apiKeys } from '@/lib/apikeys/keys';
import { settingsView } from '@/lib/settings/settings';
import { ApiKeysSection, type ApiKeysView } from '../settings/api-keys-section';
import { SwaggerUi } from './swagger-ui';

// The API keys for their section: none without DATABASE_URL; an unreachable database only greys
// out that section, never the page.
async function apiKeysView(): Promise<ApiKeysView> {
  try {
    const listed = await (await apiKeys()).list();
    return listed.ok ? { state: 'ready', keys: listed.keys } : { state: 'unavailable' };
  } catch (error) {
    console.error('The API keys could not be read', error);
    return { state: 'unreadable' };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('apiDocs.title') };
}

// The agent API for a shop's own app (lib/api/openapi.ts): the keys that open it, then the API in
// Swagger UI, so a developer can read it and try the endpoints with a key. The document itself is
// at /api/openapi.
export default async function ApiDocsPage() {
  await connection();
  const [t, keys, { locked }] = await Promise.all([getTranslations('nav'), apiKeysView(), settingsView()]);
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 font-paypal text-pp-ink md:px-8">
      <h1 className="text-2xl font-semibold">{t('apiDocs.title')}</h1>
      <p className="mt-2 max-w-3xl text-sm text-pp-muted">{t('apiDocs.intro')}</p>
      <div className="mt-6">
        <ApiKeysSection hidden={false} view={keys} locked={locked} />
      </div>
      <h2 className="mt-8 text-lg font-semibold">{t('apiDocs.reference')}</h2>
      <a href="/api/openapi" download="payment-guard-openapi.json" className="mt-1 inline-block text-sm font-semibold text-pp-blue hover:underline">
        {t('apiDocs.download')}
      </a>
      <SwaggerUi url="/api/openapi" failed={t('apiDocs.failed')} />
    </main>
  );
}
