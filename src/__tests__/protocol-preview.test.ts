import { buildProtocolPreview } from "@/lib/protocol";

describe("buildProtocolPreview", () => {
  it("matches the canonical protocol vectors exposed in the app", () => {
    const preview = buildProtocolPreview();

    expect(preview.validatorSetHash).toBe(
      "0x2140fafd3ee542f61f122e6755ab06d115afc3c35fd66f055b555f644670c08f",
    );
    expect(preview.policyHash).toBe(
      "0x6f9bf0a4758a80c32322ea56dafd048c1232b59493854f7c993489b686f8814a",
    );
    expect(preview.universeHash).toBe(
      "0x943404e37eb0d797c384a8dc956736e0a946cc33d06b324e3f233953365774e7",
    );
    expect(preview.stakeSnapshotHash).toBe(
      "0x5554bdbdff9c966a12eda3caf9e366048d25d65065d76133271b4fa141a8e462",
    );
    expect(preview.vectorMatches).toEqual({
      validatorPayload: true,
      rewardPayload: true,
      delegationPayload: true,
      stakerRegistryRoot: true,
      delegationRegistryRoot: true,
    });
  });
});
