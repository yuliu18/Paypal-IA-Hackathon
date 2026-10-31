import type { Metadata } from "next";
import { Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import { AppNav } from "./app-nav";

// The interface's one typeface; Geist Mono is kept for PayPal ids.
const ui = Schibsted_Grotesk({
  variable: "--font-ui",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: {
      template: "%s · Payment Guard",
      default: "Payment Guard",
    },
    description: t("appDescription"),
  };
}

// The language is the browser's choice on /settings (i18n/request.ts); client components get its
// messages through the provider.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${ui.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">
        {/* The frame fills the window exactly and pages scroll inside it, so popups that libraries
            append to <body> can never stretch the page and leave a gap below the menu. */}
        <NextIntlClientProvider>
          <div className="flex h-dvh flex-col md:flex-row">
            <AppNav />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
