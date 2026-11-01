'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

// Swagger UI from jsDelivr, pinned and checked with Subresource Integrity, so the app needs no
// dependency for one page. A new version needs its new hashes:
//   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
const VERSION = '5.33.3';
const BASE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${VERSION}`;
const SCRIPT_SRI = 'sha384-h00llMzD1afyNow1pDmnZKlHsUZgp9KE9HXLFXF2CvbwsBY0+WBO4f75SfGwvM4K';
const STYLE_SRI = 'sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW';

type SwaggerUIBundle = (options: Record<string, unknown>) => unknown;
declare global {
  interface Window {
    SwaggerUIBundle?: SwaggerUIBundle;
  }
}

export function SwaggerUi({ url, failed }: { url: string; failed: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(() => (typeof window !== 'undefined' && window.SwaggerUIBundle ? 'ready' : 'loading'));

  useEffect(() => {
    if (state !== 'ready' || !target.current || !window.SwaggerUIBundle) return;
    // Same-origin "Try it out" calls carry the owner's session; Authorize adds a bearer API key.
    window.SwaggerUIBundle({ url, domNode: target.current, deepLinking: true, persistAuthorization: false, tryItOutEnabled: false });
  }, [state, url]);

  return (
    <>
      <link rel="stylesheet" href={`${BASE}/swagger-ui.css`} integrity={STYLE_SRI} crossOrigin="anonymous" />
      <Script
        src={`${BASE}/swagger-ui-bundle.js`}
        integrity={SCRIPT_SRI}
        crossOrigin="anonymous"
        strategy="afterInteractive"
        onReady={() => setState('ready')}
        onError={() => setState('failed')}
      />
      {state === 'failed' && <p className="mt-6 rounded-md border border-pp-border bg-pp-canvas px-4 py-3 text-sm text-pp-muted">{failed}</p>}
      <div ref={target} className="mt-6 rounded-lg border border-pp-border bg-white" />
    </>
  );
}
