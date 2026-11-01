import { getTranslations } from 'next-intl/server';

// Shown while an endpoint page waits for PayPal (list calls, then one detail call per record).
export default async function Loading() {
  const t = await getTranslations('guard');
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-pp-canvas font-paypal text-pp-muted" role="status">
      {t('loading')}
    </main>
  );
}
