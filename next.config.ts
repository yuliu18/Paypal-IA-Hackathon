import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  /* config options here */
};

// The interface's language comes from i18n/request.ts (a cookie, no locale in the URL).
const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
