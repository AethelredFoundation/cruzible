import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { NextPageContext } from 'next';

interface ErrorProps {
  statusCode?: number;
}

function ErrorPage({ statusCode }: ErrorProps) {
  const title = statusCode === 500
    ? 'Internal Server Error'
    : statusCode === 503
    ? 'Service Unavailable'
    : `Error ${statusCode || 'Unknown'}`;

  const description = statusCode === 500
    ? 'Something went wrong on our end. Our validators are investigating.'
    : statusCode === 503
    ? 'The network is temporarily unavailable. Please try again shortly.'
    : 'An unexpected error occurred while processing your request.';

  return (
    <>
      <Head>
        <title>{title} | Cruzible</title>
      </Head>
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-red-600/5 rounded-full blur-3xl" />
        </div>

        <div className="relative text-center max-w-lg">
          <div className="flex justify-center mb-8">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
          </div>

          {statusCode && (
            <div className="text-6xl font-bold text-slate-800 mb-2 tracking-tighter">{statusCode}</div>
          )}

          <h1 className="text-2xl font-bold text-white mb-3">{title}</h1>
          <p className="text-slate-400 mb-8 leading-relaxed">{description}</p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-medium transition-colors border border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Home className="w-4 h-4" />
              Back to Explorer
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? (err as any).statusCode : 404;
  return { statusCode };
};

export default ErrorPage;
