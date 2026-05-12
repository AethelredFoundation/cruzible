import { describe, expect, it } from "vitest";
import {
  isPrivateOrLocalAddress,
  isPrivateOrLocalHostname,
} from "../src/utils/networkSafety";

describe("network safety utilities", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.5",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("classifies %s as private or local", (address) => {
    expect(isPrivateOrLocalAddress(address)).toBe(true);
  });

  it("classifies public addresses as routable", () => {
    expect(isPrivateOrLocalAddress("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks localhost hostnames and literal private IP hostnames", () => {
    expect(isPrivateOrLocalHostname("localhost")).toBe(true);
    expect(isPrivateOrLocalHostname("admin.localhost")).toBe(true);
    expect(isPrivateOrLocalHostname("[::1]")).toBe(true);
  });

  it("blocks reserved test and documentation hostnames", () => {
    expect(isPrivateOrLocalHostname("alerts.cruzible.test")).toBe(true);
    expect(isPrivateOrLocalHostname("rpc.aethelred.example")).toBe(true);
    expect(isPrivateOrLocalHostname("webhook.invalid")).toBe(true);
  });
});
