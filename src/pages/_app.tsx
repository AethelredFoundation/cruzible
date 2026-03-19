/**
 * Aethelred Dashboard - Next.js App Component
 *
 * Wraps every page with:
 *   1. WagmiProvider — real wallet connection (MetaMask, WalletConnect, Coinbase)
 *   2. React Query — data fetching cache
 *   3. AppProvider — global state (wallet, notifications, search)
 *   4. Toast notifications and Cmd+K search overlay
 */

import type { AppProps } from "next/app";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/config/wagmi";
import { AppProvider, useApp } from "@/contexts/AppContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer, SearchOverlay } from "@/components/SharedComponents";
import "../styles/globals.css";

function AppInner({ Component, pageProps }: AppProps) {
  const { setSearchOpen } = useApp();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSearchOpen]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>
      <ErrorBoundary>
        <Component {...pageProps} />
      </ErrorBoundary>
      <ToastContainer />
      <SearchOverlay />
    </>
  );
}

export default function App(props: AppProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <AppInner {...props} />
        </AppProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
