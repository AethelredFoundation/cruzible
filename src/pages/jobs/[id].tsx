import Link from "next/link";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Cpu,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { CopyButton, GlassCard } from "@/components/PagePrimitives";
import { Footer, TopNav } from "@/components/SharedComponents";
import { ApiHttpError, apiJson } from "@/lib/api-request";
import { getPublicErrorMessage } from "@/lib/publicErrors";

interface Job {
  id: string;
  status: string;
  modelHash: string;
  inputHash: string;
  outputHash: string | null;
  creator: string;
  proofType: string;
  priority: number;
  createdAt: string;
  completedAt: string | null;
  validatorAddress: string | null;
}

async function fetchJob(id: string): Promise<Job> {
  try {
    return await apiJson<Job>(`/jobs/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiHttpError && error.statusCode === 404) {
      throw new Error("Job not found");
    }

    throw new Error(getPublicErrorMessage(error, "Failed to fetch job"));
  }
}

function normalizeJobStatus(status: string): string {
  return status.toLowerCase().replace("job_status_", "");
}

function formatJobStatus(status: string): string {
  const normalized = normalizeJobStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatProofType(proofType: string): string {
  return proofType
    .replace("PROOF_TYPE_", "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateString));
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = normalizeJobStatus(status);
  const statusConfig: Record<string, { icon: JSX.Element; className: string }> =
    {
      completed: {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
      },
      verified: {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
      },
      pending: {
        icon: <Clock3 className="h-3.5 w-3.5" />,
        className: "border-amber-500/20 bg-amber-500/10 text-amber-200",
      },
      computing: {
        icon: <Cpu className="h-3.5 w-3.5" />,
        className: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
      },
      failed: {
        icon: <XCircle className="h-3.5 w-3.5" />,
        className: "border-rose-500/20 bg-rose-500/10 text-rose-200",
      },
    };
  const config = statusConfig[normalizedStatus] ?? {
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    className: "border-slate-700 bg-slate-800 text-slate-200",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {formatJobStatus(status)}
    </span>
  );
}

function DetailRow({
  label,
  value,
  copyValue,
}: {
  label: string;
  value: string;
  copyValue?: string;
}) {
  return (
    <GlassCard hover={false} className="p-4">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-start gap-2">
        <p className="break-all font-mono text-sm text-slate-200">{value}</p>
        {copyValue ? (
          <CopyButton text={copyValue} stopPropagation={false} />
        ) : null}
      </div>
    </GlassCard>
  );
}

export default function JobDetailPage() {
  const router = useRouter();
  const jobId = typeof router.query.id === "string" ? router.query.id : "";

  const jobQuery = useQuery({
    queryKey: ["job-detail", jobId],
    enabled: Boolean(jobId),
    queryFn: () => fetchJob(jobId),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const job = jobQuery.data;
  const errorMessage = getPublicErrorMessage(
    jobQuery.error,
    "The requested job could not be loaded.",
  );

  return (
    <>
      <SEOHead
        title={jobId ? `Job ${jobId}` : "Job Detail"}
        description="Inspect live metadata and execution status for a Cruzible verification job."
        path={jobId ? `/jobs/${encodeURIComponent(jobId)}` : "/jobs"}
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="explorer" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <section className="mb-8 rounded-[32px] border border-slate-800 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(220,38,38,0.12),_transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-8 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <Link
                  href="/jobs"
                  className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 hover:text-cyan-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to jobs
                </Link>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Live job detail
                </div>
                <h1 className="mt-4 text-4xl font-bold tracking-tight text-white lg:text-5xl">
                  Job Detail
                </h1>
                <p className="mt-4 break-all font-mono text-sm leading-7 text-slate-300">
                  {jobId || "Waiting for route parameter"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => jobQuery.refetch()}
                disabled={!jobId}
                className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${jobQuery.isFetching ? "animate-spin" : ""}`}
                />
                Refresh detail
              </button>
            </div>
          </section>

          {jobQuery.isLoading ? (
            <GlassCard className="px-6 py-14 text-center">
              <RefreshCw className="mx-auto h-6 w-6 animate-spin text-cyan-300" />
              <p className="mt-3 text-sm text-slate-400">
                Loading live job detail...
              </p>
            </GlassCard>
          ) : jobQuery.isError || !job ? (
            <GlassCard className="px-6 py-14 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-amber-300" />
              <h2 className="mt-4 text-lg font-semibold text-white">
                Job unavailable
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
                {errorMessage}
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-6">
              <GlassCard className="p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Cruzible job
                    </p>
                    <h2 className="mt-2 break-all font-mono text-2xl font-bold text-white">
                      {job.id}
                    </h2>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <StatusBadge status={job.status} />
                      <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs font-medium text-slate-300">
                        Priority {job.priority}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs font-medium text-slate-300">
                        {formatProofType(job.proofType)}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Timeline
                    </p>
                    <p className="mt-2 text-sm text-slate-300">
                      Created: {formatDate(job.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      Completed: {formatDate(job.completedAt)}
                    </p>
                  </div>
                </div>
              </GlassCard>

              <section className="grid gap-4 md:grid-cols-2">
                <DetailRow
                  label="Creator"
                  value={job.creator}
                  copyValue={job.creator}
                />
                <DetailRow
                  label="Assigned validator"
                  value={job.validatorAddress || "Not yet assigned"}
                  copyValue={job.validatorAddress || undefined}
                />
                <DetailRow
                  label="Input hash"
                  value={job.inputHash}
                  copyValue={job.inputHash}
                />
                <DetailRow
                  label="Output hash"
                  value={job.outputHash || "Not yet available"}
                  copyValue={job.outputHash || undefined}
                />
              </section>

              <GlassCard className="p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      Model linkage
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      Navigate to the registered model hash associated with this
                      job. The hash below is copied directly from the live job
                      response.
                    </p>
                  </div>
                  <Link
                    href={`/models/${encodeURIComponent(job.modelHash)}`}
                    className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                  >
                    Open model detail
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </div>
                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                    Model hash
                  </p>
                  <div className="mt-2 flex items-start gap-2">
                    <p className="break-all font-mono text-sm text-slate-200">
                      {job.modelHash}
                    </p>
                    <CopyButton text={job.modelHash} stopPropagation={false} />
                  </div>
                </div>
              </GlassCard>
            </div>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}
