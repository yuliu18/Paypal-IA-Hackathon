import type { Metadata } from "next";
import { Geist_Mono, Schibsted_Grotesk } from "next/font/google";
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

export const metadata: Metadata = {
  title: {
    template: "%s · Payment Guard",
    default: "Payment Guard",
  },
  description: "A firewall between a shop's AI agents and its PayPal account: every payment call is checked, held for a person or stopped.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${geistMono.variable} h-full antialiased`}
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
