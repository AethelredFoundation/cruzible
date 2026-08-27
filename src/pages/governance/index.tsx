import { LaunchReadinessPage } from "@/components/LaunchReadinessPage";

export default function GovernancePage() {
  return (
    <LaunchReadinessPage
      activePage="governance"
      path="/governance"
      eyebrow="Governance Hardening"
      title="Governance stays gated until on-chain execution is real"
      description="Cruzible is not presenting proposal analytics, treasury actions, or delegation workflows as live governance until the contract deployment, wallet flow, and audit evidence are in place."
      reasons={[
        "Governance must never show illustrative proposals, mock votes, treasury metrics, or delegate leaderboards as if they were authoritative protocol state.",
        "Proposal creation, voting, execution, emergency powers, and treasury controls need to line up exactly with deployed contracts and documented operating roles.",
        "Tier-1 auditors expect the governance UI, contracts, privileged roles, and incident process to be tested together before launch exposure.",
      ]}
      nextSteps={[
        "Deploy and verify governance contracts, then bind the UI to contract-backed proposals, votes, and execution state.",
        "Document role ownership, pause powers, treasury controls, and proposal lifecycle assumptions in the repo and runbooks.",
        "Add end-to-end tests for proposal creation, voting, execution, and failure paths before governance returns to the primary navigation.",
      ]}
    />
  );
}
