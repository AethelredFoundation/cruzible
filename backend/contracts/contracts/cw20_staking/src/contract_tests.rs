/**
 * CW20 Staking Token — Comprehensive Test Suite
 *
 * Enterprise-grade tests covering:
 * - Instantiation and initial state
 * - Transfer (including self-transfer guard)
 * - Mint (authorization, cap enforcement)
 * - Burn (balance checks, supply updates)
 * - Allowance lifecycle (increase, decrease, transfer_from, burn_from)
 * - Expiration handling
 * - Send with callback
 * - Minter management
 * - Query endpoints
 * - Migration
 * - Edge cases and security boundaries
 */

#[cfg(test)]
mod tests {
    use crate::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info, MockApi, MockQuerier, MockStorage};
    use cosmwasm_std::{from_json, Addr, Uint128, OwnedDeps, Env, Binary};

    // ============ TEST HELPERS ============

    fn default_instantiate() -> (OwnedDeps<MockStorage, MockApi, MockQuerier>, Env) {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("minter", &[]);
        let msg = InstantiateMsg {
            name: "Staked AETHEL".to_string(),
            symbol: "stAETHEL".to_string(),
            decimals: 6,
            initial_supply: Uint128::from(1_000_000_000u128),
            minter: "minter".to_string(),
            cap: Some(Uint128::from(10_000_000_000u128)),
        };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        (deps, env)
    }

    fn instantiate_no_cap() -> (OwnedDeps<MockStorage, MockApi, MockQuerier>, Env) {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("minter", &[]);
        let msg = InstantiateMsg {
            name: "Staked AETHEL".to_string(),
            symbol: "stAETHEL".to_string(),
            decimals: 6,
            initial_supply: Uint128::from(1_000_000u128),
            minter: "minter".to_string(),
            cap: None,
        };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        (deps, env)
    }

    fn query_balance(deps: &OwnedDeps<MockStorage, MockApi, MockQuerier>, env: &Env, addr: &str) -> Uint128 {
        let res = query(deps.as_ref(), env.clone(), QueryMsg::Balance { address: addr.to_string() }).unwrap();
        let bal: BalanceResponse = from_json(&res).unwrap();
        bal.balance
    }

    fn query_supply(deps: &OwnedDeps<MockStorage, MockApi, MockQuerier>, env: &Env) -> Uint128 {
        let res = query(deps.as_ref(), env.clone(), QueryMsg::TokenInfo {}).unwrap();
        let info: TokenInfoResponse = from_json(&res).unwrap();
        info.total_supply
    }

    // ============ INSTANTIATION TESTS ============

    #[test]
    fn test_instantiate_sets_token_info() {
        let (deps, env) = default_instantiate();
        let res = query(deps.as_ref(), env.clone(), QueryMsg::TokenInfo {}).unwrap();
        let info: TokenInfoResponse = from_json(&res).unwrap();
        assert_eq!(info.name, "Staked AETHEL");
        assert_eq!(info.symbol, "stAETHEL");
        assert_eq!(info.decimals, 6);
        assert_eq!(info.total_supply, Uint128::from(1_000_000_000u128));
    }

    #[test]
    fn test_instantiate_sets_minter_balance() {
        let (deps, env) = default_instantiate();
        assert_eq!(query_balance(&deps, &env, "minter"), Uint128::from(1_000_000_000u128));
    }

    #[test]
    fn test_instantiate_with_zero_supply() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("minter", &[]);
        let msg = InstantiateMsg {
            name: "Test".to_string(),
            symbol: "TST".to_string(),
            decimals: 6,
            initial_supply: Uint128::zero(),
            minter: "minter".to_string(),
            cap: None,
        };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        assert_eq!(query_balance(&deps, &env, "minter"), Uint128::zero());
        assert_eq!(query_supply(&deps, &env), Uint128::zero());
    }

    #[test]
    fn test_instantiate_sets_minter_info() {
        let (deps, env) = default_instantiate();
        let res = query(deps.as_ref(), env.clone(), QueryMsg::Minter {}).unwrap();
        let minter: Option<MinterData> = from_json(&res).unwrap();
        assert!(minter.is_some());
        let m = minter.unwrap();
        assert_eq!(m.minter, Addr::unchecked("minter"));
        assert_eq!(m.cap, Some(Uint128::from(10_000_000_000u128)));
    }

    // ============ TRANSFER TESTS ============

    #[test]
    fn test_transfer_success() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Transfer {
            recipient: "alice".to_string(),
            amount: Uint128::from(500u128),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();
        assert_eq!(query_balance(&deps, &env, "alice"), Uint128::from(500u128));
        assert_eq!(query_balance(&deps, &env, "minter"), Uint128::from(999_999_500u128));
    }

    #[test]
    fn test_transfer_zero_amount_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Transfer {
            recipient: "alice".to_string(),
            amount: Uint128::zero(),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidZeroAmount {});
    }

    #[test]
    fn test_transfer_insufficient_balance() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("nobody", &[]);
        let msg = ExecuteMsg::Transfer {
            recipient: "alice".to_string(),
            amount: Uint128::from(100u128),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        // Should fail with overflow/underflow in checked_sub
        assert!(matches!(err, ContractError::Std(_)));
    }

    #[test]
    fn test_self_transfer_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Transfer {
            recipient: "minter".to_string(),
            amount: Uint128::from(100u128),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::CannotTransferToSelf {});
    }

    #[test]
    fn test_transfer_preserves_total_supply() {
        let (mut deps, env) = default_instantiate();
        let supply_before = query_supply(&deps, &env);
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Transfer {
            recipient: "alice".to_string(),
            amount: Uint128::from(500u128),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();
        let supply_after = query_supply(&deps, &env);
        assert_eq!(supply_before, supply_after);
    }

    // ============ MINT TESTS ============

    #[test]
    fn test_mint_success() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Mint {
            recipient: "alice".to_string(),
            amount: Uint128::from(1000u128),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();
        assert_eq!(query_balance(&deps, &env, "alice"), Uint128::from(1000u128));
        assert_eq!(query_supply(&deps, &env), Uint128::from(1_000_001_000u128));
    }

    #[test]
    fn test_mint_unauthorized() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("not_minter", &[]);
        let msg = ExecuteMsg::Mint {
            recipient: "alice".to_string(),
            amount: Uint128::from(1000u128),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    #[test]
    fn test_mint_exceeds_cap() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        // Cap is 10B, already 1B minted. Try to mint 10B more.
        let msg = ExecuteMsg::Mint {
            recipient: "alice".to_string(),
            amount: Uint128::from(10_000_000_000u128),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::CannotExceedCap {});
    }

    #[test]
    fn test_mint_zero_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Mint {
            recipient: "alice".to_string(),
            amount: Uint128::zero(),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidZeroAmount {});
    }

    #[test]
    fn test_mint_no_cap_unlimited() {
        let (mut deps, env) = instantiate_no_cap();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Mint {
            recipient: "alice".to_string(),
            amount: Uint128::from(999_999_999_999u128),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();
        assert_eq!(query_balance(&deps, &env, "alice"), Uint128::from(999_999_999_999u128));
    }

    // ============ BURN TESTS ============

    #[test]
    fn test_burn_success() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Burn {
            amount: Uint128::from(500u128),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();
        assert_eq!(query_balance(&deps, &env, "minter"), Uint128::from(999_999_500u128));
        assert_eq!(query_supply(&deps, &env), Uint128::from(999_999_500u128));
    }

    #[test]
    fn test_burn_zero_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Burn { amount: Uint128::zero() };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidZeroAmount {});
    }

    #[test]
    fn test_burn_exceeds_balance() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("nobody", &[]);
        let msg = ExecuteMsg::Burn { amount: Uint128::from(100u128) };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Std(_)));
    }

    // ============ ALLOWANCE TESTS ============

    #[test]
    fn test_increase_allowance() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::IncreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(500u128),
            expires: None,
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        let res = query(deps.as_ref(), env.clone(), QueryMsg::Allowance {
            owner: "minter".to_string(),
            spender: "spender".to_string(),
        }).unwrap();
        let allow: AllowanceResponse = from_json(&res).unwrap();
        assert_eq!(allow.allowance, Uint128::from(500u128));
    }

    #[test]
    fn test_increase_allowance_self_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::IncreaseAllowance {
            spender: "minter".to_string(),
            amount: Uint128::from(500u128),
            expires: None,
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::CannotSetOwnAccount {});
    }

    #[test]
    fn test_decrease_allowance() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);

        // First increase
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::IncreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(500u128),
            expires: None,
        }).unwrap();

        // Then decrease
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::DecreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(200u128),
            expires: None,
        }).unwrap();

        let res = query(deps.as_ref(), env.clone(), QueryMsg::Allowance {
            owner: "minter".to_string(),
            spender: "spender".to_string(),
        }).unwrap();
        let allow: AllowanceResponse = from_json(&res).unwrap();
        assert_eq!(allow.allowance, Uint128::from(300u128));
    }

    #[test]
    fn test_decrease_allowance_self_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::DecreaseAllowance {
            spender: "minter".to_string(),
            amount: Uint128::from(100u128),
            expires: None,
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::CannotSetOwnAccount {});
    }

    #[test]
    fn test_transfer_from_success() {
        let (mut deps, env) = default_instantiate();

        // Approve spender
        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::IncreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(500u128),
            expires: None,
        }).unwrap();

        // Spender transfers from minter to alice
        let info = mock_info("spender", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::TransferFrom {
            owner: "minter".to_string(),
            recipient: "alice".to_string(),
            amount: Uint128::from(300u128),
        }).unwrap();

        assert_eq!(query_balance(&deps, &env, "alice"), Uint128::from(300u128));
        assert_eq!(query_balance(&deps, &env, "minter"), Uint128::from(999_999_700u128));

        // Allowance should be reduced
        let res = query(deps.as_ref(), env.clone(), QueryMsg::Allowance {
            owner: "minter".to_string(),
            spender: "spender".to_string(),
        }).unwrap();
        let allow: AllowanceResponse = from_json(&res).unwrap();
        assert_eq!(allow.allowance, Uint128::from(200u128));
    }

    #[test]
    fn test_transfer_from_self_transfer_rejected() {
        let (mut deps, env) = default_instantiate();

        // Approve spender
        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::IncreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(500u128),
            expires: None,
        }).unwrap();

        // Spender tries to transfer from minter to minter (self-transfer via allowance)
        let info = mock_info("spender", &[]);
        let err = execute(deps.as_mut(), env, info, ExecuteMsg::TransferFrom {
            owner: "minter".to_string(),
            recipient: "minter".to_string(),
            amount: Uint128::from(100u128),
        }).unwrap_err();
        assert_eq!(err, ContractError::CannotTransferToSelf {});
    }

    #[test]
    fn test_transfer_from_exceeds_allowance() {
        let (mut deps, env) = default_instantiate();

        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::IncreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(100u128),
            expires: None,
        }).unwrap();

        let info = mock_info("spender", &[]);
        let err = execute(deps.as_mut(), env, info, ExecuteMsg::TransferFrom {
            owner: "minter".to_string(),
            recipient: "alice".to_string(),
            amount: Uint128::from(200u128),
        }).unwrap_err();
        assert!(matches!(err, ContractError::Std(_)));
    }

    #[test]
    fn test_transfer_from_expired_allowance() {
        let (mut deps, mut env) = default_instantiate();

        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::IncreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(500u128),
            expires: Some(Expiration::AtHeight(100)),
        }).unwrap();

        // Advance past expiration
        env.block.height = 200;

        let info = mock_info("spender", &[]);
        let err = execute(deps.as_mut(), env, info, ExecuteMsg::TransferFrom {
            owner: "minter".to_string(),
            recipient: "alice".to_string(),
            amount: Uint128::from(100u128),
        }).unwrap_err();
        assert!(matches!(err, ContractError::Std(_)));
    }

    // ============ BURN FROM TESTS ============

    #[test]
    fn test_burn_from_success() {
        let (mut deps, env) = default_instantiate();

        // Approve spender to burn
        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::IncreaseAllowance {
            spender: "burner".to_string(),
            amount: Uint128::from(500u128),
            expires: None,
        }).unwrap();

        // Burner burns from minter
        let info = mock_info("burner", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::BurnFrom {
            owner: "minter".to_string(),
            amount: Uint128::from(300u128),
        }).unwrap();

        assert_eq!(query_balance(&deps, &env, "minter"), Uint128::from(999_999_700u128));
        assert_eq!(query_supply(&deps, &env), Uint128::from(999_999_700u128));
    }

    #[test]
    fn test_burn_from_zero_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("burner", &[]);
        let err = execute(deps.as_mut(), env, info, ExecuteMsg::BurnFrom {
            owner: "minter".to_string(),
            amount: Uint128::zero(),
        }).unwrap_err();
        assert_eq!(err, ContractError::InvalidZeroAmount {});
    }

    // ============ SEND TESTS ============

    #[test]
    fn test_send_self_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Send {
            contract: "minter".to_string(),
            amount: Uint128::from(100u128),
            msg: Binary::from(b"{}"),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::CannotTransferToSelf {});
    }

    #[test]
    fn test_send_zero_rejected() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Send {
            contract: "contract".to_string(),
            amount: Uint128::zero(),
            msg: Binary::from(b"{}"),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidZeroAmount {});
    }

    #[test]
    fn test_send_generates_callback() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::Send {
            contract: "target_contract".to_string(),
            amount: Uint128::from(100u128),
            msg: Binary::from(b"callback_data"),
        };
        let res = execute(deps.as_mut(), env.clone(), info, msg).unwrap();
        // Should have one message (the WasmMsg::Execute callback)
        assert_eq!(res.messages.len(), 1);
        assert_eq!(query_balance(&deps, &env, "minter"), Uint128::from(999_999_900u128));
        assert_eq!(query_balance(&deps, &env, "target_contract"), Uint128::from(100u128));
    }

    // ============ MINTER MANAGEMENT TESTS ============

    #[test]
    fn test_update_minter_success() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::UpdateMinter {
            new_minter: Some("new_minter".to_string()),
        };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Verify new minter is set
        let res = query(deps.as_ref(), env.clone(), QueryMsg::Minter {}).unwrap();
        let minter_data: Option<MinterData> = from_json(&res).unwrap();
        assert_eq!(minter_data.unwrap().minter, Addr::unchecked("new_minter"));
    }

    #[test]
    fn test_update_minter_unauthorized() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("not_minter", &[]);
        let msg = ExecuteMsg::UpdateMinter {
            new_minter: Some("new_minter".to_string()),
        };
        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    #[test]
    fn test_renounce_minting() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);
        let msg = ExecuteMsg::UpdateMinter { new_minter: None };
        execute(deps.as_mut(), env.clone(), info, msg).unwrap();

        // Verify minting is disabled
        let res = query(deps.as_ref(), env.clone(), QueryMsg::Minter {}).unwrap();
        let minter_data: Option<MinterData> = from_json(&res).unwrap();
        assert!(minter_data.is_none());

        // Try to mint after renouncing
        let info = mock_info("minter", &[]);
        let err = execute(deps.as_mut(), env, info, ExecuteMsg::Mint {
            recipient: "alice".to_string(),
            amount: Uint128::from(100u128),
        }).unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    // ============ QUERY TESTS ============

    #[test]
    fn test_query_all_accounts() {
        let (mut deps, env) = default_instantiate();

        // Transfer to some accounts
        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::Transfer {
            recipient: "alice".to_string(),
            amount: Uint128::from(100u128),
        }).unwrap();
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::Transfer {
            recipient: "bob".to_string(),
            amount: Uint128::from(200u128),
        }).unwrap();

        let res = query(deps.as_ref(), env.clone(), QueryMsg::AllAccounts {
            start_after: None,
            limit: None,
        }).unwrap();
        let accounts: Vec<String> = from_json(&res).unwrap();
        assert!(accounts.len() >= 3); // minter, alice, bob
    }

    #[test]
    fn test_query_all_allowances() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("minter", &[]);

        // Set up multiple allowances
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::IncreaseAllowance {
            spender: "spender1".to_string(),
            amount: Uint128::from(100u128),
            expires: None,
        }).unwrap();
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::IncreaseAllowance {
            spender: "spender2".to_string(),
            amount: Uint128::from(200u128),
            expires: None,
        }).unwrap();

        let res = query(deps.as_ref(), env.clone(), QueryMsg::AllAllowances {
            owner: "minter".to_string(),
            start_after: None,
            limit: None,
        }).unwrap();
        let allowances: Vec<AllowanceResponse> = from_json(&res).unwrap();
        assert_eq!(allowances.len(), 2);
    }

    // ============ EXPIRATION TESTS ============

    #[test]
    fn test_expiration_at_height() {
        let block = cosmwasm_std::BlockInfo {
            height: 100,
            time: cosmwasm_std::Timestamp::from_seconds(1000),
            chain_id: "test".to_string(),
        };
        assert!(!Expiration::AtHeight(200).is_expired(&block));
        assert!(Expiration::AtHeight(50).is_expired(&block));
        assert!(Expiration::AtHeight(100).is_expired(&block));
    }

    #[test]
    fn test_expiration_at_time() {
        let block = cosmwasm_std::BlockInfo {
            height: 100,
            time: cosmwasm_std::Timestamp::from_seconds(1000),
            chain_id: "test".to_string(),
        };
        assert!(!Expiration::AtTime(2000).is_expired(&block));
        assert!(Expiration::AtTime(500).is_expired(&block));
        assert!(Expiration::AtTime(1000).is_expired(&block));
    }

    #[test]
    fn test_expiration_never() {
        // Use a very large but non-overflowing value
        // u64::MAX / 1_000_000_000 avoids overflow in Timestamp::from_seconds
        let block = cosmwasm_std::BlockInfo {
            height: u64::MAX,
            time: cosmwasm_std::Timestamp::from_seconds(u64::MAX / 1_000_000_000),
            chain_id: "test".to_string(),
        };
        assert!(!Expiration::Never {}.is_expired(&block));
    }

    // ============ MIGRATION TESTS ============

    #[test]
    fn test_migration_success() {
        let (mut deps, env) = default_instantiate();
        let res = migrate(deps.as_mut(), env.clone(), MigrateMsg {}).unwrap();
        assert_eq!(res.attributes[0].value, "migrate");
    }

    #[test]
    fn test_migration_wrong_contract() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        // Set a different contract name
        cw2::set_contract_version(deps.as_mut().storage, "wrong-contract", "0.1.0").unwrap();
        let err = migrate(deps.as_mut(), env, MigrateMsg {}).unwrap_err();
        assert!(err.to_string().contains("Cannot migrate"));
    }

    // ============ MULTI-STEP SCENARIO TESTS ============

    #[test]
    fn test_full_lifecycle_mint_transfer_burn() {
        let (mut deps, env) = default_instantiate();

        // Mint to alice
        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::Mint {
            recipient: "alice".to_string(),
            amount: Uint128::from(1000u128),
        }).unwrap();
        assert_eq!(query_balance(&deps, &env, "alice"), Uint128::from(1000u128));

        // Alice transfers to bob
        let info = mock_info("alice", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::Transfer {
            recipient: "bob".to_string(),
            amount: Uint128::from(600u128),
        }).unwrap();
        assert_eq!(query_balance(&deps, &env, "alice"), Uint128::from(400u128));
        assert_eq!(query_balance(&deps, &env, "bob"), Uint128::from(600u128));

        // Bob burns his tokens
        let info = mock_info("bob", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::Burn {
            amount: Uint128::from(600u128),
        }).unwrap();
        assert_eq!(query_balance(&deps, &env, "bob"), Uint128::zero());
        // Total supply reduced
        assert_eq!(query_supply(&deps, &env), Uint128::from(1_000_000_400u128));
    }

    #[test]
    fn test_allowance_workflow_with_expiration() {
        let (mut deps, mut env) = default_instantiate();

        // Set allowance with height expiration
        let info = mock_info("minter", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::IncreaseAllowance {
            spender: "spender".to_string(),
            amount: Uint128::from(1000u128),
            expires: Some(Expiration::AtHeight(env.block.height + 100)),
        }).unwrap();

        // Use partial allowance
        let info = mock_info("spender", &[]);
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::TransferFrom {
            owner: "minter".to_string(),
            recipient: "alice".to_string(),
            amount: Uint128::from(500u128),
        }).unwrap();

        // Advance past expiration
        env.block.height += 200;

        // Try to use remaining allowance after expiration
        let info = mock_info("spender", &[]);
        let err = execute(deps.as_mut(), env, info, ExecuteMsg::TransferFrom {
            owner: "minter".to_string(),
            recipient: "alice".to_string(),
            amount: Uint128::from(100u128),
        }).unwrap_err();
        assert!(matches!(err, ContractError::Std(_)));
    }
}
