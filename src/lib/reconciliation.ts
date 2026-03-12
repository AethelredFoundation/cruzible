export type LiveReconciliationDocument = {
  epoch: number;
  network: string;
  mode: string;
  captured_at: string;
  source?: Record<string, string | number | boolean | null>;
  warnings?: string[];
  validator_selection?: {
    observed?: {
      universe_hash?: string;
    };
    meta?: {
      validator_count?: number;
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export async function fetchLiveReconciliation(
  validatorLimit = 200
): Promise<LiveReconciliationDocument> {
  const response = await fetch(`${API_URL}/reconciliation/live?validator_limit=${validatorLimit}`);
  if (!response.ok) {
    throw new Error(`Failed to load live reconciliation: HTTP ${response.status}`);
  }
  return response.json();
}

export function renderLiveReconciliationMarkdown(
  document: LiveReconciliationDocument
): string {
  const warningCount = document.warnings?.length ?? 0;
  const validatorCount = document.validator_selection?.meta?.validator_count ?? 'n/a';
  const stakeMeta = document.stake_snapshot?.meta;
  const sourceLines = Object.entries(document.source ?? {}).map(
    ([key, value]) => `- \`${key}\`: \`${String(value)}\``
  );

  const lines = [
    '# Cruzible Live Reconciliation',
    '',
    `- Epoch: \`${document.epoch}\``,
    `- Network: \`${document.network}\``,
    `- Mode: \`${document.mode}\``,
    `- Captured At: \`${document.captured_at}\``,
    `- Validators: \`${validatorCount}\``,
    `- Included Stakers: \`${stakeMeta?.included_stakers ?? 'n/a'}\``,
    `- Warning Count: \`${warningCount}\``,
    '',
    '## Observed Hashes',
    '',
    `- Universe Hash: \`${document.validator_selection?.observed?.universe_hash ?? 'n/a'}\``,
    `- Stake Snapshot Hash: \`${document.stake_snapshot?.observed?.stake_snapshot_hash ?? 'n/a'}\``,
    `- Staker Registry Root: \`${document.stake_snapshot?.observed?.staker_registry_root ?? 'n/a'}\``,
    `- Delegation Registry Root: \`${document.stake_snapshot?.observed?.delegation_registry_root ?? 'n/a'}\``,
    '',
  ];

  if (stakeMeta) {
    lines.push('## Stake Snapshot Status', '');
    lines.push(`- Complete: \`${stakeMeta.complete ? 'yes' : 'partial'}\``);
    lines.push(`- Skipped Stakers: \`${stakeMeta.skipped_stakers ?? 'n/a'}\``);
    lines.push(`- Included Shares: \`${stakeMeta.included_total_shares ?? 'n/a'}\``);
    lines.push(`- Vault Total Shares: \`${stakeMeta.vault_total_shares ?? 'n/a'}\``);
    lines.push(
      `- Registry Roots Available: \`${stakeMeta.registry_roots_available ? 'yes' : 'no'}\``
    );
    lines.push('');
  }

  if (sourceLines.length > 0) {
    lines.push('## Source', '', ...sourceLines, '');
  }

  if (warningCount > 0) {
    lines.push('## Warnings', '', ...(document.warnings ?? []).map((warning) => `- ${warning}`), '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
