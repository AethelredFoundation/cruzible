import { getApiUrl } from "@/config/api";

export type ReconciliationCheckStatus =
  | "PASS"
  | "WARNING"
  | "CRITICAL"
  | "SKIPPED"
  | "UNKNOWN";

export type ReconciliationOverallStatus =
  | "OK"
  | "WARNING"
  | "CRITICAL"
  | "UNKNOWN";

export type LiveReconciliationDocument = {
  epoch: number;
  network: string;
  mode: string;
  captured_at: string;
  source?: Record<string, string | number | boolean | null>;
  warnings?: string[];
  discrepancies?: Array<{
    code: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    status: "ACTIVE";
    title: string;
    message: string;
    affected_accounts: number;
    affected_shares?: string;
    impact_bps?: number;
    sample_addresses: string[];
    evidence?: Record<string, unknown>;
    remediation?: string;
  }>;
  validator_selection?: {
    observed?: {
      universe_hash?: string;
    };
    meta?: {
      validator_count?: number;
      total_eligible_validators?: number;
    };
  };
  stake_snapshot?: {
    observed?: {
      stake_snapshot_hash?: string;
      staker_registry_root?: string;
      delegation_registry_root?: string;
      delegation_payload_hex?: string;
    };
    meta?: {
      included_stakers?: number;
      skipped_stakers?: number;
      included_total_shares?: string;
      vault_total_shares?: string;
      registry_roots_available?: boolean;
      complete?: boolean;
    };
  };
};

export type ReconciliationControlPlaneSummary = {
  epoch: number;
  epoch_source: string;
  captured_at: string;
  chain_height: number;
  validator_count: number;
  total_eligible_validators: number;
  validator_universe_hash: string;
  stake_snapshot_hash?: string;
  stake_snapshot_complete: boolean | null;
  warning_count: number;
  discrepancy_count: number;
  critical_discrepancy_count: number;
  warning_discrepancy_count: number;
  info_discrepancy_count: number;
  warnings: string[];
};

export type ReconciliationHistoryEntry = {
  snapshot_id: string;
  snapshot_key: string;
  epoch: number;
  captured_at: string;
  validator_universe_hash: string;
  stake_snapshot_hash?: string;
  warning_count: number;
  discrepancy_count: number;
  status: "OK" | "WARNING" | "CRITICAL";
  epoch_source: string;
  chain_height: number;
  stake_snapshot_complete: boolean | null;
};

export type HistoricalReconciliationSnapshot = {
  snapshot_id: string;
  snapshot_key: string;
  status: "OK" | "WARNING" | "CRITICAL";
  created_at: string;
  document: LiveReconciliationDocument;
  discrepancies: NonNullable<LiveReconciliationDocument["discrepancies"]>;
};

export type ReconciliationScorecard = {
  generated_at: string;
  status: ReconciliationOverallStatus;
  epoch: number | null;
  epoch_source: string | null;
  snapshot_age_seconds: number | null;
  validator_coverage_percent: number | null;
  stake_snapshot_status: "complete" | "partial" | "unavailable";
  freshness: {
    status: ReconciliationCheckStatus;
    message: string;
    indexed_epoch: number | null;
    protocol_epoch: number | null;
    epoch_lag: number | null;
    indexed_state_age_seconds: number | null;
    stale_limit_seconds: number | null;
  };
  pillars: Array<{
    key: string;
    label: string;
    status: ReconciliationCheckStatus;
    message: string;
    value?: string;
  }>;
  checks: Array<{
    name: string;
    status: ReconciliationCheckStatus;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  evidence: {
    captured_at: string;
    chain_height: number;
    validator_count: number;
    total_eligible_validators: number;
    validator_universe_hash: string;
    stake_snapshot_hash?: string;
    stake_snapshot_complete: boolean | null;
    warning_count: number;
    discrepancy_count: number;
    critical_discrepancy_count: number;
    warning_discrepancy_count: number;
    info_discrepancy_count: number;
    warnings: string[];
    scheduler_timestamp: string | null;
    scheduler_duration_ms: number | null;
  };
};

export async function fetchLiveReconciliation(
  validatorLimit = 200,
): Promise<LiveReconciliationDocument> {
  const response = await fetch(
    getApiUrl(`/reconciliation/live?validator_limit=${validatorLimit}`),
  );
  if (!response.ok) {
    throw new Error(
      `Failed to load live reconciliation: HTTP ${response.status}`,
    );
  }
  return response.json();
}

export async function fetchReconciliationControlPlane(): Promise<ReconciliationControlPlaneSummary> {
  const response = await fetch(getApiUrl("/reconciliation/control-plane"));
  if (!response.ok) {
    throw new Error(
      `Failed to load reconciliation control plane: HTTP ${response.status}`,
    );
  }
  return response.json();
}

export async function fetchReconciliationScorecard(): Promise<ReconciliationScorecard> {
  const response = await fetch(getApiUrl("/reconciliation/scorecard"));
  if (!response.ok) {
    throw new Error(
      `Failed to load reconciliation scorecard: HTTP ${response.status}`,
    );
  }
  return response.json();
}

export async function fetchReconciliationHistory(
  limit = 10,
): Promise<ReconciliationHistoryEntry[]> {
  const response = await fetch(
    getApiUrl(`/reconciliation/history?limit=${limit}`),
  );
  if (!response.ok) {
    throw new Error(
      `Failed to load reconciliation history: HTTP ${response.status}`,
    );
  }
  return response.json();
}

export async function fetchHistoricalReconciliationSnapshot(
  epoch: number,
): Promise<HistoricalReconciliationSnapshot> {
  const response = await fetch(getApiUrl(`/reconciliation/${epoch}`));
  if (!response.ok) {
    throw new Error(
      `Failed to load reconciliation snapshot for epoch ${epoch}: HTTP ${response.status}`,
    );
  }
  return response.json();
}

export function renderLiveReconciliationMarkdown(
  document: LiveReconciliationDocument,
): string {
  const warningCount = document.warnings?.length ?? 0;
  const validatorCount =
    document.validator_selection?.meta?.validator_count ?? "n/a";
  const totalEligibleValidators =
    document.validator_selection?.meta?.total_eligible_validators ?? "n/a";
  const stakeMeta = document.stake_snapshot?.meta;
  const sourceLines = Object.entries(document.source ?? {}).map(
    ([key, value]) => `- \`${key}\`: \`${String(value)}\``,
  );

  const lines = [
    "# Cruzible Live Reconciliation",
    "",
    `- Epoch: \`${document.epoch}\``,
    `- Network: \`${document.network}\``,
    `- Mode: \`${document.mode}\``,
    `- Captured At: \`${document.captured_at}\``,
    `- Displayed Validators: \`${validatorCount}\``,
    `- Hashed Validator Universe: \`${totalEligibleValidators}\``,
    `- Included Stakers: \`${stakeMeta?.included_stakers ?? "n/a"}\``,
    `- Warning Count: \`${warningCount}\``,
    `- Discrepancy Count: \`${document.discrepancies?.length ?? 0}\``,
    "",
    "## Observed Hashes",
    "",
    `- Universe Hash: \`${document.validator_selection?.observed?.universe_hash ?? "n/a"}\``,
    `- Stake Snapshot Hash: \`${document.stake_snapshot?.observed?.stake_snapshot_hash ?? "n/a"}\``,
    `- Staker Registry Root: \`${document.stake_snapshot?.observed?.staker_registry_root ?? "n/a"}\``,
    `- Delegation Registry Root: \`${document.stake_snapshot?.observed?.delegation_registry_root ?? "n/a"}\``,
    `- Delegation Payload: \`${document.stake_snapshot?.observed?.delegation_payload_hex ?? "n/a"}\``,
    "",
  ];

  if (stakeMeta) {
    lines.push("## Stake Snapshot Status", "");
    lines.push(`- Complete: \`${stakeMeta.complete ? "yes" : "partial"}\``);
    lines.push(`- Skipped Stakers: \`${stakeMeta.skipped_stakers ?? "n/a"}\``);
    lines.push(
      `- Included Shares: \`${stakeMeta.included_total_shares ?? "n/a"}\``,
    );
    lines.push(
      `- Vault Total Shares: \`${stakeMeta.vault_total_shares ?? "n/a"}\``,
    );
    lines.push(
      `- Registry Roots Available: \`${stakeMeta.registry_roots_available ? "yes" : "no"}\``,
    );
    lines.push("");
  }

  if (sourceLines.length > 0) {
    lines.push("## Source", "", ...sourceLines, "");
  }

  if (warningCount > 0) {
    lines.push(
      "## Warnings",
      "",
      ...(document.warnings ?? []).map((warning) => `- ${warning}`),
      "",
    );
  }

  if ((document.discrepancies?.length ?? 0) > 0) {
    lines.push("## Discrepancies", "");
    for (const discrepancy of document.discrepancies ?? []) {
      lines.push(
        `- [${discrepancy.severity}] \`${discrepancy.code}\`: ${discrepancy.message}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
