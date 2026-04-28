import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Workflow,
  XCircle,
} from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Footer, TopNav } from "@/components/SharedComponents";
import { CopyButton, GlassCard } from "@/components/PagePrimitives";
import {
  fetchSeal,
  fetchSeals,
  formatRelativeTime,
  formatTimestamp,
  getSealCommitmentCoverage,
  getSealLineageCompleteness,
  shortenHash,
  type SealDetailRecord,
  type SealLifecycleStatus,
} from "@/lib/seals";

function getStatusClasses(status: SealLifecycleStatus): string {
  const classes: Record<SealLifecycleStatus, string> = {
    active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    revoked: "border-rose-500/20 bg-rose-500/10 text-rose-200",
    expired: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    superseded: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    unknown: "border-slate-700 bg-slate-800 text-slate-200",
  };

  return classes[status];
}

function StatusPill({ status }: { status: SealLifecycleStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getStatusClasses(
        status,
      )}`}
    >
      {status}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <GlassCard className="p-5">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-bold text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
    </GlassCard>
  );
}

function ValueRow({
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p
          className={`min-w-0 break-all text-sm text-white ${
            mono ? "font-mono" : ""
          }`}
        >
          {value || "Not provided"}
        </p>
        {copyValue ? (
          <CopyButton text={copyValue} stopPropagation={false} />
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2 leading-6">{detail}</p>
    </div>
  );
}

function getRevocationValue(seal: SealDetailRecord): {
  value: string;
  detail: string;
} {
  if (seal.revokedAt) {
    return {
      value: "Revoked",
      detail: `Recorded ${formatTimestamp(seal.revokedAt)}`,
    };
  }

  if (seal.status === "superseded") {
    return {
      value: "Superseded",
      detail: "Lifecycle ended through seal replacement.",
    };
  }

  if (seal.status === "expired") {
    return {
      value: "Expired",
      detail: seal.expiresAt
        ? `Expired ${formatTimestamp(seal.expiresAt)}`
        : "Seal reached an expired status in the registry.",
    };
  }

  return {
    value: "Live",
    detail: "No revocation metadata is currently attached to this seal.",
  };
}

export default function SealDetailPage() {
  const router = useRouter();
  const sealId = typeof router.query.id === "string" ? router.query.id : "";

  const sealQuery = useQuery({
    queryKey: ["seal-detail", sealId],
    enabled: Boolean(sealId),
    queryFn: () => fetchSeal(sealId),
    refetchInterval: 30000,
  });

  const relatedSealsQuery = useQuery({
    queryKey: ["seal-related", sealQuery.data?.jobId],
    enabled: Boolean(sealQuery.data?.jobId),
    queryFn: () =>
      fetchSeals({
        limit: 12,
        jobId: sealQuery.data?.jobId,
        sort: "created_at:desc",
      }),
  });

  const siblingSeals = useMemo(
    () =>
      (relatedSealsQuery.data?.seals ?? []).filter(
        (seal) => seal.id !== sealId,
      ),
    [relatedSealsQuery.data?.seals, sealId],
  );

  const seal = sealQuery.data;
  const lineageCompleteness = seal ? getSealLineageCompleteness(seal) : 0;
  const commitmentCoverage = seal ? getSealCommitmentCoverage(seal) : 0;
  const revocationSummary = seal
    ? getRevocationValue(seal)
    : { value: "n/a", detail: "n/a" };
  const validatorParticipation = seal?.proofLineage
    ? `${seal.proofLineage.validatorSignatureCount}`
    : `${seal?.validators.length || seal?.validatorCount || 0}`;

  return (
    <>
      <SEOHead
        title={seal ? `Seal ${shortenHash(seal.id, 14, 10)}` : "Seal Detail"}
        description="Inspect a live Cruzible seal record with validator addresses, revocation metadata, proof lineage, and related job context."
        path={sealId ? `/seals/${encodeURIComponent(sealId)}` : "/seals"}
      />

      <div className="min-h-screen bg-slate-950 text-slate-100">
        <TopNav activePage="explorer" />

        <main className="mx-auto max-w-7xl px-6 py-10">
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link
                href="/seals"
                className="text-sm font-medium text-cyan-200 hover:text-cyan-100"
              >
                ← Back to seals
              </Link>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Seal proof surface
              </div>
              <h1 className="mt-4 text-4xl font-bold tracking-tight text-white">
                {seal ? shortenHash(seal.id, 18, 14) : "Seal detail"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
                Live proof context for a single seal record. This page prefers
                the first-class detail endpoint and falls back to a live
                registry lookup only when the detail endpoint is unavailable.
              </p>
            </div>

            <button
              onClick={() => {
                void sealQuery.refetch();
                void relatedSealsQuery.refetch();
              }}
              className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
            >
              Refresh
              <RefreshCw
                className={`ml-2 h-4 w-4 ${
                  sealQuery.isFetching || relatedSealsQuery.isFetching
                    ? "animate-spin"
                    : ""
                }`}
              />
            </button>
          </div>

          {sealQuery.isLoading ? (
            <GlassCard className="p-6 text-sm text-slate-400">
              Loading live seal detail...
            </GlassCard>
          ) : sealQuery.error || !seal ? (
            <GlassCard className="p-6 text-sm text-red-100">
              Seal detail is unavailable right now. This page will not render
              fabricated proof data.
            </GlassCard>
          ) : (
            <>
              {!seal.detailAvailable ? (
                <GlassCard className="mb-8 border-amber-500/20 bg-amber-500/10 p-5 text-sm text-amber-100">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-medium text-white">
                        Detail endpoint fallback in use
                      </p>
                      <p className="mt-2 leading-6 text-amber-100/90">
                        The page found this seal through the live list endpoint.
                        Validator addresses, revocation metadata, job context,
                        and proof lineage fields may remain empty until
                        <code className="mx-1 rounded bg-slate-900/60 px-1.5 py-0.5 text-xs text-cyan-100">
                          /v1/seals/:id
                        </code>
                        is available.
                      </p>
                    </div>
                  </div>
                </GlassCard>
              ) : null}

              <GlassCard className="mb-8 p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusPill status={seal.status} />
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                        {seal.validators.length || seal.validatorCount}{" "}
                        validators
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300">
                        Created {formatRelativeTime(seal.createdAt)}
                      </span>
                    </div>

                    <p className="mt-4 break-all font-mono text-sm text-slate-400">
                      {seal.id}
                    </p>
                    <div className="mt-3">
                      <CopyButton text={seal.id} stopPropagation={false} />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {seal.job?.id ? (
                      <Link
                        href={`/jobs/${encodeURIComponent(seal.job.id)}`}
                        className="inline-flex items-center justify-between rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/15"
                      >
                        Related job
                        <Workflow className="h-4 w-4" />
                      </Link>
                    ) : null}
                    <Link
                      href="/seals"
                      className="inline-flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:border-slate-500"
                    >
                      Explore seals
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </GlassCard>

              <section className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Validator Participation"
                  value={validatorParticipation}
                  detail="Validator addresses on the seal, or the signature count reported by proof lineage."
                />
                <MetricCard
                  label="Lineage Completeness"
                  value={`${lineageCompleteness}%`}
                  detail="Coverage across commitments, job linkage, validator set, and proof lineage anchors."
                />
                <MetricCard
                  label="Commitment Coverage"
                  value={`${commitmentCoverage}%`}
                  detail="Model, input, and output commitments present on this seal record."
                />
                <MetricCard
                  label="Revocation State"
                  value={revocationSummary.value}
                  detail={revocationSummary.detail}
                />
              </section>

              <section className="grid gap-6 lg:grid-cols-[1.35fr_0.95fr]">
                <div className="space-y-6">
                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Commitment Anchors
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Core registry fields
                    </h2>
                    <div className="mt-5 grid gap-4">
                      <ValueRow
                        label="Model commitment"
                        value={seal.modelCommitment}
                        copyValue={seal.modelCommitment}
                        mono
                      />
                      <ValueRow
                        label="Input commitment"
                        value={seal.inputCommitment}
                        copyValue={seal.inputCommitment}
                        mono
                      />
                      <ValueRow
                        label="Output commitment"
                        value={seal.outputCommitment}
                        copyValue={seal.outputCommitment}
                        mono
                      />
                      <div className="grid gap-4 md:grid-cols-2">
                        <ValueRow
                          label="Requester"
                          value={seal.requester}
                          copyValue={seal.requester}
                          mono
                        />
                        <ValueRow
                          label="Related job id"
                          value={seal.job?.id || seal.jobId || "Not provided"}
                          copyValue={seal.job?.id || seal.jobId}
                          mono
                        />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <ValueRow
                          label="Created"
                          value={formatTimestamp(seal.createdAt)}
                        />
                        <ValueRow
                          label="Expires"
                          value={
                            seal.expiresAt
                              ? formatTimestamp(seal.expiresAt)
                              : "No expiry"
                          }
                        />
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Validator Lineage
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Validators attached to this seal
                    </h2>

                    {seal.validators.length === 0 ? (
                      <div className="mt-5">
                        <EmptyState
                          title="No validator addresses were returned"
                          detail="When the detail endpoint provides validator addresses, they will appear here for direct inspection and cross-linking."
                        />
                      </div>
                    ) : (
                      <div className="mt-5 space-y-3">
                        {seal.validators.map((validatorAddress, index) => (
                          <div
                            key={`${validatorAddress}-${index}`}
                            className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                                Validator {index + 1}
                              </p>
                              <p className="mt-2 break-all font-mono text-sm text-white">
                                {validatorAddress}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <CopyButton
                                text={validatorAddress}
                                stopPropagation={false}
                              />
                              <Link
                                href={`/validators/${encodeURIComponent(
                                  validatorAddress,
                                )}`}
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-cyan-200 transition-colors hover:border-cyan-500/40 hover:text-cyan-100"
                              >
                                Open validator
                                <ArrowRight className="h-4 w-4" />
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Proof Lineage
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Verifier and TEE context
                    </h2>

                    {!seal.proofLineage ? (
                      <div className="mt-5">
                        <EmptyState
                          title="Proof lineage not returned"
                          detail="This seal record does not currently expose proof-lineage fields beyond its registry commitments."
                        />
                      </div>
                    ) : (
                      <>
                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                          <ValueRow
                            label="Proof type"
                            value={seal.proofLineage.proofType}
                          />
                          <ValueRow
                            label="Validator signatures"
                            value={String(
                              seal.proofLineage.validatorSignatureCount,
                            )}
                          />
                          <ValueRow
                            label="Merkle root"
                            value={seal.proofLineage.merkleRoot}
                            copyValue={seal.proofLineage.merkleRoot}
                            mono
                          />
                          <ValueRow
                            label="TEE measurement"
                            value={seal.proofLineage.teeMeasurement}
                            copyValue={seal.proofLineage.teeMeasurement}
                            mono
                          />
                          <ValueRow
                            label="TEE type"
                            value={seal.proofLineage.teeType}
                          />
                          <ValueRow
                            label="TEE timestamp"
                            value={formatTimestamp(
                              seal.proofLineage.teeTimestamp,
                            )}
                          />
                        </div>

                        {seal.proofLineage.computeMetrics ? (
                          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <MetricCard
                              label="CPU Cycles"
                              value={
                                seal.proofLineage.computeMetrics.cpuCycles ||
                                "n/a"
                              }
                              detail="Compute metrics returned by proof lineage."
                            />
                            <MetricCard
                              label="Memory Used"
                              value={
                                seal.proofLineage.computeMetrics.memoryUsed ||
                                "n/a"
                              }
                              detail="Memory footprint reported alongside the proof."
                            />
                            <MetricCard
                              label="Compute Time"
                              value={
                                seal.proofLineage.computeMetrics
                                  .computeTimeMs || "n/a"
                              }
                              detail="Milliseconds of measured compute time."
                            />
                            <MetricCard
                              label="Energy"
                              value={
                                seal.proofLineage.computeMetrics.energyMj ||
                                "n/a"
                              }
                              detail="Energy usage in megajoules when reported."
                            />
                          </div>
                        ) : null}
                      </>
                    )}
                  </GlassCard>
                </div>

                <div className="space-y-6">
                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Execution Linkage
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Related job context
                    </h2>

                    {!seal.job ? (
                      <div className="mt-5">
                        <EmptyState
                          title="No related job object returned"
                          detail="The API has not attached job context to this seal yet. The registry-level job id remains visible above."
                        />
                      </div>
                    ) : (
                      <div className="mt-5 space-y-4">
                        <div className="grid gap-4">
                          <ValueRow
                            label="Job id"
                            value={seal.job.id}
                            copyValue={seal.job.id}
                            mono
                          />
                          <div className="grid gap-4 md:grid-cols-2">
                            <ValueRow label="Status" value={seal.job.status} />
                            <ValueRow
                              label="Proof type"
                              value={seal.job.proofType}
                            />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <ValueRow
                              label="Model hash"
                              value={seal.job.modelHash}
                              copyValue={seal.job.modelHash}
                              mono
                            />
                            <ValueRow
                              label="Model name"
                              value={seal.job.modelName}
                            />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <ValueRow
                              label="Verification score"
                              value={seal.job.verificationScore}
                            />
                            <ValueRow
                              label="Output hash"
                              value={seal.job.outputHash}
                              copyValue={seal.job.outputHash}
                              mono
                            />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <ValueRow
                              label="Creator"
                              value={seal.job.creatorAddress}
                              copyValue={seal.job.creatorAddress}
                              mono
                            />
                            <ValueRow
                              label="Assigned validator"
                              value={seal.job.validatorAddress}
                              copyValue={seal.job.validatorAddress}
                              mono
                            />
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <ValueRow
                              label="Created"
                              value={formatTimestamp(seal.job.createdAt)}
                            />
                            <ValueRow
                              label="Completed"
                              value={formatTimestamp(seal.job.completedAt)}
                            />
                          </div>
                        </div>

                        <Link
                          href={`/jobs/${encodeURIComponent(seal.job.id)}`}
                          className="inline-flex items-center gap-2 text-sm font-medium text-cyan-200 hover:text-cyan-100"
                        >
                          Open related job
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    )}
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Revocation And Lifecycle
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Lifecycle events
                    </h2>

                    {seal.revokedAt ||
                    seal.revokedBy ||
                    seal.revocationReason ? (
                      <div className="mt-5 space-y-4">
                        <div className="inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-rose-200">
                          <XCircle className="h-3.5 w-3.5" />
                          Revocation metadata present
                        </div>
                        <ValueRow
                          label="Revoked at"
                          value={formatTimestamp(seal.revokedAt)}
                        />
                        <ValueRow
                          label="Revoked by"
                          value={seal.revokedBy}
                          copyValue={seal.revokedBy}
                          mono
                        />
                        <ValueRow
                          label="Reason"
                          value={seal.revocationReason}
                        />
                      </div>
                    ) : (
                      <div className="mt-5">
                        <EmptyState
                          title="No revocation fields returned"
                          detail="The registry does not currently show a revocation actor, timestamp, or reason for this seal."
                        />
                      </div>
                    )}
                  </GlassCard>

                  <GlassCard className="p-6">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                      Same Job Lineage
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-white">
                      Other seals tied to this job
                    </h2>

                    {relatedSealsQuery.isLoading ? (
                      <div className="mt-5 text-sm text-slate-400">
                        Loading sibling seal context...
                      </div>
                    ) : siblingSeals.length === 0 ? (
                      <div className="mt-5">
                        <EmptyState
                          title="No sibling seals found"
                          detail="The live registry did not return other seals for this job id."
                        />
                      </div>
                    ) : (
                      <div className="mt-5 space-y-3">
                        {siblingSeals.map((sibling) => (
                          <Link
                            key={sibling.id}
                            href={`/seals/${encodeURIComponent(sibling.id)}`}
                            className="block rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 transition-colors hover:border-cyan-500/30"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="font-mono text-sm text-white">
                                  {shortenHash(sibling.id, 14, 10)}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {sibling.status} • created{" "}
                                  {formatRelativeTime(sibling.createdAt)}
                                </p>
                              </div>
                              <ArrowRight className="h-4 w-4 text-slate-500" />
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </GlassCard>

                  <GlassCard className="p-6">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-100">
                        <Clock3 className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
                          Trust Context
                        </p>
                        <h2 className="mt-2 text-xl font-bold text-white">
                          Honest by construction
                        </h2>
                        <p className="mt-3 text-sm leading-7 text-slate-300">
                          This page only shows fields that arrived on the live
                          seal record or on a live same-job query. When a field
                          is absent, the UI says it is absent instead of
                          inventing lineage or quality signals.
                        </p>
                      </div>
                    </div>
                  </GlassCard>
                </div>
              </section>
            </>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}
