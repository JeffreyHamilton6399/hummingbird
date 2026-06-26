import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hummingbird — What's that song?",
  description:
    "Hum, sing, or describe a song you half-remember and Hummingbird tries to identify it. Like Shazam for your memory.",
  keywords: ["song identifier", "hummingbird", "what's that song", "music search", "lyrics finder"],
  authors: [{ name: "Jeffrey Hamilton" }],
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Hummingbird — What's that song?",
    description: "Hum, sing, or describe a song you half-remember.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Hummingbird — What's that song?",
    description: "Hum, sing, or describe a song you half-remember.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} font-sans antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
