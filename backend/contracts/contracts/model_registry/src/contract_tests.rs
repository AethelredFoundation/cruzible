/*
 * Model Registry Contract — Comprehensive Test Suite
 *
 * Enterprise-grade tests covering:
 * - Instantiation and initial state
 * - Model registration (success, validation, fee enforcement, rate limiting, DoS protection)
 * - Model update (authorization, partial updates)
 * - Model deregistration (authorization, count tracking)
 * - Model verification (verifier roles, admin override)
 * - Job count increment (ACL enforcement)
 * - Config update (authorization, fee caps)
 * - Query endpoints (model, list, by-owner, stats)
 * - Migration
 * - Multi-step scenario tests
 * - Monitoring events
 */
#[cfg(test)]
mod tests {
    #![allow(clippy::needless_borrows_for_generic_args)]

    use crate::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::{from_json, Coin, Env, Uint128};

    // ============ TEST HELPERS ============

    fn default_instantiate() -> (
        cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
        Env,
    ) {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        let msg = InstantiateMsg {
            registration_fee: Uint128::from(1000u128),
            verification_required: true,
            verifiers: vec!["verifier1".to_string(), "verifier2".to_string()],
        };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        (deps, env)
    }

    fn instantiate_no_fee() -> (
        cosmwasm_std::OwnedDeps<
            cosmwasm_std::MemoryStorage,
            cosmwasm_std::testing::MockApi,
            cosmwasm_std::testing::MockQuerier,
        >,
        Env,
    ) {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info("admin", &[]);
        let msg = InstantiateMsg {
            registration_fee: Uint128::zero(),
            verification_required: false,
            verifiers: vec!["verifier1".to_string()],
        };
        instantiate(deps.as_mut(), env.clone(), info, msg).unwrap();
        (deps, env)
    }

    fn register_msg(hash: &str) -> ExecuteMsg {
        ExecuteMsg::RegisterModel {
            name: format!("Model {}", hash),
            model_hash: hash.to_string(),
            architecture: "transformer".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::General,
            input_schema: r#"{"type":"string"}"#.to_string(),
            output_schema: r#"{"type":"string"}"#.to_string(),
            storage_uri: "ipfs://QmTest123".to_string(),
            size_bytes: Some(1024),
        }
    }

    fn env_at_block(base_env: &Env, height: u64) -> Env {
        let mut env = base_env.clone();
        env.block.height = height;
        env
    }

    // ============ INSTANTIATION TESTS ============

    #[test]
    fn test_instantiate_sets_config() {
        let (deps, env) = default_instantiate();
        let res = query(deps.as_ref(), env, QueryMsg::Config {}).unwrap();
        let config: Config = from_json(&res).unwrap();
        assert_eq!(config.admin, Addr::unchecked("admin"));
        assert_eq!(config.registration_fee, Uint128::from(1000u128));
        assert!(config.verification_required);
        assert_eq!(config.verifiers.len(), 2);
        assert!(config.ai_job_manager.is_none());
    }

    #[test]
    fn test_instantiate_sets_zero_model_count() {
        let (deps, env) = default_instantiate();
        let res = query(deps.as_ref(), env, QueryMsg::Stats {}).unwrap();
        let stats: ModelStats = from_json(&res).unwrap();
        assert_eq!(stats.total_models, 0);
    }

    #[test]
    fn test_instantiate_no_verification_required() {
        let (deps, env) = instantiate_no_fee();
        let res = query(deps.as_ref(), env, QueryMsg::Config {}).unwrap();
        let config: Config = from_json(&res).unwrap();
        assert!(!config.verification_required);
        assert_eq!(config.registration_fee, Uint128::zero());
    }

    // ============ REGISTRATION TESTS ============

    #[test]
    fn test_register_model_success() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let info = mock_info("user1", &fee);
        // Use a high block height to avoid rate limiting from any previous action
        let env = env_at_block(&env, 100);

        let res = execute(deps.as_mut(), env.clone(), info, register_msg("hash1")).unwrap();
        assert_eq!(res.attributes[0].value, "register_model");

        // Verify model stored
        let model_res = query(
            deps.as_ref(),
            env.clone(),
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert_eq!(model.name, "Model hash1");
        assert_eq!(model.owner, Addr::unchecked("user1"));
        assert_eq!(model.architecture, "transformer");
        assert!(!model.verified); // verification_required = true
        assert_eq!(model.total_jobs, 0);
        assert_eq!(model.size_bytes, Some(1024));

        // Verify count incremented
        let stats_res = query(deps.as_ref(), env, QueryMsg::Stats {}).unwrap();
        let stats: ModelStats = from_json(&stats_res).unwrap();
        assert_eq!(stats.total_models, 1);
    }

    #[test]
    fn test_register_model_auto_verified_when_not_required() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env = env_at_block(&env, 100);

        execute(deps.as_mut(), env.clone(), info, register_msg("hash1")).unwrap();

        let model_res = query(
            deps.as_ref(),
            env,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert!(model.verified);
        assert_eq!(model.verified_by, Some(Addr::unchecked("user1")));
    }

    #[test]
    fn test_register_model_duplicate_rejected() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let info = mock_info("user1", &fee);
        let env_100 = env_at_block(&env, 100);

        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();

        // Try registering same hash again (after cooldown)
        let env_200 = env_at_block(&env, 200);
        let err = execute(deps.as_mut(), env_200, info, register_msg("hash1")).unwrap_err();
        assert_eq!(err, ContractError::ModelExists {});
    }

    #[test]
    fn test_register_model_insufficient_fee() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(500u128, "uaeth")]; // fee is 1000, paying only 500
        let info = mock_info("user1", &fee);
        let env = env_at_block(&env, 100);

        let err = execute(deps.as_mut(), env, info, register_msg("hash1")).unwrap_err();
        assert!(err.to_string().contains("Insufficient registration fee"));
    }

    #[test]
    fn test_register_model_no_fee_when_required() {
        let (mut deps, env) = default_instantiate();
        let info = mock_info("user1", &[]); // No funds sent
        let env = env_at_block(&env, 100);

        let err = execute(deps.as_mut(), env, info, register_msg("hash1")).unwrap_err();
        assert!(err.to_string().contains("Insufficient registration fee"));
    }

    // ============ INPUT VALIDATION TESTS ============

    #[test]
    fn test_register_empty_name_rejected() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env = env_at_block(&env, 100);

        let msg = ExecuteMsg::RegisterModel {
            name: "".to_string(),
            model_hash: "hash1".to_string(),
            architecture: "transformer".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::General,
            input_schema: "{}".to_string(),
            output_schema: "{}".to_string(),
            storage_uri: "ipfs://test".to_string(),
            size_bytes: None,
        };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(err.to_string().contains("Name must be 1-256 characters"));
    }

    #[test]
    fn test_register_empty_hash_rejected() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env = env_at_block(&env, 100);

        let msg = ExecuteMsg::RegisterModel {
            name: "Test Model".to_string(),
            model_hash: "".to_string(),
            architecture: "transformer".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::General,
            input_schema: "{}".to_string(),
            output_schema: "{}".to_string(),
            storage_uri: "ipfs://test".to_string(),
            size_bytes: None,
        };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(err
            .to_string()
            .contains("Model hash must be 1-128 characters"));
    }

    #[test]
    fn test_register_empty_version_rejected() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env = env_at_block(&env, 100);

        let msg = ExecuteMsg::RegisterModel {
            name: "Test Model".to_string(),
            model_hash: "hash1".to_string(),
            architecture: "transformer".to_string(),
            version: "".to_string(),
            category: ModelCategory::General,
            input_schema: "{}".to_string(),
            output_schema: "{}".to_string(),
            storage_uri: "ipfs://test".to_string(),
            size_bytes: None,
        };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(err.to_string().contains("Version must be 1-64 characters"));
    }

    #[test]
    fn test_register_empty_storage_uri_rejected() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env = env_at_block(&env, 100);

        let msg = ExecuteMsg::RegisterModel {
            name: "Test Model".to_string(),
            model_hash: "hash1".to_string(),
            architecture: "transformer".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::General,
            input_schema: "{}".to_string(),
            output_schema: "{}".to_string(),
            storage_uri: "".to_string(),
            size_bytes: None,
        };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(err
            .to_string()
            .contains("Storage URI must be 1-2048 characters"));
    }

    #[test]
    fn test_register_oversized_schema_rejected() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env = env_at_block(&env, 100);

        let big_schema = "x".repeat(10241);
        let msg = ExecuteMsg::RegisterModel {
            name: "Test Model".to_string(),
            model_hash: "hash1".to_string(),
            architecture: "transformer".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::General,
            input_schema: big_schema,
            output_schema: "{}".to_string(),
            storage_uri: "ipfs://test".to_string(),
            size_bytes: None,
        };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(err
            .to_string()
            .contains("Schema must be at most 10240 characters"));
    }

    // ============ RATE LIMITING TESTS ============

    #[test]
    fn test_rate_limiting_blocks_rapid_registration() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        // First registration succeeds
        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();

        // Second registration at same block fails (cooldown = 5 blocks)
        let err = execute(deps.as_mut(), env_100, info.clone(), register_msg("hash2")).unwrap_err();
        assert_eq!(err, ContractError::RateLimited {});

        // Registration at block 104 (only 4 blocks later) still fails
        let env_104 = env_at_block(&env, 104);
        let err = execute(deps.as_mut(), env_104, info.clone(), register_msg("hash2")).unwrap_err();
        assert_eq!(err, ContractError::RateLimited {});

        // Registration at block 105 (5 blocks later) succeeds
        let env_105 = env_at_block(&env, 105);
        execute(deps.as_mut(), env_105, info, register_msg("hash2")).unwrap();
    }

    #[test]
    fn test_rate_limiting_different_users_independent() {
        let (mut deps, env) = instantiate_no_fee();
        let env_100 = env_at_block(&env, 100);

        // User1 registers
        let info1 = mock_info("user1", &[]);
        execute(deps.as_mut(), env_100.clone(), info1, register_msg("hash1")).unwrap();

        // User2 can register at the same block
        let info2 = mock_info("user2", &[]);
        execute(deps.as_mut(), env_100, info2, register_msg("hash2")).unwrap();
    }

    // ============ UPDATE MODEL TESTS ============

    #[test]
    fn test_update_model_success() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();

        let res = execute(
            deps.as_mut(),
            env_100.clone(),
            info,
            ExecuteMsg::UpdateModel {
                model_hash: "hash1".to_string(),
                name: Some("Updated Name".to_string()),
                storage_uri: Some("ipfs://NewUri".to_string()),
            },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "update_model");

        let model_res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert_eq!(model.name, "Updated Name");
        assert_eq!(model.storage_uri, "ipfs://NewUri");
    }

    #[test]
    fn test_update_model_partial_name_only() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();

        execute(
            deps.as_mut(),
            env_100.clone(),
            info,
            ExecuteMsg::UpdateModel {
                model_hash: "hash1".to_string(),
                name: Some("New Name Only".to_string()),
                storage_uri: None, // Keep existing
            },
        )
        .unwrap();

        let model_res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert_eq!(model.name, "New Name Only");
        assert_eq!(model.storage_uri, "ipfs://QmTest123"); // Unchanged
    }

    #[test]
    fn test_update_model_unauthorized() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        // Different user tries to update
        let info2 = mock_info("user2", &[]);
        let err = execute(
            deps.as_mut(),
            env_100,
            info2,
            ExecuteMsg::UpdateModel {
                model_hash: "hash1".to_string(),
                name: Some("Hacked Name".to_string()),
                storage_uri: None,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    #[test]
    fn test_update_nonexistent_model() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);

        let err = execute(
            deps.as_mut(),
            env,
            info,
            ExecuteMsg::UpdateModel {
                model_hash: "nonexistent".to_string(),
                name: Some("Name".to_string()),
                storage_uri: None,
            },
        )
        .unwrap_err();
        // Should be a storage not-found error
        assert!(err.to_string().contains("not found") || matches!(err, ContractError::Std(_)));
    }

    // ============ DEREGISTRATION TESTS ============

    #[test]
    fn test_deregister_model_success() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();

        let res = execute(
            deps.as_mut(),
            env_100.clone(),
            info,
            ExecuteMsg::DeregisterModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "deregister_model");

        // Model count decremented
        let stats_res = query(deps.as_ref(), env_100.clone(), QueryMsg::Stats {}).unwrap();
        let stats: ModelStats = from_json(&stats_res).unwrap();
        assert_eq!(stats.total_models, 0);

        // Querying model should fail
        let err = query(
            deps.as_ref(),
            env_100,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        );
        assert!(err.is_err());
    }

    #[test]
    fn test_deregister_model_unauthorized() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        let info2 = mock_info("user2", &[]);
        let err = execute(
            deps.as_mut(),
            env_100,
            info2,
            ExecuteMsg::DeregisterModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    #[test]
    fn test_deregister_nonexistent_model() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);

        let err = execute(
            deps.as_mut(),
            env,
            info,
            ExecuteMsg::DeregisterModel {
                model_hash: "nonexistent".to_string(),
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("not found") || matches!(err, ContractError::Std(_)));
    }

    // ============ VERIFICATION TESTS ============

    #[test]
    fn test_verify_model_by_verifier() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let env_100 = env_at_block(&env, 100);

        let info = mock_info("user1", &fee);
        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        // Verifier1 verifies the model
        let verifier_info = mock_info("verifier1", &[]);
        let res = execute(
            deps.as_mut(),
            env_100.clone(),
            verifier_info,
            ExecuteMsg::VerifyModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "verify_model");

        let model_res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert!(model.verified);
        assert_eq!(model.verified_by, Some(Addr::unchecked("verifier1")));
    }

    #[test]
    fn test_verify_model_by_admin() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let env_100 = env_at_block(&env, 100);

        let info = mock_info("user1", &fee);
        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        // Admin can also verify
        let admin_info = mock_info("admin", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            admin_info,
            ExecuteMsg::VerifyModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        let model_res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert!(model.verified);
        assert_eq!(model.verified_by, Some(Addr::unchecked("admin")));
    }

    #[test]
    fn test_verify_model_unauthorized() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let env_100 = env_at_block(&env, 100);

        let info = mock_info("user1", &fee);
        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        // Random user cannot verify
        let random_info = mock_info("random_user", &[]);
        let err = execute(
            deps.as_mut(),
            env_100,
            random_info,
            ExecuteMsg::VerifyModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    #[test]
    fn test_verify_nonexistent_model() {
        let (mut deps, env) = default_instantiate();
        let verifier_info = mock_info("verifier1", &[]);

        let err = execute(
            deps.as_mut(),
            env,
            verifier_info,
            ExecuteMsg::VerifyModel {
                model_hash: "nonexistent".to_string(),
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("not found") || matches!(err, ContractError::Std(_)));
    }

    // ============ INCREMENT JOB COUNT TESTS ============

    #[test]
    fn test_increment_job_count_by_admin() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        // Admin increments
        let admin_info = mock_info("admin", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            admin_info.clone(),
            ExecuteMsg::IncrementJobCount {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            env_100.clone(),
            admin_info,
            ExecuteMsg::IncrementJobCount {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        let model_res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert_eq!(model.total_jobs, 2);
    }

    #[test]
    fn test_increment_job_count_by_job_manager() {
        let (mut deps, env) = instantiate_no_fee();
        let env_100 = env_at_block(&env, 100);

        // Register a model
        let info = mock_info("user1", &[]);
        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        // Set AI Job Manager address
        let admin_info = mock_info("admin", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            admin_info,
            ExecuteMsg::UpdateConfig {
                registration_fee: None,
                ai_job_manager: Some("job_manager".to_string()),
            },
        )
        .unwrap();

        // Job manager can now increment
        let jm_info = mock_info("job_manager", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            jm_info,
            ExecuteMsg::IncrementJobCount {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        let model_res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::Model {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let model: Model = from_json(&model_res).unwrap();
        assert_eq!(model.total_jobs, 1);
    }

    #[test]
    fn test_increment_job_count_unauthorized() {
        let (mut deps, env) = instantiate_no_fee();
        let env_100 = env_at_block(&env, 100);

        let info = mock_info("user1", &[]);
        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        // Random user cannot increment
        let random_info = mock_info("random_user", &[]);
        let err = execute(
            deps.as_mut(),
            env_100,
            random_info,
            ExecuteMsg::IncrementJobCount {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    // ============ CONFIG UPDATE TESTS ============

    #[test]
    fn test_update_config_by_admin() {
        let (mut deps, env) = default_instantiate();
        let admin_info = mock_info("admin", &[]);

        let res = execute(
            deps.as_mut(),
            env.clone(),
            admin_info,
            ExecuteMsg::UpdateConfig {
                registration_fee: Some(Uint128::from(5000u128)),
                ai_job_manager: Some("new_job_manager".to_string()),
            },
        )
        .unwrap();
        assert_eq!(res.attributes[0].value, "update_config");

        let config_res = query(deps.as_ref(), env, QueryMsg::Config {}).unwrap();
        let config: Config = from_json(&config_res).unwrap();
        assert_eq!(config.registration_fee, Uint128::from(5000u128));
        assert_eq!(
            config.ai_job_manager,
            Some(Addr::unchecked("new_job_manager"))
        );
    }

    #[test]
    fn test_update_config_unauthorized() {
        let (mut deps, env) = default_instantiate();
        let random_info = mock_info("random_user", &[]);

        let err = execute(
            deps.as_mut(),
            env,
            random_info,
            ExecuteMsg::UpdateConfig {
                registration_fee: Some(Uint128::from(0u128)),
                ai_job_manager: None,
            },
        )
        .unwrap_err();
        assert_eq!(err, ContractError::Unauthorized {});
    }

    #[test]
    fn test_update_config_fee_exceeds_max() {
        let (mut deps, env) = default_instantiate();
        let admin_info = mock_info("admin", &[]);

        // MAX_REGISTRATION_FEE = 1_000_000_000_000
        let err = execute(
            deps.as_mut(),
            env,
            admin_info,
            ExecuteMsg::UpdateConfig {
                registration_fee: Some(Uint128::from(1_000_000_000_001u128)),
                ai_job_manager: None,
            },
        )
        .unwrap_err();
        assert!(err
            .to_string()
            .contains("Registration fee exceeds maximum allowed"));
    }

    #[test]
    fn test_update_config_fee_at_max_succeeds() {
        let (mut deps, env) = default_instantiate();
        let admin_info = mock_info("admin", &[]);

        // Exactly at max should succeed
        execute(
            deps.as_mut(),
            env.clone(),
            admin_info,
            ExecuteMsg::UpdateConfig {
                registration_fee: Some(Uint128::from(1_000_000_000_000u128)),
                ai_job_manager: None,
            },
        )
        .unwrap();

        let config_res = query(deps.as_ref(), env, QueryMsg::Config {}).unwrap();
        let config: Config = from_json(&config_res).unwrap();
        assert_eq!(
            config.registration_fee,
            Uint128::from(1_000_000_000_000u128)
        );
    }

    // ============ QUERY TESTS ============

    #[test]
    fn test_query_models_by_owner() {
        let (mut deps, env) = instantiate_no_fee();
        let env_100 = env_at_block(&env, 100);
        let env_110 = env_at_block(&env, 110);

        // User1 registers 2 models
        let info = mock_info("user1", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();
        execute(deps.as_mut(), env_110.clone(), info, register_msg("hash2")).unwrap();

        // User2 registers 1 model
        let info2 = mock_info("user2", &[]);
        execute(deps.as_mut(), env_100.clone(), info2, register_msg("hash3")).unwrap();

        let res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::ModelsByOwner {
                owner: "user1".to_string(),
            },
        )
        .unwrap();
        let models: Vec<Model> = from_json(&res).unwrap();
        assert_eq!(models.len(), 2);
        assert!(models.iter().all(|m| m.owner == Addr::unchecked("user1")));
    }

    #[test]
    fn test_query_list_models_all() {
        let (mut deps, env) = instantiate_no_fee();
        let env_100 = env_at_block(&env, 100);
        let env_110 = env_at_block(&env, 110);

        let info = mock_info("user1", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();
        execute(deps.as_mut(), env_110.clone(), info, register_msg("hash2")).unwrap();

        let res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::ListModels {
                category: None,
                owner: None,
                verified: None,
                limit: None,
            },
        )
        .unwrap();
        let models: Vec<Model> = from_json(&res).unwrap();
        assert_eq!(models.len(), 2);
    }

    #[test]
    fn test_query_list_models_verified_filter() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let env_100 = env_at_block(&env, 100);
        let env_110 = env_at_block(&env, 110);

        // Register 2 models (unverified because verification_required = true)
        let info = mock_info("user1", &fee);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();
        execute(deps.as_mut(), env_110.clone(), info, register_msg("hash2")).unwrap();

        // Verify one
        let verifier_info = mock_info("verifier1", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            verifier_info,
            ExecuteMsg::VerifyModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        // Query verified only
        let res = query(
            deps.as_ref(),
            env_100.clone(),
            QueryMsg::ListModels {
                category: None,
                owner: None,
                verified: Some(true),
                limit: None,
            },
        )
        .unwrap();
        let verified: Vec<Model> = from_json(&res).unwrap();
        assert_eq!(verified.len(), 1);
        assert_eq!(verified[0].model_hash, "hash1");

        // Query unverified only
        let res = query(
            deps.as_ref(),
            env_100,
            QueryMsg::ListModels {
                category: None,
                owner: None,
                verified: Some(false),
                limit: None,
            },
        )
        .unwrap();
        let unverified: Vec<Model> = from_json(&res).unwrap();
        assert_eq!(unverified.len(), 1);
        assert_eq!(unverified[0].model_hash, "hash2");
    }

    #[test]
    fn test_query_list_models_with_limit() {
        let (mut deps, env) = instantiate_no_fee();

        // Register 5 models across different blocks
        let info = mock_info("user1", &[]);
        for i in 0..5 {
            let env_i = env_at_block(&env, 100 + i * 10);
            execute(
                deps.as_mut(),
                env_i,
                info.clone(),
                register_msg(&format!("hash{}", i)),
            )
            .unwrap();
        }

        let res = query(
            deps.as_ref(),
            env.clone(),
            QueryMsg::ListModels {
                category: None,
                owner: None,
                verified: None,
                limit: Some(3),
            },
        )
        .unwrap();
        let models: Vec<Model> = from_json(&res).unwrap();
        assert_eq!(models.len(), 3);
    }

    #[test]
    fn test_query_stats() {
        let (mut deps, env) = instantiate_no_fee();
        let env_100 = env_at_block(&env, 100);
        let env_110 = env_at_block(&env, 110);

        let info = mock_info("user1", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();
        execute(deps.as_mut(), env_110.clone(), info, register_msg("hash2")).unwrap();

        let res = query(deps.as_ref(), env_100, QueryMsg::Stats {}).unwrap();
        let stats: ModelStats = from_json(&res).unwrap();
        assert_eq!(stats.total_models, 2);
    }

    // ============ MIGRATION TESTS ============

    #[test]
    fn test_migration_success() {
        let (mut deps, env) = default_instantiate();
        let res = migrate(deps.as_mut(), env, MigrateMsg {}).unwrap();
        assert_eq!(res.attributes[0].value, "migrate");
    }

    #[test]
    fn test_migration_wrong_contract() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        cw2::set_contract_version(deps.as_mut().storage, "wrong-contract", "0.1.0").unwrap();
        let err = migrate(deps.as_mut(), env, MigrateMsg {}).unwrap_err();
        assert!(err.to_string().contains("Cannot migrate"));
    }

    // ============ MONITORING EVENT TESTS ============

    #[test]
    fn test_register_model_emits_monitoring_event() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        let res = execute(deps.as_mut(), env_100, info, register_msg("hash1")).unwrap();

        // Check for monitoring event
        let event = res.events.iter().find(|e| e.ty == "model_registered");
        assert!(event.is_some(), "model_registered event should be emitted");
        let ev = event.unwrap();
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "model_hash" && a.value == "hash1"));
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "owner" && a.value == "user1"));
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "total_models" && a.value == "1"));
    }

    #[test]
    fn test_deregister_model_emits_monitoring_event() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);
        let env_100 = env_at_block(&env, 100);

        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();

        let res = execute(
            deps.as_mut(),
            env_100,
            info,
            ExecuteMsg::DeregisterModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        let event = res.events.iter().find(|e| e.ty == "model_deregistered");
        assert!(
            event.is_some(),
            "model_deregistered event should be emitted"
        );
        let ev = event.unwrap();
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "model_hash" && a.value == "hash1"));
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "remaining_models" && a.value == "0"));
    }

    #[test]
    fn test_verify_model_emits_monitoring_event() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let env_100 = env_at_block(&env, 100);

        let info = mock_info("user1", &fee);
        execute(deps.as_mut(), env_100.clone(), info, register_msg("hash1")).unwrap();

        let verifier_info = mock_info("verifier1", &[]);
        let res = execute(
            deps.as_mut(),
            env_100,
            verifier_info,
            ExecuteMsg::VerifyModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        let event = res.events.iter().find(|e| e.ty == "model_verified");
        assert!(event.is_some(), "model_verified event should be emitted");
        let ev = event.unwrap();
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "verified_by" && a.value == "verifier1"));
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "model_owner" && a.value == "user1"));
    }

    #[test]
    fn test_config_update_emits_monitoring_event() {
        let (mut deps, env) = default_instantiate();
        let admin_info = mock_info("admin", &[]);

        let res = execute(
            deps.as_mut(),
            env,
            admin_info,
            ExecuteMsg::UpdateConfig {
                registration_fee: Some(Uint128::from(2000u128)),
                ai_job_manager: Some("job_mgr".to_string()),
            },
        )
        .unwrap();

        let event = res.events.iter().find(|e| e.ty == "config_updated");
        assert!(event.is_some(), "config_updated event should be emitted");
        let ev = event.unwrap();
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "updated_by" && a.value == "admin"));
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "registration_fee" && a.value == "2000"));
    }

    // ============ MULTI-STEP SCENARIO TESTS ============

    #[test]
    fn test_full_lifecycle_register_verify_use_deregister() {
        let (mut deps, env) = default_instantiate();
        let fee = vec![Coin::new(1000u128, "uaeth")];
        let env_100 = env_at_block(&env, 100);

        // Step 1: Register
        let info = mock_info("user1", &fee);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info.clone(),
            register_msg("hash1"),
        )
        .unwrap();
        let stats: ModelStats =
            from_json(&query(deps.as_ref(), env_100.clone(), QueryMsg::Stats {}).unwrap()).unwrap();
        assert_eq!(stats.total_models, 1);

        // Step 2: Verify
        let verifier_info = mock_info("verifier1", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            verifier_info,
            ExecuteMsg::VerifyModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        // Step 3: Increment job count (by admin since no job manager set)
        let admin_info = mock_info("admin", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            admin_info.clone(),
            ExecuteMsg::IncrementJobCount {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            env_100.clone(),
            admin_info,
            ExecuteMsg::IncrementJobCount {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();

        // Step 4: Verify state
        let model: Model = from_json(
            &query(
                deps.as_ref(),
                env_100.clone(),
                QueryMsg::Model {
                    model_hash: "hash1".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(model.verified);
        assert_eq!(model.total_jobs, 2);

        // Step 5: Deregister
        execute(
            deps.as_mut(),
            env_100.clone(),
            mock_info("user1", &[]),
            ExecuteMsg::DeregisterModel {
                model_hash: "hash1".to_string(),
            },
        )
        .unwrap();
        let stats: ModelStats =
            from_json(&query(deps.as_ref(), env_100, QueryMsg::Stats {}).unwrap()).unwrap();
        assert_eq!(stats.total_models, 0);
    }

    #[test]
    fn test_multiple_owners_independent_models() {
        let (mut deps, env) = instantiate_no_fee();
        let env_100 = env_at_block(&env, 100);
        let env_110 = env_at_block(&env, 110);

        // User1 registers 2 models
        let info1 = mock_info("user1", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info1.clone(),
            register_msg("u1_hash1"),
        )
        .unwrap();
        execute(
            deps.as_mut(),
            env_110.clone(),
            info1,
            register_msg("u1_hash2"),
        )
        .unwrap();

        // User2 registers 1 model
        let info2 = mock_info("user2", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info2,
            register_msg("u2_hash1"),
        )
        .unwrap();

        // Stats should show 3 total
        let stats: ModelStats =
            from_json(&query(deps.as_ref(), env_100.clone(), QueryMsg::Stats {}).unwrap()).unwrap();
        assert_eq!(stats.total_models, 3);

        // User1 has 2 models
        let u1_models: Vec<Model> = from_json(
            &query(
                deps.as_ref(),
                env_100.clone(),
                QueryMsg::ModelsByOwner {
                    owner: "user1".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(u1_models.len(), 2);

        // User2 has 1 model
        let u2_models: Vec<Model> = from_json(
            &query(
                deps.as_ref(),
                env_100.clone(),
                QueryMsg::ModelsByOwner {
                    owner: "user2".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(u2_models.len(), 1);

        // User1 deregisters one model
        let info1 = mock_info("user1", &[]);
        execute(
            deps.as_mut(),
            env_100.clone(),
            info1,
            ExecuteMsg::DeregisterModel {
                model_hash: "u1_hash1".to_string(),
            },
        )
        .unwrap();

        let stats: ModelStats =
            from_json(&query(deps.as_ref(), env_100, QueryMsg::Stats {}).unwrap()).unwrap();
        assert_eq!(stats.total_models, 2);
    }

    #[test]
    fn test_model_categories() {
        let (mut deps, env) = instantiate_no_fee();
        let info = mock_info("user1", &[]);

        // Register models with different categories at different blocks
        let categories = [
            ("med_hash", ModelCategory::Medical),
            ("sci_hash", ModelCategory::Scientific),
            ("fin_hash", ModelCategory::Financial),
        ];

        for (i, (hash, cat)) in categories.iter().enumerate() {
            let env_i = env_at_block(&env, 100 + (i as u64) * 10);
            let msg = ExecuteMsg::RegisterModel {
                name: format!("Model {}", hash),
                model_hash: hash.to_string(),
                architecture: "transformer".to_string(),
                version: "1.0.0".to_string(),
                category: cat.clone(),
                input_schema: "{}".to_string(),
                output_schema: "{}".to_string(),
                storage_uri: "ipfs://test".to_string(),
                size_bytes: None,
            };
            execute(deps.as_mut(), env_i, info.clone(), msg).unwrap();
        }

        // Verify each model has correct category
        let model: Model = from_json(
            &query(
                deps.as_ref(),
                env.clone(),
                QueryMsg::Model {
                    model_hash: "med_hash".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(model.category, ModelCategory::Medical);

        let model: Model = from_json(
            &query(
                deps.as_ref(),
                env.clone(),
                QueryMsg::Model {
                    model_hash: "sci_hash".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(model.category, ModelCategory::Scientific);

        let model: Model = from_json(
            &query(
                deps.as_ref(),
                env,
                QueryMsg::Model {
                    model_hash: "fin_hash".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(model.category, ModelCategory::Financial);
    }
}
