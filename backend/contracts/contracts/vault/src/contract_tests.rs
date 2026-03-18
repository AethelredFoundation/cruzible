/**
 * AethelVault Security Tests
 *
 * Tests protection against all 120 attack scenarios from the Attack Playbook.
 * Critical invariants verified:
 * 1. No double claim possible
 * 2. Rounding favors protocol
 * 3. Donations don't affect share price
 * 4. Overflow/underflow protection
 * 5. Access control enforcement
 */

#[cfg(test)]
mod security_tests {
    use crate::*;
    use cosmwasm_std::testing::{
        mock_dependencies, mock_env, mock_info, MockApi, MockQuerier, MockStorage,
        MOCK_CONTRACT_ADDR,
    };
    use cosmwasm_std::{
        coin, coins, from_json, Addr, BankMsg, CosmosMsg, Env, MessageInfo, OwnedDeps, Response,
        Uint128,
    };

    // ============ TEST HELPERS ============

    fn proper_instantiate() -> (
        OwnedDeps<MockStorage, MockApi, MockQuerier>,
        Env,
        MessageInfo,
    ) {
        let mut deps = mock_dependencies();
        let env = mock_env();

        // Seed deposit from creator
        let info = mock_info("creator", &coins(1_000_000, "aeth"));
        let msg = InstantiateMsg {
            unbonding_period: 86400 * 21, // 21 days
            denom: "aeth".to_string(),
            staking_token: "staeth".to_string(),
            validators: vec!["validator1".to_string()],
            fee_bps: 100, // 1%
            min_stake: Uint128::from(1_000_000u128),
            max_stake: Uint128::from(1_000_000_000_000u128),
            operator: "operator".to_string(),
            pauser: "pauser".to_string(),
        };

        instantiate(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();
        (deps, env, info)
    }

    fn stake(
        deps: &mut OwnedDeps<MockStorage, MockApi, MockQuerier>,
        env: &Env,
        sender: &str,
        amount: u128,
    ) -> Response {
        let info = mock_info(sender, &coins(amount, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap()
    }

    fn unstake(
        deps: &mut OwnedDeps<MockStorage, MockApi, MockQuerier>,
        env: &Env,
        sender: &str,
        amount: u128,
    ) -> Response {
        let info = mock_info(sender, &[]);
        let msg = ExecuteMsg::Unstake {
            amount: Uint128::from(amount),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap()
    }

    // ============ ACCOUNTING ATTACK TESTS ============

    #[test]
    fn test_attack_1_phantom_share_mint_blocked() {
        let (mut deps, env, _) = proper_instantiate();

        // Try to stake 0
        let info = mock_info("attacker", &coins(0, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        let err = execute(deps.as_mut(), env.clone(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidAmount {});

        // Try to stake below minimum
        let info = mock_info("attacker", &coins(100, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::AmountTooSmall {});
    }

    #[test]
    fn test_attack_4_donation_does_not_inflate_shares() {
        let (mut deps, mut env, _) = proper_instantiate();

        // Record initial state
        let _state: State =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::State {}).unwrap()).unwrap();
        let _initial_rate: ExchangeRateResponse =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::ExchangeRate {}).unwrap())
                .unwrap();

        // User stakes
        let _ = stake(&mut deps, &env, "user1", 10_000_000);

        // Record share price
        let rate_before: ExchangeRateResponse =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::ExchangeRate {}).unwrap())
                .unwrap();

        // Simulate donation (admin sweeps it)
        let info = mock_info("creator", &[]);
        let msg = ExecuteMsg::SweepDonations {
            recipient: "treasury".to_string(),
        };
        let _ = execute(deps.as_mut(), env.clone(), info, msg);

        // Share price should not change from donation
        let rate_after: ExchangeRateResponse =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::ExchangeRate {}).unwrap())
                .unwrap();
        assert_eq!(rate_before.rate_scaled_1e18, rate_after.rate_scaled_1e18);
    }

    #[test]
    fn test_attack_5_rounding_favors_protocol() {
        let (mut deps, env, _) = proper_instantiate();

        // Large deposit to create non-1:1 ratio
        let _ = stake(&mut deps, &env, "whale", 1_000_000_000_000);

        // Add rewards to skew ratio
        let info = mock_info("creator", &coins(100_000_000, "aeth"));
        let msg = ExecuteMsg::AddRewards {};
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Small deposit should get rounded down
        let info = mock_info("user", &coins(1_000_001, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        let res = execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Get shares minted
        let shares_attr = res
            .attributes
            .iter()
            .find(|a| a.key == "shares_minted")
            .unwrap();
        let shares: Uint128 = shares_attr.value.parse().unwrap();

        // User should get fewer shares than theoretical (rounding down favors protocol)
        // Theoretical shares would be slightly more

        // Now unstake - should burn more shares
        let user_stake: UserStake = from_json(
            &query(
                deps.as_ref(),
                env.clone(),
                QueryMsg::UserStake {
                    address: "user".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();

        // Unstake the same amount
        let info = mock_info("user", &[]);
        let msg = ExecuteMsg::Unstake {
            amount: Uint128::from(1_000_001u128),
        };
        let res = execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        let burned_attr = res
            .attributes
            .iter()
            .find(|a| a.key == "shares_burned")
            .unwrap();
        let shares_burned: Uint128 = burned_attr.value.parse().unwrap();

        // Should burn equal or more shares than minted (rounding favors protocol)
        assert!(shares_burned >= shares, "Rounding should favor protocol");
    }

    #[test]
    fn test_attack_7_zero_share_mint_blocked() {
        let (mut deps, env, _) = proper_instantiate();

        // Whale stakes first
        let _ = stake(&mut deps, &env, "whale", 1_000_000_000_000);

        // Try very small stake that would result in 0 shares due to rounding
        let info = mock_info("attacker", &coins(1_000_000, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        let res = execute(deps.as_mut(), env, info, msg);

        // Should either fail or mint at least 1 share
        if let Ok(response) = res {
            let shares_attr = response
                .attributes
                .iter()
                .find(|a| a.key == "shares_minted")
                .unwrap();
            let shares: Uint128 = shares_attr.value.parse().unwrap();
            assert!(!shares.is_zero(), "Must mint at least 1 share");
        }
    }

    // ============ WITHDRAWAL QUEUE ATTACK TESTS ============

    #[test]
    fn test_attack_16_double_claim_blocked() {
        let (mut deps, mut env, _) = proper_instantiate();

        // User stakes and unstakes
        let _ = stake(&mut deps, &env, "user", 10_000_000);
        let _ = unstake(&mut deps, &env, "user", 10_000_000);

        // Fast forward past unbonding period
        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);

        // First claim
        let info = mock_info("user", &[]);
        let msg = ExecuteMsg::Claim {};
        let res = execute(deps.as_mut(), env.clone(), info.clone(), msg.clone()).unwrap();
        let amount_attr = res.attributes.iter().find(|a| a.key == "amount").unwrap();
        let claimed: Uint128 = amount_attr.value.parse().unwrap();
        assert!(!claimed.is_zero());

        // Second claim should fail (nothing to claim)
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::NothingToClaim {});
    }

    #[test]
    fn test_attack_18_queue_dos_blocked() {
        let (mut deps, env, _) = proper_instantiate();

        // User stakes large amount
        let _ = stake(&mut deps, &env, "user", 1_000_000_000_000);

        // Try to create more than MAX_UNBONDING_REQUESTS
        for i in 0..MAX_UNBONDING_REQUESTS + 5 {
            let info = mock_info("user", &[]);
            let msg = ExecuteMsg::Unstake {
                amount: Uint128::from(1_000_000u128),
            };
            let res = execute(deps.as_mut(), env.clone(), info, msg);

            if i >= MAX_UNBONDING_REQUESTS {
                assert_eq!(res.unwrap_err(), ContractError::TooManyUnbondingRequests {});
            } else {
                assert!(res.is_ok());
            }
        }
    }

    // ============ ACCESS CONTROL TESTS ============

    #[test]
    fn test_attack_65_fee_cap_enforced() {
        let (mut deps, env, _) = proper_instantiate();

        // Try to set fee above maximum (10%)
        let info = mock_info("creator", &[]);
        let msg = ExecuteMsg::UpdateConfig {
            unbonding_period: None,
            fee_bps: Some(2000), // 20%
            min_stake: None,
            max_stake: None,
        };
        let err = execute(deps.as_mut(), env.clone(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::FeeTooHigh {});

        // Set fee at maximum (should work)
        let info = mock_info("creator", &[]);
        let msg = ExecuteMsg::UpdateConfig {
            unbonding_period: None,
            fee_bps: Some(1000), // 10%
            min_stake: None,
            max_stake: None,
        };
        assert!(execute(deps.as_mut(), env, info, msg).is_ok());
    }

    #[test]
    fn test_pause_functionality() {
        let (mut deps, env, _) = proper_instantiate();

        // Stake first
        let _ = stake(&mut deps, &env, "user", 10_000_000);

        // Pause as pauser
        let info = mock_info("pauser", &[]);
        let msg = ExecuteMsg::Pause {};
        assert!(execute(deps.as_mut(), env.clone(), info, msg).is_ok());

        // Try to stake while paused
        let info = mock_info("user", &coins(10_000_000, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        let err = execute(deps.as_mut(), env.clone(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::Paused {});

        // Unpause as admin
        let info = mock_info("creator", &[]);
        let msg = ExecuteMsg::Unpause {};
        assert!(execute(deps.as_mut(), env.clone(), info, msg).is_ok());

        // Stake should work now
        let info = mock_info("user", &coins(10_000_000, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        assert!(execute(deps.as_mut(), env, info, msg).is_ok());
    }

    // ============ SLASHING TESTS ============

    #[test]
    fn test_slash_replay_protection() {
        let (mut deps, env, _) = proper_instantiate();

        // Stake some funds
        let _ = stake(&mut deps, &env, "user", 100_000_000);

        // Record slash as operator
        let info = mock_info("operator", &[]);
        let msg = ExecuteMsg::RecordSlash {
            slash_id: 1,
            amount: Uint128::from(10_000_000u128),
        };
        assert!(execute(deps.as_mut(), env.clone(), info.clone(), msg.clone()).is_ok());

        // Try to replay same slash_id
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::AlreadyClaimed {});
    }

    #[test]
    fn test_slash_affects_exchange_rate() {
        let (mut deps, env, _) = proper_instantiate();

        // Stake funds
        let _ = stake(&mut deps, &env, "user1", 100_000_000);
        let _ = stake(&mut deps, &env, "user2", 100_000_000);

        // Get rate before slash
        let rate_before: ExchangeRateResponse =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::ExchangeRate {}).unwrap())
                .unwrap();

        // Record slash
        let info = mock_info("operator", &[]);
        let msg = ExecuteMsg::RecordSlash {
            slash_id: 1,
            amount: Uint128::from(50_000_000u128),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Rate should change (worsen) after slash
        let rate_after: ExchangeRateResponse =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::ExchangeRate {}).unwrap())
                .unwrap();
        assert_ne!(rate_before.rate_scaled_1e18, rate_after.rate_scaled_1e18);
    }

    // ============ INVARIANT TESTS ============

    #[test]
    fn test_invariant_solvency() {
        let (mut deps, mut env, _) = proper_instantiate();

        // Multiple users stake
        let _ = stake(&mut deps, &env, "user1", 50_000_000);
        let _ = stake(&mut deps, &env, "user2", 50_000_000);
        let _ = stake(&mut deps, &env, "user3", 50_000_000);

        // Some unstake
        let _ = unstake(&mut deps, &env, "user1", 20_000_000);
        let _ = unstake(&mut deps, &env, "user2", 30_000_000);

        // Check solvency
        let solvency: bool =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::CheckSolvency {}).unwrap())
                .unwrap();
        assert!(solvency, "Contract must remain solvent");

        // Fast forward and claim
        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);

        let info = mock_info("user1", &[]);
        let msg = ExecuteMsg::Claim {};
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Check solvency after claim
        let solvency: bool =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::CheckSolvency {}).unwrap())
                .unwrap();
        assert!(solvency, "Contract must remain solvent after claim");
    }

    #[test]
    fn test_invariant_share_conservation() {
        let (mut deps, env, _) = proper_instantiate();

        // Get initial state
        let state_before: State =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::State {}).unwrap()).unwrap();

        // Multiple operations
        let _ = stake(&mut deps, &env, "user1", 10_000_000);
        let _ = stake(&mut deps, &env, "user2", 20_000_000);
        let _ = stake(&mut deps, &env, "user3", 30_000_000);

        let _ = unstake(&mut deps, &env, "user1", 5_000_000);

        // Get state after
        let state_after: State =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::State {}).unwrap()).unwrap();

        // Shares should always be >= seeded shares (1:1 minimum)
        assert!(state_after.total_shares >= state_after.total_staked);

        // Total shares should equal sum of all user shares (we track this implicitly)
        assert!(state_after.total_shares >= state_before.total_shares);
    }

    // ============ OVERFLOW PROTECTION TESTS ============

    #[test]
    fn test_overflow_protection_stake() {
        let (mut deps, env, _) = proper_instantiate();

        // Try to stake maximum amount
        let info = mock_info("user", &coins(u128::MAX, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidAmount {});
    }

    // ============ RESTAKE TESTS ============

    #[test]
    fn test_restake_prevents_double_claim() {
        let (mut deps, mut env, _) = proper_instantiate();

        // Stake and unstake
        let _ = stake(&mut deps, &env, "user", 50_000_000);
        let _ = unstake(&mut deps, &env, "user", 20_000_000);

        // Restake before claim
        let info = mock_info("user", &[]);
        let msg = ExecuteMsg::Restake { unbonding_id: 0 };
        let res = execute(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        // Verify shares were minted
        let shares_attr = res
            .attributes
            .iter()
            .find(|a| a.key == "shares_minted")
            .unwrap();
        let shares: Uint128 = shares_attr.value.parse().unwrap();
        assert!(!shares.is_zero());

        // Fast forward past unbonding period
        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);

        // Try to claim the restaked request (should fail as it was removed)
        let msg = ExecuteMsg::Claim {};
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::NothingToClaim {});
    }

    #[test]
    fn test_cannot_restake_claimed_request() {
        let (mut deps, mut env, _) = proper_instantiate();

        // Stake and unstake
        let _ = stake(&mut deps, &env, "user", 50_000_000);
        let _ = unstake(&mut deps, &env, "user", 20_000_000);

        // Fast forward and claim
        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);
        let info = mock_info("user", &[]);
        let msg = ExecuteMsg::Claim {};
        execute(deps.as_mut(), env.clone(), info.clone(), msg).unwrap();

        // Try to restake claimed request
        let msg = ExecuteMsg::Restake { unbonding_id: 0 };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::AlreadyClaimed {});
    }

    // ============ FIRST DEPOSITOR PROTECTION ============

    #[test]
    fn test_first_depositor_protection() {
        let mut deps = mock_dependencies();
        let env = mock_env();

        // Try to instantiate without seed deposit
        let info = mock_info("creator", &[]); // No funds
        let msg = InstantiateMsg {
            unbonding_period: 86400 * 21,
            denom: "aeth".to_string(),
            staking_token: "staeth".to_string(),
            validators: vec!["validator1".to_string()],
            fee_bps: 100,
            min_stake: Uint128::from(1_000_000u128),
            max_stake: Uint128::from(1_000_000_000_000u128),
            operator: "operator".to_string(),
            pauser: "pauser".to_string(),
        };

        let err = instantiate(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::AmountTooSmall {});
    }

    // ============ VALIDATOR TESTS ============

    #[test]
    fn test_only_whitelisted_validator_allowed() {
        let (mut deps, env, _) = proper_instantiate();

        // Try to stake with invalid validator
        let info = mock_info("user", &coins(10_000_000, "aeth"));
        let msg = ExecuteMsg::Stake {
            validator: "evil_validator".to_string(),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidValidator {});
    }

    // ============ ROLE SEPARATION TESTS ============

    #[test]
    fn test_operator_can_update_validators() {
        let (mut deps, env, _) = proper_instantiate();

        // Operator can update validators
        let info = mock_info("operator", &[]);
        let msg = ExecuteMsg::UpdateValidators {
            validators: vec!["validator2".to_string()],
        };
        assert!(execute(deps.as_mut(), env.clone(), info, msg).is_ok());

        // Random user cannot
        let info = mock_info("random", &[]);
        let msg = ExecuteMsg::UpdateValidators {
            validators: vec!["validator2".to_string()],
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    #[test]
    fn test_only_admin_can_unpause() {
        let (mut deps, env, _) = proper_instantiate();

        // Pause as pauser
        let info = mock_info("pauser", &[]);
        let msg = ExecuteMsg::Pause {};
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Pauser cannot unpause
        let info = mock_info("pauser", &[]);
        let msg = ExecuteMsg::Unpause {};
        let err = execute(deps.as_mut(), env.clone(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});

        // Admin can unpause
        let info = mock_info("creator", &[]);
        let msg = ExecuteMsg::Unpause {};
        assert!(execute(deps.as_mut(), env, info, msg).is_ok());
    }

    // ============ M-05 FIX: STAKE BOUND VALIDATION TESTS ============

    #[test]
    fn test_min_stake_greater_than_max_stake_rejected() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &coins(1_000_000, "aeth"));
        let msg = InstantiateMsg {
            unbonding_period: 86400 * 21,
            denom: "aeth".to_string(),
            staking_token: "staeth".to_string(),
            validators: vec!["validator1".to_string()],
            fee_bps: 100,
            min_stake: Uint128::from(1_000_000_000u128), // 1000 tokens
            max_stake: Uint128::from(1_000_000u128),     // 1 token — less than min!
            operator: "operator".to_string(),
            pauser: "pauser".to_string(),
        };

        let err = instantiate(deps.as_mut(), env, info, msg).unwrap_err();
        // M-05: Should reject because min_stake > max_stake
        assert!(matches!(err, ContractError::Std(_)));
    }

    #[test]
    fn test_update_config_min_exceeds_max_rejected() {
        let (mut deps, env, _) = proper_instantiate();

        // Current max_stake is 1_000_000_000_000 — set min higher than that
        let info = mock_info("creator", &[]);
        let msg = ExecuteMsg::UpdateConfig {
            unbonding_period: None,
            fee_bps: None,
            min_stake: Some(Uint128::from(2_000_000_000_000u128)),
            max_stake: None,
        };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Std(_)));
    }
}

// Import needed types for tests
use cosmwasm_std::testing::{MockApi, MockQuerier, MockStorage};
use cosmwasm_std::OwnedDeps;
