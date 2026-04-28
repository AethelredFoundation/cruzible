import {
  getStablecoinTokenAddress,
  normalizeContractAddress,
} from "@/config/contracts";

describe("contract address configuration", () => {
  it("normalizes valid EVM addresses to checksum form", () => {
    expect(
      normalizeContractAddress("0x1111111111111111111111111111111111111111"),
    ).toBe("0x1111111111111111111111111111111111111111");
    expect(
      normalizeContractAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
  });

  it("rejects empty or malformed addresses", () => {
    expect(normalizeContractAddress("")).toBeUndefined();
    expect(normalizeContractAddress(undefined)).toBeUndefined();
    expect(
      normalizeContractAddress("0x0000000000000000000000000000000000000000"),
    ).toBeUndefined();
    expect(normalizeContractAddress("0x1234")).toBeUndefined();
    expect(normalizeContractAddress("not-an-address")).toBeUndefined();
  });

  it("fails closed for unconfigured stablecoin token addresses", () => {
    expect(getStablecoinTokenAddress("UNKNOWN")).toBeUndefined();
  });
});
