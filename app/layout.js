import { Montserrat, Orbitron } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./components/AuthProvider";

// Self-hosted via next/font rather than the reference's Google Fonts @import,
// which avoids a render-blocking request and the attendant layout shift.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-orbitron",
  display: "swap",
});

export const metadata = {
  title: "Live Polls | QR Voting Platform",
  description: "Create real-time polling sessions with unique QR codes for your events",
};

// viewport-fit=cover exposes the safe-area insets the assistant composer pads
// against; interactive-widget=resizes-content shrinks the layout viewport when
// a mobile keyboard opens, so the composer isn't left behind it.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${orbitron.variable} h-full`}
    >
      <body className="min-h-full bg-background text-foreground font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
