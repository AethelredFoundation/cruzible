# Cruzible Attack Playbook

# Cruzible Red-Team Attack Playbook

**Protocol:** Cruzible

**Type:** Liquid Staking Protocol

**Blockchain:** Aethelred L1

**Objective:** Break protocol assumptions before attackers do.

---

# 1. Accounting Attacks (15 scenarios)

These attacks target **share accounting and exchange rate logic**.

### Attack 1 — Phantom Share Mint

Attempt to mint shares without depositing real assets.

Test:

```
deposit(0)
```

or manipulate rounding to produce shares.

---

### Attack 2 — Deposit Front-Run Rewards

Sequence:

```
1 deposit
2 reward harvest
3 withdraw
```

Goal: capture rewards earned before deposit.

---

### Attack 3 — Reward Double Counting

Trigger reward accounting twice.

Test:

```
harvestRewards()
harvestRewards()
```

Verify rewards are not duplicated.

---

### Attack 4 — Share Price Manipulation

Donate tokens to vault.

```
transfer(vault, tokens)
```

Check if exchange rate breaks.

---

### Attack 5 — Rounding Arbitrage

Perform micro deposits repeatedly.

Goal:

extract rounding profit.

---

### Attack 6 — Share Inflation via Queue

Deposit during withdrawal queue processing.

---

### Attack 7 — Zero Share Mint

Deposit small amount.

Ensure shares > 0.

---

### Attack 8 — Exchange Rate Underflow

Try extreme withdrawal conditions.

---

### Attack 9 — Negative Asset Accounting

Test slash handling.

---

### Attack 10 — Partial Withdrawal Accounting Drift

Withdraw multiple small amounts.

---

### Attack 11 — Reward Harvest Timing Attack

Exploit block timing.

---

### Attack 12 — Reward Harvest Reentrancy

Harvest rewards while withdrawing.

---

### Attack 13 — Fee Misallocation

Test protocol fee extraction logic.

---

### Attack 14 — Treasury Drain via Accounting Bug

Check if treasury can withdraw user funds.

---

### Attack 15 — Share Supply Overflow

Extreme deposit simulation.

---

# 2. Withdrawal Queue Attacks (12 scenarios)

Liquid staking protocols fail here often.

---

### Attack 16 — Double Withdrawal Claim

Sequence:

```
requestWithdraw()
claim()
claim()
```

---

### Attack 17 — Queue Skip Attack

Try bypassing earlier withdrawals.

---

### Attack 18 — Withdrawal Queue DoS

Submit thousands of withdrawal requests.

---

### Attack 19 — Withdrawal Queue Overflow

Try maximum queue length.

---

### Attack 20 — Cancel Withdraw Exploit

Cancel then claim.

---

### Attack 21 — Partial Claim Replay

Claim partially twice.

---

### Attack 22 — Withdrawal While Slashed

Withdraw before slash applied.

---

### Attack 23 — Withdrawal During Validator Exit

Validator undelegation delay.

---

### Attack 24 — Withdrawal Queue Reordering

Attempt reordering attack.

---

### Attack 25 — Withdrawal Front-Running

Front-run withdrawal processing.

---

### Attack 26 — Queue State Corruption

Test invalid state transitions.

---

### Attack 27 — Withdrawal Gas Exhaustion

Queue processing exceeds block gas.

---

# 3. Validator Attacks (10 scenarios)

---

### Attack 28 — Malicious Validator Selection

Delegate all funds to risky validator.

---

### Attack 29 — Validator Concentration

Test single validator dominance.

---

### Attack 30 — Validator Jail Handling

Validator jailed mid-epoch.

---

### Attack 31 — Validator Slash Event Replay

Replay slash event.

---

### Attack 32 — Slash Ignored

Prevent slash accounting.

---

### Attack 33 — Slash Double Counting

Slash event counted twice.

---

### Attack 34 — Validator Commission Attack

High validator fees.

---

### Attack 35 — Validator Exit Race

Redelegate during exit.

---

### Attack 36 — Validator Delegation Overflow

Exceed delegation cap.

---

### Attack 37 — Validator Removal Attack

Remove validator with funds.

---

# 4. Reentrancy Attacks (10 scenarios)

---

### Attack 38 — Withdrawal Reentrancy

External callback.

---

### Attack 39 — Deposit Reentrancy

Callback token.

---

### Attack 40 — Reward Claim Reentrancy

Call claim recursively.

---

### Attack 41 — Governance Reentrancy

Call governance during execution.

---

### Attack 42 — Oracle Callback Reentrancy

Malicious oracle contract.

---

### Attack 43 — Token Callback Reentrancy

ERC777 style callbacks.

---

### Attack 44 — Withdrawal Queue Reentrancy

Reenter queue update.

---

### Attack 45 — Delegate Call Reentrancy

External staking module.

---

### Attack 46 — Multicall Reentrancy

Multiple calls in single transaction.

---

### Attack 47 — Proxy Reentrancy

Upgrade contract reentry.

---

# 5. Oracle Attacks (8 scenarios)

---

### Attack 48 — Stale Price Feed

Old data.

---

### Attack 49 — Oracle Replay Attack

Replay signed oracle data.

---

### Attack 50 — Oracle Manipulation

Fake validator rewards.

---

### Attack 51 — Partial Oracle Failure

One oracle offline.

---

### Attack 52 — Oracle Delay Attack

Delayed updates.

---

### Attack 53 — Oracle Signature Forgery

Invalid signature.

---

### Attack 54 — Oracle Decimal Mismatch

Wrong decimals.

---

### Attack 55 — Oracle Data Overflow

Large values.

---

# 6. Access Control Attacks (10 scenarios)

---

### Attack 56 — Unauthorized Upgrade

Attempt upgrade without role.

---

### Attack 57 — Governance Takeover

Exploit governance.

---

### Attack 58 — Admin Key Abuse

Admin drains funds.

---

### Attack 59 — Pauser Abuse

Pause withdrawals.

---

### Attack 60 — Role Escalation

Gain admin privileges.

---

### Attack 61 — Multisig Bypass

Direct execution.

---

### Attack 62 — Timelock Bypass

Immediate governance.

---

### Attack 63 — Emergency Withdraw Abuse

Drain funds.

---

### Attack 64 — Validator Manager Abuse

Delegate malicious validator.

---

### Attack 65 — Fee Parameter Abuse

Set fee to 100%.

# 7. Upgradeability Attacks (10 scenarios)

---

### Attack 66 — Uninitialized Proxy

Initialize contract twice.

---

### Attack 67 — Storage Collision

Upgrade corrupts storage.

---

### Attack 68 — Malicious Implementation Upgrade

Upgrade to attacker code.

---

### Attack 69 — Selfdestruct Upgrade

Destroy contract.

---

### Attack 70 — Delegatecall Exploit

Hijack storage.

---

### Attack 71 — Implementation Initialization

Initialize implementation.

---

### Attack 72 — Proxy Ownership Takeover

Change proxy admin.

---

### Attack 73 — Upgrade Race Condition

Upgrade during operation.

---

### Attack 74 — Upgrade Event Spoofing

Fake upgrade events.

---

### Attack 75 — Upgrade Rollback Failure

Broken migration.

---

# 8. Economic Attacks (10 scenarios)

---

### Attack 76 — Bank Run Simulation

Mass withdrawals.

---

### Attack 77 — Liquidity Mismatch

Instant liquid token vs slow exit.

---

### Attack 78 — Exchange Rate Manipulation

Large deposit before reward.

---

### Attack 79 — Flash Loan Deposit

Exploit flash liquidity.

---

### Attack 80 — Fee Extraction Exploit

Abuse fee logic.

---

### Attack 81 — Validator MEV Exploit

Validator collusion.

---

### Attack 82 — Withdrawal Queue Arbitrage

Trade queue position.

---

### Attack 83 — Secondary Market Depeg

Token price collapse.

---

### Attack 84 — Reward Delay Exploit

Delay reward update.

---

### Attack 85 — Slashing Escape

Withdraw before slash.

---

# 9. Denial-of-Service Attacks (8 scenarios)

---

### Attack 86 — Queue Spam

Thousands of requests.

---

### Attack 87 — Gas Bomb Withdrawal

Heavy computation.

---

### Attack 88 — Validator List Explosion

Large validator set.

---

### Attack 89 — Storage Bloat

Large arrays.

---

### Attack 90 — Reward Harvest DoS

Block harvest.

---

### Attack 91 — Governance Proposal Spam

Flood governance.

---

### Attack 92 — Event Log Overflow

Large event emissions.

---

### Attack 93 — Withdrawal Claim DoS

Block claims.

---

# 10. State Machine Attacks (7 scenarios)

---

### Attack 94 — Invalid State Transition

Force illegal state.

---

### Attack 95 — Withdrawal After Claim

Claim twice.

---

### Attack 96 — Deposit During Pause

Deposit bypass.

---

### Attack 97 — Withdraw During Pause

Withdraw bypass.

---

### Attack 98 — Validator State Drift

Mismatch with chain state.

---

### Attack 99 — Reward State Drift

Mismatch accounting.

---

### Attack 100 — Slash State Drift

Mismatch slash state.

---

# 11. Cross-Contract Attacks (10 scenarios)

---

### Attack 101 — Vault Token Injection

Send tokens directly.

---

### Attack 102 — Malicious Token Contract

Callback token.

---

### Attack 103 — Contract Selfdestruct Attack

Destroy dependency.

---

### Attack 104 — Delegatecall Hijack

Malicious contract.

---

### Attack 105 — Multicall Abuse

Batch operations.

---

### Attack 106 — Treasury Contract Exploit

Drain treasury.

---

### Attack 107 — Governance Contract Exploit

Take governance.

---

### Attack 108 — Validator Manager Attack

Manipulate validator set.

---

### Attack 109 — Withdrawal Queue Injection

Corrupt queue.

---

### Attack 110 — Reward Contract Attack

Fake rewards.

---

# 12. Infrastructure Attacks (10 scenarios)

---

### Attack 111 — Keeper Failure

Automation offline.

---

### Attack 112 — Oracle Downtime

Data unavailable.

---

### Attack 113 — Validator Monitoring Failure

Slash unnoticed.

---

### Attack 114 — Governance Key Loss

Key lost.

---

### Attack 115 — Multisig Compromise

Keys stolen.

---

### Attack 116 — Upgrade Script Error

Deployment failure.

---

### Attack 117 — Chain Upgrade Incompatibility

L1 change breaks protocol.

---

### Attack 118 — RPC Manipulation

Node data manipulation.

---

### Attack 119 — Indexer Failure

Monitoring blind.

---

### Attack 120 — Emergency Pause Failure

Cannot pause protocol.

---

# Red-Team Testing Strategy

Each attack scenario must be tested with:

- unit tests
- fuzz tests
- adversarial simulations
- stress testing

---

# Success Criteria

Protocol passes if:

- no scenario leads to fund loss
- no invariant violation
- no privilege escalation
- no economic exploit

---

# Critical Invariants

These must always hold:

```
totalAssets >= totalUserClaims
```

```
sum(userShares) == totalShares
```

```
withdrawQueue cannot skip entries
```

---

# Continuous Red-Team Testing

After deployment:

- automated invariant checks
- chaos testing
- bug bounty program

# The 25 catastrophic vulnerabilities that destroy DeFi protocols

## 1. Broken share accounting

This is the number one liquid staking killer.

**What happens:** users mint too many receipt tokens, redeem too much underlying, or rewards/slashes are reflected incorrectly.

**How it kills Cruzible:** `lsAETHEL` supply becomes larger than real redeemable AETHEL.

**Prevent it by**

- defining one canonical `totalAssets`
- defining one canonical `totalShares`
- proving the mint and burn formulas
- invariant testing every deposit, withdrawal, slash, reward, and fee event
- forbidding any hidden accounting path outside the main vault

**Hard rule**

`total redeemable claims <= real assets under control`

---

## 2. Reentrancy on withdrawal or claim

**What happens:** attacker calls back into the contract before state is fully updated.

**How it kills Cruzible:** double claim, double withdrawal, queue corruption, or accounting drift.

**Prevent it by**

- checks-effects-interactions ordering
- reentrancy guards on all state-sensitive external entrypoints
- avoiding external calls before state is finalized
- testing with malicious receiver contracts

---

## 3. Stale or manipulable exchange rate

**What happens:** deposits or withdrawals happen using outdated asset values.

**How it kills Cruzible:** new entrants steal old rewards, or exiting users escape losses.

**Prevent it by**

- refreshing rewards/slashes before mint or burn where required
- documenting exact timing semantics
- fuzzing deposit-harvest-withdraw orderings
- preventing operators from selectively delaying updates for advantage

---

## 4. Slashing not socialized correctly

**What happens:** slash losses are ignored, delayed, or charged to the wrong cohort.

**How it kills Cruzible:** insolvency or unfair exits.

**Prevent it by**

- defining slash accounting explicitly
- testing slash before request, after request, before claim, after claim
- ensuring no one can redeem at pre-slash value once slash is known
- replay protection on slash events

---

## 5. Withdrawal queue corruption

**What happens:** requests can be skipped, duplicated, reordered, or partially corrupted.

**How it kills Cruzible:** stuck funds, unfair processing, double claims, or permanent queue deadlock.

**Prevent it by**

- explicit queue state machine
- unique request IDs
- one-way transitions
- invariant: claimed requests cannot reenter pending states
- stress test with thousands of requests

---

## 6. Privileged role can drain or brick protocol

**What happens:** owner, operator, pauser, or upgrader has too much power.

**How it kills Cruzible:** governance compromise becomes total loss.

**Prevent it by**

- strict role separation
- timelocked governance for dangerous actions
- multisig only, never single EOA
- emergency roles narrowly scoped
- no admin function that can arbitrarily seize user funds

---

## 7. Upgradeability takeover

**What happens:** attacker upgrades proxy, initializes implementation, or exploits storage corruption.

**How it kills Cruzible:** full protocol compromise.

**Prevent it by**

- audited proxy pattern
- disabled implementation initialization
- storage layout checks on every upgrade
- upgrade timelock + multisig
- migration rehearsals on forked state

---

## 8. Direct token donation breaks accounting

**What happens:** attacker sends underlying directly to vault and changes apparent balance.

**How it kills Cruzible:** exchange rate distortions, unfair minting, or fee extraction bugs.

**Prevent it by**

- not relying blindly on raw token balance as sole truth
- separating accounted assets from incidental balances where appropriate
- testing unsolicited token transfers

---

## 9. Rounding exploitation

**What happens:** tiny deposits/withdrawals repeatedly extract dust.

**How it kills Cruzible:** slow value leakage and unfairness.

**Prevent it by**

- deliberate rounding policy
- minimum deposit and minimum redeem amounts
- fuzzing microscale sequences
- checking repeated cycle extraction attacks

---

## 10. Reward double counting

**What happens:** same reward source is recognized twice.

**How it kills Cruzible:** phantom yield and hidden insolvency.

**Prevent it by**

- idempotent harvest logic
- checkpointed reward accounting
- event or nonce tracking
- tests calling harvest repeatedly under unchanged conditions

---

## 11. Pending withdrawals counted as both liquid and staked

**What happens:** assets in transition are double-counted.

**How it kills Cruzible:** vault looks solvent until many users claim.

**Prevent it by**

- distinct accounting buckets:
  - idle
  - delegated
  - pending undelegation
  - claimable
- invariant tests across state transitions

---

## 12. Mispriced initial deposit

**What happens:** first depositor gets disproportionate share ownership.

**How it kills Cruzible:** permanent skew in economics.

**Prevent it by**

- explicit bootstrap formula
- seed initialization review
- tests for first deposit, second deposit, and post-reward deposit

---

## 13. Validator concentration risk

**What happens:** too much stake goes to one validator or correlated validator set.

**How it kills Cruzible:** one slash event damages entire protocol.

**Prevent it by**

- validator allocation caps
- diversification policy in code and ops
- jail/slash reaction policy
- validator quality scoring

---

## 14. Malicious or careless validator manager

**What happens:** operator routes stake to bad validators.

**How it kills Cruzible:** increased slash probability or censorship.

**Prevent it by**

- whitelist controls
- auditable delegation policy
- constrained operator powers
- governance review on validator additions/removals

---

## 15. Flash-loan or same-block timing exploit

**What happens:** attacker deposits, captures an accounting event, exits.

**How it kills Cruzible:** unfair reward capture or fee extraction.

**Prevent it by**

- order-safe accounting
- block/epoch semantics clearly defined
- testing atomic deposit-harvest-withdraw sequences
- considering cooldowns or delayed effectiveness where needed

---

## 16. Oracle or off-chain data trust failure

**What happens:** protocol trusts stale, forged, delayed, or replayed data.

**How it kills Cruzible:** false rewards, missed slashes, wrong validator state.

**Prevent it by**

- minimizing off-chain trust
- signature verification
- nonce/replay protection
- freshness limits
- quorum-based reporting if off-chain data is unavoidable

---

## 17. State machine ambiguity

**What happens:** system allows illegal transitions or undefined edge behavior.

**How it kills Cruzible:** impossible states, stuck requests, duplicate claims.

**Prevent it by**

- formal state diagrams
- one function per transition
- revert on invalid transitions
- invariant tests over random sequences

---

## 18. Gas-based denial of service

**What happens:** queues, validator loops, or cleanup functions become too expensive to execute.

**How it kills Cruzible:** claims or rebalancing stop working in production.

**Prevent it by**

- bounded loops
- batch processing
- pull over push design
- worst-case gas simulations
- anti-spam design for tiny requests

---

## 19. Emergency pause that is too weak or too strong

**What happens:** either pause cannot stop damage, or it can trap users unfairly forever.

**How it kills Cruzible:** live exploit continues, or protocol becomes hostage to admin powers.

**Prevent it by**

- precise pause matrix:
  - pause deposits?
  - pause redelegations?
  - pause claims?
- emergency controls documented in advance
- exit guarantees where possible

---

## 20. Storage collision after upgrade

**What happens:** new implementation overwrites balances, roles, or queue data.

**How it kills Cruzible:** silent corruption of core state.

**Prevent it by**

- storage layout diffing
- reserved gaps
- upgrade review checklist
- migration test with real state snapshots

---

## 21. Uninitialized or re-initializable contracts

**What happens:** attacker initializes proxy or implementation and becomes admin.

**How it kills Cruzible:** instant takeover.

**Prevent it by**

- initializer guards
- constructor-based implementation lock where appropriate
- deployment scripts that verify initialized state
- tests for repeated initialization attempts

---

## 22. Event / monitoring blind spots

**What happens:** protocol breaks operationally but nobody notices in time.

**How it kills Cruzible:** slash events, queue failures, or accounting drift go undetected.

**Prevent it by**

- emitting events for every critical state change
- off-chain alerts for:
  - slash events
  - validator jailing
  - queue growth
  - solvency deviations
  - abnormal exchange-rate movement

---

## 23. Unsafe dependency assumptions

**What happens:** external library, proxy module, token behavior, or chain integration behaves differently than assumed.

**How it kills Cruzible:** invariant breaks from outside your own code.

**Prevent it by**

- pinning dependency versions
- reviewing inherited code, not trusting it blindly
- integration tests against actual Aethelred behavior
- documenting assumptions about chain staking semantics

---

## 24. No bank-run planning

**What happens:** liquid token is instantly transferable, but unstaking is delayed.

**How it kills Cruzible:** panic creates redemption pressure and depeg.

**Prevent it by**

- explicitly modeling liquidity mismatch
- queue stress tests
- emergency communications plan
- partial-liquidity handling rules
- considering liquidity buffers

---

## 25. No invariant-driven security culture

**What happens:** team audits functions but never proves protocol-level truths.

**How it kills Cruzible:** code looks clean, but system still fails economically.

**Prevent it by**

- writing protocol invariants before launch
- fuzzing against those invariants continuously
- making every code change prove it did not break solvency, fairness, or queue safety

---

# The 10 most important invariants Cruzible should enforce

These are the invariants I would consider non-negotiable.

## 1. Share conservation

`sum(all user shares) + protocol-owned shares == totalShares`

## 2. Solvency

`real redeemable assets >= aggregate redeemable claims`

## 3. No double claim

A withdrawal request can be claimed at most once.

## 4. Monotonic queue integrity

A processed withdrawal request cannot become pending again.

## 5. Slash inclusion

Known slash events must be reflected in accounting exactly once.

## 6. No phantom rewards

Rewards cannot increase unless supported by real claimable value.

## 7. Fee boundedness

Protocol fees cannot exceed configured and governed limits.

## 8. Role safety

No unauthorized account can change validator set, fees, pause state, or implementation.

## 9. Upgrade continuity

After upgrade, all balances, shares, and queue entries remain valid.

## 10. Redemption fairness

Users entering later cannot capture value earned by earlier users unfairly, and users exiting earlier cannot evade already-realized losses unfairly.

---

# The 7 failure domains that matter most for Cruzible

If I were ranking where Cruzible is most likely to catastrophically fail, I would focus here:

## 1. Share / exchange-rate accounting

Most likely source of insolvency.

## 2. Slashing integration

Most likely source of hidden insolvency.

## 3. Withdrawal queue design

Most likely source of stuck funds and fairness failure.

## 4. Upgrade/admin controls

Most likely source of total compromise.

## 5. Aethelred staking integration boundary

Most likely source of assumption mismatch.

## 6. Off-chain operators/oracles/keepers

Most likely source of delayed or false state.

## 7. Stress liquidity behavior

Most likely source of depeg and loss of trust.

---

# The practical “never let this happen” checklist

For Cruzible, I would not approve mainnet without these:

- full invariant suite running in CI
- slash simulations across all withdrawal states
- malicious receiver reentrancy tests
- unsolicited token transfer tests
- upgrade rehearsal on production-like state
- queue stress test with thousands of requests
- governance timelock and multisig verified
- validator diversification rules enforced
- operator runbooks for jailing/slash incidents
- real-time monitoring for solvency and queue health

---

# The single biggest truth about liquid staking security

A liquid staking protocol usually does **not** die because of one flashy hack.

It dies because **accounting, timing, queueing, and governance assumptions drift apart**.

That is why the best audit question is not “Is this function safe?”

It is:

**“After every possible sequence of deposits, rewards, slashes, undelegations, claims, upgrades, and pauses, is Cruzible still solvent, fair, and live?”**
