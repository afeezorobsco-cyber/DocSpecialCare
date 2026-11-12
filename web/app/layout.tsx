import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@near-wallet-selector/modal-ui/styles.css";
import { SessionProvider } from "@/components/session";

const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-geist-sans", weight: "100 900" });
const geistMono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-geist-mono", weight: "100 900" });

export const metadata: Metadata = {
  title: "DocSpecialCare: see a doctor without the queue",
  description:
    "Online consultations, specialist referrals, lab results and prescriptions, with escrowed payments and patient-controlled encrypted records on NEAR.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} bg-slate-50 font-sans text-slate-900 antialiased`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
