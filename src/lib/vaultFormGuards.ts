interface VaultFormGuardInput {
  walletConnected: boolean;
  isWrongNetwork: boolean;
  amountWei: bigint | null;
  balanceWei: bigint;
  quoteCanSubmit: boolean;
}

interface StakeFormGuardInput extends VaultFormGuardInput {
  minStakeWei: bigint;
}

export function canSubmitStakeForm({
  walletConnected,
  isWrongNetwork,
  amountWei,
  balanceWei,
  quoteCanSubmit,
  minStakeWei,
}: StakeFormGuardInput): boolean {
  return (
    walletConnected &&
    !isWrongNetwork &&
    amountWei !== null &&
    amountWei >= minStakeWei &&
    amountWei <= balanceWei &&
    quoteCanSubmit
  );
}

export function canSubmitUnstakeForm({
  walletConnected,
  isWrongNetwork,
  amountWei,
  balanceWei,
  quoteCanSubmit,
}: VaultFormGuardInput): boolean {
  return (
    walletConnected &&
    !isWrongNetwork &&
    amountWei !== null &&
    amountWei <= balanceWei &&
    quoteCanSubmit
  );
}
