import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import {
  downloadTextFile,
  fetchLiveReconciliation,
  renderLiveReconciliationMarkdown,
  type LiveReconciliationDocument,
} from "@/lib/reconciliation";

export default function ReconciliationPage() {
  const { data, isLoading, isFetching, error, refetch } =
    useQuery<LiveReconciliationDocument>({
      queryKey: ["live-reconciliation-page"],
      queryFn: () => fetchLiveReconciliation(200),
      refetchInterval: 15000,
    });

  const warningCount = data?.warnings?.length ?? 0;
  const rawJson = useMemo(
    () => (data ? JSON.stringify(data, null, 2) : ""),
    [data],
  );
  const markdown = useMemo(
    () => (data ? renderLiveReconciliationMarkdown(data) : ""),
    [data],
  );

  return (
    <>
      <SEOHead
        title="Reconciliation"
        description="Live Cruzible reconciliation report for validator universe and stake or delegation snapshot state."
        path="/reconciliation"
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="reconciliation" />

        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">
                Cruzible Reconciliation
              </p>
              <h1 className="mt-2 text-3xl font-bold">Live Snapshot Report</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                Inspect the live validator universe and stake/delegation
                snapshot that the backend can derive from current chain and
                indexed state, then export the report as JSON or Markdown.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-cyan-400"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
              <button
                onClick={() =>
                  data &&
                  downloadTextFile("cruzible-live-reconciliation.json", rawJson)
                }
                disabled={!data}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileJson className="h-4 w-4" />
                Download JSON
              </button>
              <button
                onClick={() =>
                  data &&
                  downloadTextFile("cruzible-live-reconciliation.md", markdown)
                }
                disabled={!data}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                Download Markdown
              </button>
              <Link
                href="/devtools"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-slate-500"
              >
                Devtools
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard
              title="Epoch"
              value={data ? String(data.epoch) : "n/a"}
              tone="cyan"
            />
            <MetricCard
              title="Validators"
              value={String(
                data?.validator_selection?.meta?.validator_count ?? "n/a",
              )}
              tone="blue"
            />
            <MetricCard
              title="Included Stakers"
              value={String(
                data?.stake_snapshot?.meta?.included_stakers ?? "n/a",
              )}
              tone="green"
            />
            <MetricCard
              title="Warnings"
              value={String(warningCount)}
              tone={warningCount > 0 ? "amber" : "green"}
            />
          </div>

          {isLoading && !data ? (
            <Banner tone="neutral">
              Loading live reconciliation snapshot...
            </Banner>
          ) : null}

          {error instanceof Error && !data ? (
            <Banner tone="error">{error.message}</Banner>
          ) : null}

          {data ? (
            <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <section className="space-y-6">
                <Panel title="Snapshot Status">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MetricLine label="Network" value={data.network} />
                    <MetricLine label="Mode" value={data.mode} />
                    <MetricLine label="Captured At" value={data.captured_at} />
                    <MetricLine
                      label="Snapshot Completeness"
                      value={
                        data.stake_snapshot?.meta?.complete
                          ? "complete"
                          : "partial"
                      }
                      valueClassName={
                        data.stake_snapshot?.meta?.complete
                          ? "text-green-300"
                          : "text-amber-300"
                      }
                    />
                    <MetricLine
                      label="Included Shares"
                      value={
                        data.stake_snapshot?.meta?.included_total_shares ??
                        "n/a"
                      }
                    />
                    <MetricLine
                      label="Vault Total Shares"
                      value={
                        data.stake_snapshot?.meta?.vault_total_shares ?? "n/a"
                      }
                    />
                  </div>
                </Panel>

                <Panel title="Observed Hashes">
                  <div className="space-y-3">
                    <HashRow
                      label="Universe Hash"
                      value={data.validator_selection?.observed?.universe_hash}
                    />
                    <HashRow
                      label="Stake Snapshot Hash"
                      value={data.stake_snapshot?.observed?.stake_snapshot_hash}
                    />
                    <HashRow
                      label="Staker Registry Root"
                      value={
                        data.stake_snapshot?.observed?.staker_registry_root
                      }
                    />
                    <HashRow
                      label="Delegation Registry Root"
                      value={
                        data.stake_snapshot?.observed?.delegation_registry_root
                      }
                    />
                    <HashRow
                      label="Delegation Payload"
                      value={
                        data.stake_snapshot?.observed?.delegation_payload_hex
                      }
                    />
                  </div>
                </Panel>

                <Panel title="Source Metadata">
                  <div className="space-y-2">
                    {Object.entries(data.source ?? {}).map(([key, value]) => (
                      <MetricLine key={key} label={key} value={String(value)} />
                    ))}
                  </div>
                </Panel>
              </section>

              <section className="space-y-6">
                <Panel title="Warnings">
                  {warningCount > 0 ? (
                    <ul className="space-y-2">
                      {data.warnings?.map((warning) => (
                        <li
                          key={warning}
                          className="rounded-md border border-amber-900 bg-amber-950/30 px-3 py-3 text-sm text-amber-100"
                        >
                          {warning}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-md border border-green-900 bg-green-950/30 px-3 py-3 text-sm text-green-200">
                      No live snapshot warnings were returned.
                    </div>
                  )}
                </Panel>

                <Panel title="Export Preview">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                        <Download className="h-4 w-4 text-cyan-300" />
                        Markdown
                      </div>
                      <pre className="max-h-[28rem] overflow-auto rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200">
                        {markdown}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                        <Download className="h-4 w-4 text-cyan-300" />
                        JSON
                      </div>
                      <pre className="max-h-[28rem] overflow-auto rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200">
                        {rawJson}
                      </pre>
                    </div>
                  </div>
                </Panel>
              </section>
            </div>
          ) : null}
        </div>

        <Footer />
      </div>
    </>
  );
}

function MetricCard({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: "cyan" | "blue" | "green" | "amber";
}) {
  const toneClass: Record<string, string> = {
    cyan: "from-cyan-500/20 to-cyan-900/20 text-cyan-200 border-cyan-900/50",
    blue: "from-blue-500/20 to-blue-900/20 text-blue-200 border-blue-900/50",
    green:
      "from-emerald-500/20 to-emerald-900/20 text-emerald-200 border-emerald-900/50",
    amber:
      "from-amber-500/20 to-amber-900/20 text-amber-200 border-amber-900/50",
  };

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br p-4 ${toneClass[tone]}`}
    >
      <div className="text-xs uppercase tracking-wide text-slate-300">
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function Banner({
  children,
  tone,
}: {
  children: string;
  tone: "neutral" | "error";
}) {
  if (tone === "error") {
    return (
      <div className="mt-6 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-200">
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4" />
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        {children}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-4 text-lg font-semibold">{title}</div>
      {children}
    </div>
  );
}

function MetricLine({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-sm text-slate-100 ${valueClassName ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function HashRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-all font-mono text-[11px] text-slate-200">
        {value ?? "n/a"}
      </div>
    </div>
  );
}
