import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./components/AuthProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Live Polls | QR Voting Platform",
  description: "Create real-time polling sessions with unique QR codes for your events",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.className} h-full`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="min-h-full bg-gray-50 text-gray-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
