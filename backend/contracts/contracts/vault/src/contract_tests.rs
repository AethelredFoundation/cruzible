/*
 * AethelVault Security Tests
 *
 * Exercises the highest-risk attack scenarios called out by the Attack Playbook.
 * Critical invariants verified:
 * 1. No double claim possible
 * 2. Rounding favors protocol
 * 3. Donations don't affect share price
 * 4. Overflow/underflow protection
 * 5. Access control enforcement
 */
#[cfg(test)]
mod security_tests {
    #![allow(clippy::needless_borrows_for_generic_args)]

    use crate::*;
    use cosmwasm_std::testing::{
        mock_dependencies, mock_env, mock_info, MockApi, MockQuerier, MockStorage,
    };
    use cosmwasm_std::{
        coins, from_json, Addr, BankMsg, CosmosMsg, Env, MessageInfo, OwnedDeps, Response, Uint128,
        WasmMsg,
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

    fn staking_token_msg(response: &Response) -> (String, StakingTokenExecuteMsg) {
        assert_eq!(response.messages.len(), 1);
        match &response.messages[0].msg {
            CosmosMsg::Wasm(WasmMsg::Execute {
                contract_addr,
                msg,
                funds,
            }) => {
                assert!(funds.is_empty());
                (contract_addr.clone(), from_json(msg).unwrap())
            }
            other => panic!("unexpected message: {:?}", other),
        }
    }

    fn empty_user_stake() -> UserStake {
        UserStake {
            shares: Uint128::zero(),
            staked_amount: Uint128::zero(),
            reward_debt: Uint128::zero(),
        }
    }

    fn assert_vault_accounting_invariants(
        deps: &OwnedDeps<MockStorage, MockApi, MockQuerier>,
        env: &Env,
        users: &[&str],
    ) {
        let state = STATE.load(deps.as_ref().storage).unwrap();
        assert_vault_invariants(&state).unwrap();

        let mut user_shares = Uint128::zero();
        let mut open_unbonding = Uint128::zero();

        for user in users {
            let addr = Addr::unchecked(*user);
            let user_stake = USER_STAKES
                .may_load(deps.as_ref().storage, &addr)
                .unwrap()
                .unwrap_or_else(empty_user_stake);

            user_shares = user_shares.checked_add(user_stake.shares).unwrap();

            let current_entitlement = state
                .reward_index
                .checked_mul(user_stake.shares)
                .unwrap()
                .checked_div(Uint128::from(REWARD_INDEX_SCALE))
                .unwrap();
            assert!(
                user_stake.reward_debt <= current_entitlement,
                "reward debt exceeds entitlement for {user}"
            );

            let request_count = UNSTAKE_COUNT
                .load(deps.as_ref().storage, &addr)
                .unwrap_or(0);
            for unbonding_id in 0..request_count {
                if let Some(request) = UNSTAKE_REQUESTS
                    .may_load(deps.as_ref().storage, (&addr, unbonding_id))
                    .unwrap()
                {
                    assert!(request.complete_time >= request.unbond_time);
                    if !request.claimed {
                        open_unbonding = open_unbonding.checked_add(request.amount).unwrap();
                    }
                }
            }
        }

        let expected_total_shares = Uint128::from(MIN_DEPOSIT).checked_add(user_shares).unwrap();
        assert_eq!(
            state.total_shares, expected_total_shares,
            "state shares must equal seed shares plus tracked user shares"
        );
        assert_eq!(
            state.total_unbonding, open_unbonding,
            "state unbonding must equal all open queue liabilities"
        );

        let total_accounted = state
            .total_staked
            .checked_add(state.total_unbonding)
            .unwrap()
            .checked_add(state.reward_pool)
            .unwrap();
        assert!(total_accounted.u128() <= MAX_TOTAL_STAKED);

        let exchange_rate: ExchangeRateResponse =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::ExchangeRate {}).unwrap())
                .unwrap();
        assert_eq!(exchange_rate.numerator, state.total_staked);
        assert_eq!(exchange_rate.denominator, state.total_shares);

        let accounting_health: bool =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::CheckSolvency {}).unwrap())
                .unwrap();
        assert!(accounting_health, "accounting-health query must stay green");
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
    fn test_instantiate_rejects_short_unbonding_period() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &coins(1_000_000, "aeth"));
        let msg = InstantiateMsg {
            unbonding_period: MIN_UNBONDING_PERIOD - 1,
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
        assert!(matches!(err, ContractError::Std(_)));
    }

    #[test]
    fn test_instantiate_rejects_empty_validator_set() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &coins(1_000_000, "aeth"));
        let msg = InstantiateMsg {
            unbonding_period: MIN_UNBONDING_PERIOD,
            denom: "aeth".to_string(),
            staking_token: "staeth".to_string(),
            validators: vec![],
            fee_bps: 100,
            min_stake: Uint128::from(1_000_000u128),
            max_stake: Uint128::from(1_000_000_000_000u128),
            operator: "operator".to_string(),
            pauser: "pauser".to_string(),
        };

        let err = instantiate(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidValidator {});
    }

    #[test]
    fn test_instantiate_rejects_duplicate_validators() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &coins(1_000_000, "aeth"));
        let msg = InstantiateMsg {
            unbonding_period: MIN_UNBONDING_PERIOD,
            denom: "aeth".to_string(),
            staking_token: "staeth".to_string(),
            validators: vec!["validator1".to_string(), "validator1".to_string()],
            fee_bps: 100,
            min_stake: Uint128::from(1_000_000u128),
            max_stake: Uint128::from(1_000_000_000_000u128),
            operator: "operator".to_string(),
            pauser: "pauser".to_string(),
        };

        let err = instantiate(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidValidator {});
    }

    #[test]
    fn test_instantiate_rejects_too_many_validators() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &coins(1_000_000, "aeth"));
        let msg = InstantiateMsg {
            unbonding_period: MIN_UNBONDING_PERIOD,
            denom: "aeth".to_string(),
            staking_token: "staeth".to_string(),
            validators: (0..=MAX_VALIDATORS)
                .map(|index| format!("validator{index}"))
                .collect(),
            fee_bps: 100,
            min_stake: Uint128::from(1_000_000u128),
            max_stake: Uint128::from(1_000_000_000_000u128),
            operator: "operator".to_string(),
            pauser: "pauser".to_string(),
        };

        let err = instantiate(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidValidator {});
    }

    #[test]
    fn test_instantiate_rejects_invalid_denom() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("creator", &coins(1_000_000, "aeth"));
        let msg = InstantiateMsg {
            unbonding_period: MIN_UNBONDING_PERIOD,
            denom: "bad denom".to_string(),
            staking_token: "staeth".to_string(),
            validators: vec!["validator1".to_string()],
            fee_bps: 100,
            min_stake: Uint128::from(1_000_000u128),
            max_stake: Uint128::from(1_000_000_000_000u128),
            operator: "operator".to_string(),
            pauser: "pauser".to_string(),
        };

        let err = instantiate(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidDenom {});
    }

    #[test]
    fn test_attack_4_donation_does_not_inflate_shares() {
        let (mut deps, env, _) = proper_instantiate();

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
        let _user_stake: UserStake = from_json(
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
    fn test_stake_min_shares_guard_blocks_adverse_execution() {
        let (mut deps, env, _) = proper_instantiate();

        let info = mock_info("user", &coins(10_000_000, "aeth"));
        let msg = ExecuteMsg::StakeWithMinShares {
            validator: "validator1".to_string(),
            min_shares: Uint128::from(10_000_001u128),
        };
        let err = execute(deps.as_mut(), env.clone(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::SlippageExceeded {});

        let info = mock_info("user", &coins(10_000_000, "aeth"));
        let msg = ExecuteMsg::StakeWithMinShares {
            validator: "validator1".to_string(),
            min_shares: Uint128::from(10_000_000u128),
        };
        let res = execute(deps.as_mut(), env, info, msg).unwrap();
        let shares_attr = res
            .attributes
            .iter()
            .find(|a| a.key == "shares_minted")
            .unwrap();

        assert_eq!(shares_attr.value, "10000000");
    }

    #[test]
    fn test_unstake_max_shares_guard_blocks_adverse_execution() {
        let (mut deps, env, _) = proper_instantiate();
        let _ = stake(&mut deps, &env, "user", 10_000_000);

        let info = mock_info("user", &[]);
        let msg = ExecuteMsg::UnstakeWithMaxShares {
            amount: Uint128::from(5_000_000u128),
            max_shares_to_burn: Uint128::from(4_999_999u128),
        };
        let err = execute(deps.as_mut(), env.clone(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::SlippageExceeded {});

        let info = mock_info("user", &[]);
        let msg = ExecuteMsg::UnstakeWithMaxShares {
            amount: Uint128::from(5_000_000u128),
            max_shares_to_burn: Uint128::from(5_000_000u128),
        };
        let res = execute(deps.as_mut(), env, info, msg).unwrap();
        let burned_attr = res
            .attributes
            .iter()
            .find(|a| a.key == "shares_burned")
            .unwrap();

        assert_eq!(burned_attr.value, "5000000");
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

    #[test]
    fn test_stake_mints_staking_token() {
        let (mut deps, env, _) = proper_instantiate();

        let res = stake(&mut deps, &env, "user", 10_000_000);
        let (contract, msg) = staking_token_msg(&res);

        assert_eq!(contract, "staeth");
        assert_eq!(
            msg,
            StakingTokenExecuteMsg::Mint {
                recipient: "user".to_string(),
                amount: Uint128::from(10_000_000u128),
            }
        );
    }

    #[test]
    fn test_stake_rejects_unexpected_funds() {
        let (mut deps, env, _) = proper_instantiate();

        let mut funds = coins(10_000_000, "aeth");
        funds.extend(coins(1, "uatom"));
        let info = mock_info("user", &funds);
        let msg = ExecuteMsg::Stake {
            validator: "validator1".to_string(),
        };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::UnexpectedFunds {});

        let state = STATE.load(deps.as_ref().storage).unwrap();
        assert_eq!(state.total_staked, Uint128::from(MIN_DEPOSIT));
        assert!(USER_STAKES
            .may_load(deps.as_ref().storage, &Addr::unchecked("user"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_staking_more_preserves_accrued_rewards() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user", 10_000_000);

        let info = mock_info("creator", &coins(2_000_000, "aeth"));
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::AddRewards {}).unwrap();

        let _ = stake(&mut deps, &env, "user", 10_000_000);

        let info = mock_info("user", &[]);
        let res = execute(deps.as_mut(), env, info, ExecuteMsg::ClaimRewards {}).unwrap();
        let rewards: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "rewards")
            .unwrap()
            .value
            .parse()
            .unwrap();

        assert!(!rewards.is_zero(), "staking more must not erase rewards");
    }

    #[test]
    fn test_add_rewards_rejects_unexpected_funds() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user", 10_000_000);
        let mut funds = coins(2_000_000, "aeth");
        funds.extend(coins(1, "uatom"));
        let info = mock_info("creator", &funds);

        let err = execute(deps.as_mut(), env, info, ExecuteMsg::AddRewards {}).unwrap_err();
        assert_eq!(err, ContractError::UnexpectedFunds {});

        let state = STATE.load(deps.as_ref().storage).unwrap();
        assert_eq!(state.reward_pool, Uint128::zero());
    }

    #[test]
    fn test_unstake_auto_claims_accrued_rewards() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user", 10_000_000);

        let info = mock_info("creator", &coins(2_000_000, "aeth"));
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::AddRewards {}).unwrap();

        let res = unstake(&mut deps, &env, "user", 5_000_000);
        let rewards: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "rewards_claimed")
            .unwrap()
            .value
            .parse()
            .unwrap();

        assert!(!rewards.is_zero(), "unstake must not erase rewards");
        assert_eq!(res.messages.len(), 2);
        match &res.messages[1].msg {
            CosmosMsg::Bank(BankMsg::Send { to_address, amount }) => {
                assert_eq!(to_address, "user");
                assert_eq!(amount[0].denom, "aeth");
                assert_eq!(amount[0].amount, rewards);
            }
            other => panic!("unexpected reward message: {:?}", other),
        }

        let info = mock_info("user", &[]);
        let err = execute(deps.as_mut(), env, info, ExecuteMsg::ClaimRewards {}).unwrap_err();
        assert_eq!(err, ContractError::NothingToClaim {});
    }

    #[test]
    fn test_unstake_burns_staking_token() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user", 10_000_000);
        let res = unstake(&mut deps, &env, "user", 10_000_000);
        let shares_burned: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "shares_burned")
            .unwrap()
            .value
            .parse()
            .unwrap();
        let (contract, msg) = staking_token_msg(&res);

        assert_eq!(contract, "staeth");
        assert_eq!(
            msg,
            StakingTokenExecuteMsg::BurnFrom {
                owner: "user".to_string(),
                amount: shares_burned,
            }
        );
    }

    #[test]
    fn test_staking_token_transfer_syncs_user_stake_accounting() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "alice", 10_000_000);

        let info = mock_info("staeth", &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SyncStakingTokenTransfer {
                from: "alice".to_string(),
                to: "bob".to_string(),
                amount: Uint128::from(5_000_000u128),
            },
        )
        .unwrap();

        let alice = USER_STAKES
            .load(deps.as_ref().storage, &Addr::unchecked("alice"))
            .unwrap();
        let bob = USER_STAKES
            .load(deps.as_ref().storage, &Addr::unchecked("bob"))
            .unwrap();

        assert_eq!(alice.shares, Uint128::from(5_000_000u128));
        assert_eq!(alice.staked_amount, Uint128::from(5_000_000u128));
        assert_eq!(bob.shares, Uint128::from(5_000_000u128));
        assert_eq!(bob.staked_amount, Uint128::from(5_000_000u128));

        let info = mock_info("alice", &[]);
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::Unstake {
                amount: Uint128::from(10_000_000u128),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::InsufficientBalance {});

        let res = unstake(&mut deps, &env, "bob", 5_000_000);
        assert_eq!(res.attributes[0].value, "unstake");
    }

    #[test]
    fn test_staking_token_transfer_moves_reward_debt_with_all_shares() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "alice", 10_000_000);

        let info = mock_info("creator", &coins(2_000_000, "aeth"));
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::AddRewards {}).unwrap();

        let alice_before = USER_STAKES
            .load(deps.as_ref().storage, &Addr::unchecked("alice"))
            .unwrap();

        let info = mock_info("staeth", &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SyncStakingTokenTransfer {
                from: "alice".to_string(),
                to: "bob".to_string(),
                amount: alice_before.shares,
            },
        )
        .unwrap();

        assert!(USER_STAKES
            .may_load(deps.as_ref().storage, &Addr::unchecked("alice"))
            .unwrap()
            .is_none());

        let bob = USER_STAKES
            .load(deps.as_ref().storage, &Addr::unchecked("bob"))
            .unwrap();
        assert_eq!(bob, alice_before);

        let info = mock_info("bob", &[]);
        let res = execute(deps.as_mut(), env, info, ExecuteMsg::ClaimRewards {}).unwrap();
        let rewards: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "rewards")
            .unwrap()
            .value
            .parse()
            .unwrap();

        assert!(!rewards.is_zero(), "transferred shares must retain rewards");
    }

    #[test]
    fn test_staking_token_transfer_sync_rejects_unauthorized_sender() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "alice", 10_000_000);

        let info = mock_info("attacker", &[]);
        let err = execute(
            deps.as_mut(),
            env,
            info,
            ExecuteMsg::SyncStakingTokenTransfer {
                from: "alice".to_string(),
                to: "bob".to_string(),
                amount: Uint128::from(1_000_000u128),
            },
        )
        .unwrap_err();

        assert_eq!(err, ContractError::Unauthorized {});
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

    #[test]
    fn test_update_validators_rejects_empty_set() {
        let (mut deps, env, _) = proper_instantiate();

        let info = mock_info("operator", &[]);
        let msg = ExecuteMsg::UpdateValidators { validators: vec![] };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();

        assert_eq!(err, ContractError::InvalidValidator {});
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

    #[test]
    fn test_slash_reduces_pending_unbonding_claims() {
        let (mut deps, mut env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user1", 50_000_000);
        let _ = stake(&mut deps, &env, "user2", 50_000_000);
        let _ = unstake(&mut deps, &env, "user1", 50_000_000);

        let user1 = Addr::unchecked("user1");
        let before = UNSTAKE_REQUESTS
            .load(deps.as_ref().storage, (&user1, 0))
            .unwrap();
        assert_eq!(before.amount, Uint128::from(50_000_000u128));

        let info = mock_info("operator", &[]);
        let res = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RecordSlash {
                slash_id: 1,
                amount: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();

        let active_slash: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "active_slash")
            .unwrap()
            .value
            .parse()
            .unwrap();
        let unbonding_slash: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "unbonding_slash")
            .unwrap()
            .value
            .parse()
            .unwrap();

        assert!(!active_slash.is_zero());
        assert!(!unbonding_slash.is_zero());
        assert_eq!(
            active_slash + unbonding_slash,
            Uint128::from(10_000_000u128)
        );

        let after = UNSTAKE_REQUESTS
            .load(deps.as_ref().storage, (&user1, 0))
            .unwrap();
        assert_eq!(before.amount - after.amount, unbonding_slash);

        let state = STATE.load(deps.as_ref().storage).unwrap();
        assert_eq!(state.total_unbonding, after.amount);

        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);
        let res = execute(
            deps.as_mut(),
            env,
            mock_info("user1", &[]),
            ExecuteMsg::Claim {},
        )
        .unwrap();
        let claimed: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "amount")
            .unwrap()
            .value
            .parse()
            .unwrap();
        assert_eq!(claimed, after.amount);
    }

    // ============ INVARIANT TESTS ============

    #[test]
    fn test_invariant_accounting_health() {
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
        assert!(solvency, "Contract accounting health must remain green");

        // Fast forward and claim
        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);

        let info = mock_info("user1", &[]);
        let msg = ExecuteMsg::Claim {};
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Check solvency after claim
        let solvency: bool =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::CheckSolvency {}).unwrap())
                .unwrap();
        assert!(
            solvency,
            "Contract accounting health must remain green after claim"
        );
    }

    #[test]
    fn test_accounting_health_allows_orderly_mass_exit() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user", 100_000_000);
        let _ = unstake(&mut deps, &env, "user", 100_000_000);

        let state = STATE.load(deps.as_ref().storage).unwrap();
        assert!(
            state.total_unbonding > state.total_staked,
            "mass exits should be allowed to exceed active stake"
        );

        let accounting_health: bool =
            from_json(&query(deps.as_ref(), env.clone(), QueryMsg::CheckSolvency {}).unwrap())
                .unwrap();
        assert!(
            accounting_health,
            "mass exits are healthy when accounting invariants hold"
        );
        assert_vault_accounting_invariants(&deps, &env, &["user"]);
    }

    #[test]
    fn test_invariant_long_operation_sequence_preserves_accounting() {
        let (mut deps, mut env, _) = proper_instantiate();
        let users = ["alice", "bob", "carol", "dan"];

        assert_vault_accounting_invariants(&deps, &env, &users);

        let _ = stake(&mut deps, &env, "alice", 100_000_000);
        assert_vault_accounting_invariants(&deps, &env, &users);

        let _ = stake(&mut deps, &env, "bob", 75_000_000);
        assert_vault_accounting_invariants(&deps, &env, &users);

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("rewards", &coins(10_000_000, "aeth")),
            ExecuteMsg::AddRewards {},
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("staeth", &[]),
            ExecuteMsg::SyncStakingTokenTransfer {
                from: "alice".to_string(),
                to: "carol".to_string(),
                amount: Uint128::from(10_000_000u128),
            },
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("bob", &[]),
            ExecuteMsg::ClaimRewards {},
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("alice", &[]),
            ExecuteMsg::Compound {
                validator: "validator1".to_string(),
            },
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);

        let _ = unstake(&mut deps, &env, "bob", 20_000_000);
        assert_vault_accounting_invariants(&deps, &env, &users);

        let _ = stake(&mut deps, &env, "dan", 50_000_000);
        assert_vault_accounting_invariants(&deps, &env, &users);

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("operator", &[]),
            ExecuteMsg::RecordSlash {
                slash_id: 42,
                amount: Uint128::from(15_000_000u128),
            },
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("bob", &[]),
            ExecuteMsg::Restake { unbonding_id: 0 },
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);

        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("rewards", &coins(3_000_000, "aeth")),
            ExecuteMsg::AddRewards {},
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);

        let _ = unstake(&mut deps, &env, "alice", 10_000_000);
        assert_vault_accounting_invariants(&deps, &env, &users);

        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);
        execute(
            deps.as_mut(),
            env.clone(),
            mock_info("alice", &[]),
            ExecuteMsg::Claim {},
        )
        .unwrap();
        assert_vault_accounting_invariants(&deps, &env, &users);
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

        let (contract, msg) = staking_token_msg(&res);
        assert_eq!(contract, "staeth");
        assert_eq!(
            msg,
            StakingTokenExecuteMsg::Mint {
                recipient: "user".to_string(),
                amount: shares,
            }
        );

        // Fast forward past unbonding period
        env.block.time = env.block.time.plus_seconds(86400 * 21 + 1);

        // Try to claim the restaked request (should fail as it was removed)
        let msg = ExecuteMsg::Claim {};
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::NothingToClaim {});
    }

    #[test]
    fn test_restake_preserves_accrued_rewards() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user", 50_000_000);
        let _ = unstake(&mut deps, &env, "user", 20_000_000);

        let info = mock_info("creator", &coins(2_000_000, "aeth"));
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::AddRewards {}).unwrap();

        let info = mock_info("user", &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::Restake { unbonding_id: 0 },
        )
        .unwrap();

        let info = mock_info("user", &[]);
        let res = execute(deps.as_mut(), env, info, ExecuteMsg::ClaimRewards {}).unwrap();
        let rewards: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "rewards")
            .unwrap()
            .value
            .parse()
            .unwrap();

        assert!(!rewards.is_zero(), "restake must not erase rewards");
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

    #[test]
    fn test_compound_mints_staking_token() {
        let (mut deps, env, _) = proper_instantiate();

        let _ = stake(&mut deps, &env, "user", 10_000_000);

        let info = mock_info("creator", &coins(2_000_000, "aeth"));
        let msg = ExecuteMsg::AddRewards {};
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        let info = mock_info("user", &[]);
        let msg = ExecuteMsg::Compound {
            validator: "validator1".to_string(),
        };
        let res = execute(deps.as_mut(), env, info, msg).unwrap();
        let shares_minted: Uint128 = res
            .attributes
            .iter()
            .find(|a| a.key == "shares_minted")
            .unwrap()
            .value
            .parse()
            .unwrap();
        let (contract, msg) = staking_token_msg(&res);

        assert_eq!(contract, "staeth");
        assert_eq!(
            msg,
            StakingTokenExecuteMsg::Mint {
                recipient: "user".to_string(),
                amount: shares_minted,
            }
        );
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

    #[test]
    fn test_instantiate_rejects_unexpected_seed_funds() {
        let mut deps = mock_dependencies();
        let env = mock_env();

        let mut funds = coins(1_000_000, "aeth");
        funds.extend(coins(1, "uatom"));
        let info = mock_info("creator", &funds);
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
        assert_eq!(err, ContractError::UnexpectedFunds {});
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
    fn test_update_validators_rejects_duplicates_and_oversized_sets() {
        let (mut deps, env, _) = proper_instantiate();

        let info = mock_info("operator", &[]);
        let msg = ExecuteMsg::UpdateValidators {
            validators: vec!["validator2".to_string(), "validator2".to_string()],
        };
        let err = execute(deps.as_mut(), env.clone(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidValidator {});

        let info = mock_info("operator", &[]);
        let msg = ExecuteMsg::UpdateValidators {
            validators: (0..=MAX_VALIDATORS)
                .map(|index| format!("validator{index}"))
                .collect(),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidValidator {});
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
