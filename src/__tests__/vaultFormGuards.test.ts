import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import {
  canSubmitStakeForm,
  canSubmitUnstakeForm,
} from "@/lib/vaultFormGuards";

const ONE_AETHEL = parseEther("1");

describe("vault form guards", () => {
  it("allows stake confirmation only when wallet, balance, minimum, and quote gates pass", () => {
    const validInput = {
      walletConnected: true,
      isWrongNetwork: false,
      amountWei: parseEther("2"),
      balanceWei: parseEther("5"),
      quoteCanSubmit: true,
      minStakeWei: ONE_AETHEL,
    };

    expect(canSubmitStakeForm(validInput)).toBe(true);
    expect(
      canSubmitStakeForm({ ...validInput, amountWei: parseEther("0.9") }),
    ).toBe(false);
    expect(
      canSubmitStakeForm({ ...validInput, amountWei: parseEther("6") }),
    ).toBe(false);
    expect(canSubmitStakeForm({ ...validInput, quoteCanSubmit: false })).toBe(
      false,
    );
    expect(canSubmitStakeForm({ ...validInput, isWrongNetwork: true })).toBe(
      false,
    );
  });

  it("allows unstake confirmation only when wallet, share balance, and quote gates pass", () => {
    const validInput = {
      walletConnected: true,
      isWrongNetwork: false,
      amountWei: parseEther("2"),
      balanceWei: parseEther("5"),
      quoteCanSubmit: true,
    };

    expect(canSubmitUnstakeForm(validInput)).toBe(true);
    expect(
      canSubmitUnstakeForm({ ...validInput, amountWei: parseEther("6") }),
    ).toBe(false);
    expect(canSubmitUnstakeForm({ ...validInput, amountWei: null })).toBe(
      false,
    );
    expect(
      canSubmitUnstakeForm({ ...validInput, walletConnected: false }),
    ).toBe(false);
    expect(canSubmitUnstakeForm({ ...validInput, quoteCanSubmit: false })).toBe(
      false,
    );
  });
});
