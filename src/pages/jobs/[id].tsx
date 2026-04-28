import Link from "next/link";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Clock, Cpu, RefreshCw, XCircle } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { CopyButton } from "@/components/PagePrimitives";
import { getApiUrl } from "@/config/api";

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
  const response = await fetch(getApiUrl(`/jobs/${encodeURIComponent(id)}`));
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? "Job not found" : "Failed to fetch job",
    );
  }
  return response.json();
}

function formatDate(dateString: string | null): string {
  return dateString ? new Date(dateString).toLocaleString() : "Pending";
}

function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status.toLowerCase().replace("job_status_", "");
  const statusConfig: Record<
    string,
    { icon: JSX.Element | null; className: string }
  > = {
    completed: {
      icon: <CheckCircle className="h-3.5 w-3.5" />,
      className: "bg-green-100 text-green-800",
    },
    verified: {
      icon: <CheckCircle className="h-3.5 w-3.5" />,
      className: "bg-emerald-100 text-emerald-800",
    },
    pending: {
      icon: <Clock className="h-3.5 w-3.5" />,
      className: "bg-yellow-100 text-yellow-800",
    },
    computing: {
      icon: <Cpu className="h-3.5 w-3.5" />,
      className: "bg-blue-100 text-blue-800",
    },
    failed: {
      icon: <XCircle className="h-3.5 w-3.5" />,
      className: "bg-red-100 text-red-800",
    },
  };

  const config = statusConfig[normalizedStatus] || {
    icon: null,
    className: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      {config.icon}
      {normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
    </span>
  );
}

function DetailRow({
  label,
  value,
  copyValue,
  mono = false,
}: {
  label: string;
  value: string;
  copyValue?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <div className="mt-2 flex items-start gap-2">
        <p
          className={`break-all text-sm text-gray-900 ${mono ? "font-mono" : ""}`}
        >
          {value}
        </p>
        {copyValue ? (
          <CopyButton text={copyValue} stopPropagation={false} />
        ) : null}
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  const router = useRouter();
  const jobId = typeof router.query.id === "string" ? router.query.id : "";

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["job-detail", jobId],
    enabled: Boolean(jobId),
    queryFn: () => fetchJob(jobId),
  });

  return (
    <>
      <SEOHead
        title={jobId ? `Job ${jobId}` : "Job Detail"}
        description="Inspect the live metadata and execution status for a Cruzible AI verification job."
        path={jobId ? `/jobs/${encodeURIComponent(jobId)}` : "/jobs"}
      />

      <div className="min-h-screen bg-gray-50">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <Link
                href="/jobs"
                className="text-indigo-600 hover:text-indigo-700"
              >
                ← Back to Jobs
              </Link>
              <h1 className="text-xl font-bold text-gray-900">Job Detail</h1>
            </div>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {isLoading ? (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500">
              Loading job details...
            </div>
          ) : error || !data ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-8">
              <h2 className="text-lg font-semibold text-red-900">
                Job unavailable
              </h2>
              <p className="mt-2 text-sm text-red-700">
                {error instanceof Error
                  ? error.message
                  : "The requested job could not be loaded."}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">
                      Cruzible Job
                    </p>
                    <h2 className="mt-2 break-all font-mono text-2xl font-bold text-gray-900">
                      {data.id}
                    </h2>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <StatusBadge status={data.status} />
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        Priority {data.priority}
                      </span>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        {data.proofType.replace("PROOF_TYPE_", "")}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                      Timeline
                    </p>
                    <p className="mt-2 text-sm text-gray-900">
                      Created: {formatDate(data.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-gray-900">
                      Completed: {formatDate(data.completedAt)}
                    </p>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <DetailRow
                  label="Creator"
                  value={data.creator}
                  copyValue={data.creator}
                  mono
                />
                <DetailRow
                  label="Assigned Validator"
                  value={data.validatorAddress || "Not yet assigned"}
                  copyValue={data.validatorAddress || undefined}
                  mono
                />
                <DetailRow
                  label="Input Hash"
                  value={data.inputHash}
                  copyValue={data.inputHash}
                  mono
                />
                <DetailRow
                  label="Output Hash"
                  value={data.outputHash || "Not yet available"}
                  copyValue={data.outputHash || undefined}
                  mono
                />
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      Model linkage
                    </h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Navigate to the registered model hash associated with this
                      job.
                    </p>
                  </div>
                  <Link
                    href={`/models/${encodeURIComponent(data.modelHash)}`}
                    className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    Open model detail
                  </Link>
                </div>
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Model Hash
                  </p>
                  <div className="mt-2 flex items-start gap-2">
                    <p className="break-all font-mono text-sm text-gray-900">
                      {data.modelHash}
                    </p>
                    <CopyButton text={data.modelHash} stopPropagation={false} />
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
