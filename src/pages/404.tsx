import React from "react";
import Head from "next/head";
import Link from "next/link";
import { Home, ArrowLeft, Search } from "lucide-react";

export default function Custom404() {
  return (
    <>
      <Head>
        <title>404 — Page Not Found | Cruzible</title>
        <meta
          name="description"
          content="The page you're looking for doesn't exist."
        />
      </Head>
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        {/* Background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-brand-600/5 rounded-full blur-3xl" />
        </div>

        <div className="relative text-center max-w-lg">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1e1b5e] shadow-lg shadow-indigo-900/25 p-2">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                <path
                  d="M 62 83 L 25 79 L 25 21 L 68 21 L 46 48"
                  stroke="white"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </div>
          </div>

          {/* 404 Number */}
          <div className="text-8xl font-bold text-slate-800 mb-2 tracking-tighter">
            404
          </div>

          {/* Message */}
          <h1 className="text-2xl font-bold text-white mb-3">Page Not Found</h1>
          <p className="text-slate-400 mb-8 leading-relaxed">
            The page you&apos;re looking for doesn&apos;t exist on the Aethelred
            network. It may have been moved or the URL might be incorrect.
          </p>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              <Home className="w-4 h-4" />
              Back to Explorer
            </Link>
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-medium transition-colors border border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              <ArrowLeft className="w-4 h-4" />
              Go Back
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
