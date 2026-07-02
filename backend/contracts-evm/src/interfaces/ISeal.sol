// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.18;

/// @title ISeal — the Aethelred Digital Seal precompile
/// @notice Exposes post-quantum Digital Seals — including the CEAP
///         confidentiality attestation (ADR-0003) — to Solidity contracts.
///         A contract can gate settlement on "this inference ran under TEE
///         (or FHE), on approved silicon, with a vendor root, inside an
///         approved jurisdiction" without trusting any oracle: the answer is
///         computed by the same consensus logic that minted the seal.
/// @dev    Precompiled contract at address 0x0000000000000000000000000000000000000900.
///         Aethelred verifiable-AI precompile range: 0x0900 ISeal,
///         0x0901 IVerify (reserved), 0x0902 IPoUW (reserved).
interface ISeal {
    /// @notice Core fields of a Digital Seal.
    /// @param sealId The 64-hex-character seal identifier.
    function getSeal(string calldata sealId)
        external
        view
        returns (
            bytes32 modelCommitment,
            bytes32 inputCommitment,
            bytes32 outputCommitment,
            int64 blockHeight,
            uint64 timestamp,
            string memory requestedBy,
            string memory purpose,
            uint8 status, // 0 unspecified, 1 pending, 2 active, 3 revoked, 4 expired
            string memory jobId
        );

    /// @notice The CEAP confidentiality attestation bound into the seal:
    ///         how the data was protected and how correctness was proven.
    function getConfidentiality(string calldata sealId)
        external
        view
        returns (
            string memory backend, // none|tee|gpu-cc|mpc|fhe|hybrid
            string memory verification, // none|tee-attested|freivalds|optimistic|reexec|zkml
            string memory platform, // e.g. amd-sev-snp, intel-tdx, nvidia-gpu
            bytes memory measurement, // launch measurement or FHE circuit/param hash
            string memory trustBasis, // vendor_root | test_root
            string memory jurisdiction,
            bool dataSealed,
            bytes memory policyHash,
            string memory worker
        );

    /// @notice Resolve the seal minted for a PoUW job.
    function getSealIdByJob(string calldata jobId) external view returns (string memory sealId);

    /// @notice True iff the seal exists and is ACTIVE (not pending/revoked/expired).
    function verifySeal(string calldata sealId) external view returns (bool active);

    /// @notice Evaluate a CEAP confidentiality policy against the seal's
    ///         attestation using the SAME consensus logic that enforced the
    ///         job's policy at sealing time. Empty arrays mean "any".
    /// @return satisfied Whether the attestation satisfies the policy.
    /// @return reason Empty when satisfied; the rejection reason otherwise.
    function requireConfidentiality(
        string calldata sealId,
        string[] calldata allowedBackends,
        string calldata minVerification,
        string[] calldata allowedPlatforms,
        bool requireVendorRoot,
        string[] calldata dataResidency
    ) external view returns (bool satisfied, string memory reason);
}
