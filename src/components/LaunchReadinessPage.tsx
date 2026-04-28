import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  FileCheck,
  ShieldCheck,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { GlassCard } from "@/components/PagePrimitives";

type LaunchGatedPage = "validators" | "governance";

interface LaunchReadinessPageProps {
  activePage: LaunchGatedPage;
  path: string;
  title: string;
  description: string;
  eyebrow: string;
  reasons: string[];
  nextSteps: string[];
}

export function LaunchReadinessPage({
  activePage,
  path,
  title,
  description,
  eyebrow,
  reasons,
  nextSteps,
}: LaunchReadinessPageProps) {
  return (
    <>
      <SEOHead title={title} description={description} path={path} />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage={activePage} />

        <main className="mx-auto max-w-6xl px-6 py-10">
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-amber-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              {eyebrow}
            </div>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-white">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              {description}
            </p>
          </div>

          <GlassCard className="mb-8 p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Intentionally gated for launch honesty
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">
                  This surface is not being presented as production-live until
                  its data sources, user actions, and operational proofs are
                  backed by real APIs and release gates. That keeps Cruzible
                  aligned with tier-1 audit expectations from day one.
                </p>
              </div>
            </div>
          </GlassCard>

          <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <GlassCard className="p-6">
              <h2 className="text-lg font-semibold text-white">
                Why this page is gated
              </h2>
              <div className="mt-4 space-y-3">
                {reasons.map((reason) => (
                  <div
                    key={reason}
                    className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm leading-6 text-slate-300"
                  >
                    {reason}
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="p-6">
              <h2 className="text-lg font-semibold text-white">
                What unlocks launch
              </h2>
              <div className="mt-4 space-y-3">
                {nextSteps.map((step) => (
                  <div
                    key={step}
                    className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm leading-6 text-slate-300"
                  >
                    {step}
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-3">
                <Link
                  href="/reconciliation"
                  className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                >
                  Review the live reconciliation report
                  <FileCheck className="h-4 w-4" />
                </Link>
                <Link
                  href="/devtools"
                  className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500"
                >
                  Inspect devtools and protocol diagnostics
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </GlassCard>
          </div>
        </main>

        <Footer />
      </div>
    </>
  );
}
