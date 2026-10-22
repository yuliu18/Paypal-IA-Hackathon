import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppNav } from "./app-nav";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s · Payment Guard",
    default: "Payment Guard",
  },
  description: "An AI support agent for PayPal refunds, behind a payment guard the business configures",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">
        {/* The frame fills the window exactly and pages scroll inside it, so popups that libraries
            append to <body> can never stretch the page and leave a gap below the menu. */}
        <div className="flex h-dvh flex-col md:flex-row">
          <AppNav />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
        </div>
      </body>
    </html>
  );
}
