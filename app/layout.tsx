import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Amazon Rank Tracker',
  description: 'Track Amazon.in keyword rankings for ASINs - Organic and Sponsored positions',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">
        {children}
      </body>
    </html>
  );
}
