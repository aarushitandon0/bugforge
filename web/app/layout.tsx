import type { Metadata, Viewport } from "next";
// The four weights the type scale names, and no others.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import { THEME_BOOT } from "@/lib/theme-boot";

export const metadata: Metadata = {
  title: { default: "BugForge", template: "%s · BugForge" },
  description:
    "Every repo is a debugging gym. Real bugs in real open-source repos, real stack traces, graded by the repo's own test suite.",
};

export const viewport: Viewport = {
  themeColor: "#14101b",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * suppressHydrationWarning is required, not cosmetic: THEME_BOOT rewrites
     * data-theme before React hydrates, so for any viewer whose theme is not
     * the SSR default the attribute on <html> legitimately differs from what
     * the server sent. This is the documented pattern for a pre-paint theme
     * script, and it suppresses only this one element's attribute check.
     */
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* before first paint, so a light viewer never sees a dark flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
