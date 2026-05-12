/*
 * Seal Manager - Comprehensive Test Suite
 *
 * Covers the core seal lifecycle, queries, and configuration paths.
 */
#[cfg(test)]
mod tests {
    use cosmwasm_std::testing::MockApi;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info, MockQuerier};
    use cosmwasm_std::{
        from_json, to_json_binary, Addr, ContractResult, MemoryStorage, OwnedDeps, SystemResult,
    };

    use crate::*;

    const ADMIN: &str = "admin";
    const AI_JOB_MANAGER: &str = "ai_job_manager_contract";
    const REQUESTER: &str = "requester";
    const VALIDATOR1: &str = "validator1";
    const VALIDATOR2: &str = "validator2";
    const VALIDATOR3: &str = "validator3";

    fn mock_deps_with_job_status(
        job_id: &str,
        status: JobStatusResponse,
    ) -> OwnedDeps<MemoryStorage, MockApi, MockQuerier> {
        let mut deps = mock_dependencies();
        let response_id = job_id.to_string();
        deps.querier.update_wasm(move |query| match query {
            cosmwasm_std::WasmQuery::Smart { .. } => {
                let response = JobResponse {
                    id: response_id.clone(),
                    status: status.clone(),
                    validator: None,
                    model_hash: None,
                    input_hash: None,
                    output_hash: None,
                };
                SystemResult::Ok(ContractResult::Ok(to_json_binary(&response).unwrap()))
            }
            _ => SystemResult::Err(cosmwasm_std::SystemError::InvalidRequest {
                error: "unimplemented".to_string(),
                request: cosmwasm_std::Binary::default(),
            }),
        });
        deps
    }

    fn mock_deps_with_job_response(
        response: JobResponse,
    ) -> OwnedDeps<MemoryStorage, MockApi, MockQuerier> {
        let mut deps = mock_dependencies();
        deps.querier.update_wasm(move |query| match query {
            cosmwasm_std::WasmQuery::Smart { .. } => {
                SystemResult::Ok(ContractResult::Ok(to_json_binary(&response).unwrap()))
            }
            _ => SystemResult::Err(cosmwasm_std::SystemError::InvalidRequest {
                error: "unimplemented".to_string(),
                request: cosmwasm_std::Binary::default(),
            }),
        });
        deps
    }

    /// Create mock dependencies with a custom wasm querier that returns
    /// a valid JobResponse for any Job query to the AI Job Manager.
    fn mock_deps_with_wasm() -> OwnedDeps<MemoryStorage, MockApi, MockQuerier> {
        mock_deps_with_job_status("job123", JobStatusResponse::Verified)
    }

    fn mock_deps_without_job() -> OwnedDeps<MemoryStorage, MockApi, MockQuerier> {
        let mut deps = mock_dependencies();
        deps.querier.update_wasm(|query| match query {
            cosmwasm_std::WasmQuery::Smart { .. } => {
                SystemResult::Err(cosmwasm_std::SystemError::NoSuchContract {
                    addr: AI_JOB_MANAGER.to_string(),
                })
            }
            _ => SystemResult::Err(cosmwasm_std::SystemError::InvalidRequest {
                error: "unimplemented".to_string(),
                request: cosmwasm_std::Binary::default(),
            }),
        });
        deps
    }

    fn set_job_status(
        deps: &mut OwnedDeps<MemoryStorage, MockApi, MockQuerier>,
        job_id: &str,
        status: JobStatusResponse,
    ) {
        let response_id = job_id.to_string();
        deps.querier.update_wasm(move |query| match query {
            cosmwasm_std::WasmQuery::Smart { .. } => {
                let response = JobResponse {
                    id: response_id.clone(),
                    status: status.clone(),
                    validator: None,
                    model_hash: None,
                    input_hash: None,
                    output_hash: None,
                };
                SystemResult::Ok(ContractResult::Ok(to_json_binary(&response).unwrap()))
            }
            _ => SystemResult::Err(cosmwasm_std::SystemError::InvalidRequest {
                error: "unimplemented".to_string(),
                request: cosmwasm_std::Binary::default(),
            }),
        });
    }

    fn set_missing_job(deps: &mut OwnedDeps<MemoryStorage, MockApi, MockQuerier>) {
        deps.querier.update_wasm(|query| match query {
            cosmwasm_std::WasmQuery::Smart { .. } => {
                SystemResult::Err(cosmwasm_std::SystemError::NoSuchContract {
                    addr: AI_JOB_MANAGER.to_string(),
                })
            }
            _ => SystemResult::Err(cosmwasm_std::SystemError::InvalidRequest {
                error: "unimplemented".to_string(),
                request: cosmwasm_std::Binary::default(),
            }),
        });
    }

    fn setup_contract(deps: DepsMut) -> Config {
        let info = mock_info(ADMIN, &[]);
        let msg = InstantiateMsg {
            ai_job_manager: AI_JOB_MANAGER.to_string(),
            min_validators: 3,
            max_validators: 10,
            default_expiration: 86400 * 30, // 30 days
            max_expiration: 86400 * 365,    // 1 year
        };

        instantiate(deps, mock_env(), info, msg).unwrap();
        // Return expected config (deps was consumed by instantiate)
        Config {
            admin: Addr::unchecked(ADMIN),
            ai_job_manager: Addr::unchecked(AI_JOB_MANAGER),
            min_validators: 3,
            max_validators: 10,
            default_expiration: 86400 * 30,
            max_expiration: 86400 * 365,
        }
    }

    fn create_seal(deps: DepsMut, requester: &str, validators: Vec<&str>) -> (String, MessageInfo) {
        let info = mock_info(requester, &[]);
        let validator_addrs: Vec<String> = validators.iter().map(|v| v.to_string()).collect();

        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash_abc".to_string(),
            input_commitment: "input_hash_def".to_string(),
            output_commitment: "output_hash_ghi".to_string(),
            validator_addresses: validator_addrs,
            expiration: Some(86400 * 60), // 60 days
        };

        let res = execute(deps, mock_env(), info.clone(), msg).unwrap();
        let seal_id = res
            .attributes
            .iter()
            .find(|a| a.key == "seal_id")
            .map(|a| a.value.clone())
            .unwrap();

        (seal_id, info)
    }

    // ============ INSTANTIATE TESTS ============

    #[test]
    fn instantiate_works() {
        let mut deps = mock_deps_with_wasm();
        let config = setup_contract(deps.as_mut());

        assert_eq!(config.min_validators, 3);
        assert_eq!(config.max_validators, 10);
        assert_eq!(config.default_expiration, 86400 * 30);
        assert_eq!(config.max_expiration, 86400 * 365);
    }

    #[test]
    fn instantiate_rejects_invalid_validator_bounds() {
        let mut deps = mock_deps_with_wasm();
        let msg = InstantiateMsg {
            ai_job_manager: AI_JOB_MANAGER.to_string(),
            min_validators: 0,
            max_validators: 10,
            default_expiration: 86400 * 30,
            max_expiration: 86400 * 365,
        };

        let err = instantiate(deps.as_mut(), mock_env(), mock_info(ADMIN, &[]), msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidConfig { .. }));
        assert!(err.to_string().contains("min_validators"));
    }

    #[test]
    fn instantiate_rejects_default_expiration_above_max() {
        let mut deps = mock_deps_with_wasm();
        let msg = InstantiateMsg {
            ai_job_manager: AI_JOB_MANAGER.to_string(),
            min_validators: 3,
            max_validators: 10,
            default_expiration: 86400 * 366,
            max_expiration: 86400 * 365,
        };

        let err = instantiate(deps.as_mut(), mock_env(), mock_info(ADMIN, &[]), msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidConfig { .. }));
        assert!(err.to_string().contains("default_expiration"));
    }

    // ============ CREATE SEAL TESTS ============

    #[test]
    fn create_seal_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        assert!(seal_id.starts_with("seal_"));

        let seal = seals().load(&deps.storage, seal_id).unwrap();
        assert_eq!(seal.status, SealStatus::Active);
        assert_eq!(seal.validators.len(), 3);
        assert_eq!(seal.model_commitment, "model_hash_abc");
    }

    #[test]
    fn create_seal_matches_upstream_job_evidence() {
        let mut deps = mock_deps_with_job_response(JobResponse {
            id: "job123".to_string(),
            status: JobStatusResponse::Verified,
            validator: Some(VALIDATOR1.to_string()),
            model_hash: Some("model_hash".to_string()),
            input_hash: Some("input_hash".to_string()),
            output_hash: Some("output_hash".to_string()),
        });
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: None,
        };

        let res = execute(deps.as_mut(), mock_env(), info, msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "create_seal"));
    }

    #[test]
    fn create_seal_rejects_mismatched_job_commitment() {
        let mut deps = mock_deps_with_job_response(JobResponse {
            id: "job123".to_string(),
            status: JobStatusResponse::Verified,
            validator: Some(VALIDATOR1.to_string()),
            model_hash: Some("model_hash".to_string()),
            input_hash: Some("input_hash".to_string()),
            output_hash: Some("canonical_output".to_string()),
        });
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "fake_output".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidConfig { .. }));
        assert!(err.to_string().contains("output_commitment"));
    }

    #[test]
    fn create_seal_rejects_missing_assigned_validator() {
        let mut deps = mock_deps_with_job_response(JobResponse {
            id: "job123".to_string(),
            status: JobStatusResponse::Verified,
            validator: Some(VALIDATOR3.to_string()),
            model_hash: Some("model_hash".to_string()),
            input_hash: Some("input_hash".to_string()),
            output_hash: Some("output_hash".to_string()),
        });
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                "validator4".to_string(),
            ],
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert_eq!(err, ContractError::InvalidSealStatus {});
    }

    #[test]
    fn create_seal_rejects_empty_commitment() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: " ".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidConfig { .. }));
        assert!(err.to_string().contains("model_commitment"));
    }

    #[test]
    fn create_seal_without_expiration_uses_default_expiration() {
        let mut deps = mock_deps_with_wasm();
        let config = setup_contract(deps.as_mut());
        let env = mock_env();

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: None,
        };

        let res = execute(deps.as_mut(), env.clone(), info, msg).unwrap();
        let seal_id = res
            .attributes
            .iter()
            .find(|a| a.key == "seal_id")
            .unwrap()
            .value
            .clone();
        let seal = seals().load(&deps.storage, seal_id).unwrap();

        assert_eq!(
            seal.expires_at,
            Some(env.block.time.plus_seconds(config.default_expiration))
        );
    }

    #[test]
    fn create_seal_rejects_zero_expiration() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: Some(0),
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidConfig { .. }));
        assert!(err.to_string().contains("greater than zero"));
    }

    #[test]
    fn create_seal_rejects_expiration_above_max() {
        let mut deps = mock_deps_with_wasm();
        let config = setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: Some(config.max_expiration + 1),
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidConfig { .. }));
        assert!(err.to_string().contains("max_expiration"));
    }

    #[test]
    fn create_seal_rejects_completed_job() {
        let mut deps = mock_deps_with_job_status("job123", JobStatusResponse::Completed);
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(err.to_string().contains("not in a valid state"));
    }

    #[test]
    fn create_seal_rejects_missing_job() {
        let mut deps = mock_deps_without_job();
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn create_seal_accepts_paid_job() {
        let mut deps = mock_deps_with_job_status("job123", JobStatusResponse::Paid);
        setup_contract(deps.as_mut());

        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let seal = seals().load(&deps.storage, seal_id).unwrap();
        assert_eq!(seal.status, SealStatus::Active);
    }

    #[test]
    fn create_seal_duplicate_validators_do_not_satisfy_quorum() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
            ],
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidSealStatus {}));
    }

    #[test]
    fn create_seal_deduplicates_validator_addresses() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3, VALIDATOR3],
        );

        let seal = seals().load(&deps.storage, seal_id).unwrap();
        assert_eq!(
            seal.validators,
            vec![
                Addr::unchecked(VALIDATOR1),
                Addr::unchecked(VALIDATOR2),
                Addr::unchecked(VALIDATOR3)
            ]
        );
    }

    #[test]
    fn create_seal_below_min_validators_fails() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: vec![VALIDATOR1.to_string()], // Only 1, need 3
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidSealStatus {}));
    }

    #[test]
    fn create_seal_above_max_validators_fails() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let info = mock_info(REQUESTER, &[]);
        let validators: Vec<String> = (0..15).map(|i| format!("validator{}", i)).collect();

        let msg = ExecuteMsg::CreateSeal {
            job_id: "job123".to_string(),
            model_commitment: "model_hash".to_string(),
            input_commitment: "input_hash".to_string(),
            output_commitment: "output_hash".to_string(),
            validator_addresses: validators, // 15, max is 10
            expiration: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidSealStatus {}));
    }

    // ============ REVOKE SEAL TESTS ============

    #[test]
    fn revoke_seal_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let msg = ExecuteMsg::RevokeSeal {
            seal_id: seal_id.clone(),
            reason: "Test revocation".to_string(),
        };

        let res = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "revoke_seal"));

        let seal = seals().load(&deps.storage, seal_id).unwrap();
        assert_eq!(seal.status, SealStatus::Revoked);
        assert_eq!(seal.revocation_reason, Some("Test revocation".to_string()));
    }

    #[test]
    fn revoke_seal_not_requester_fails() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let info = mock_info("not_requester", &[]);
        let msg = ExecuteMsg::RevokeSeal {
            seal_id: seal_id.clone(),
            reason: "Test".to_string(),
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Unauthorized {}));
    }

    #[test]
    fn revoke_seal_not_active_fails() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        // Revoke once
        execute(
            deps.as_mut(),
            mock_env(),
            requester_info.clone(),
            ExecuteMsg::RevokeSeal {
                seal_id: seal_id.clone(),
                reason: "First".to_string(),
            },
        )
        .unwrap();

        // Try to revoke again
        let msg = ExecuteMsg::RevokeSeal {
            seal_id: seal_id.clone(),
            reason: "Second".to_string(),
        };

        let err = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidSealStatus {}));
    }

    // ============ VERIFY SEAL TESTS ============

    #[test]
    fn verify_active_seal_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let msg = ExecuteMsg::VerifySeal {
            seal_id: seal_id.clone(),
        };
        let res = execute(deps.as_mut(), mock_env(), mock_info("anyone", &[]), msg).unwrap();

        // C-02 FIX: VerifySeal now performs real validation
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "verify_seal"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "valid" && a.value == "true"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "status" && a.value == "active"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "validators" && a.value == "3"));
    }

    #[test]
    fn verify_revoked_seal_returns_invalid() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        // Revoke seal
        execute(
            deps.as_mut(),
            mock_env(),
            requester_info,
            ExecuteMsg::RevokeSeal {
                seal_id: seal_id.clone(),
                reason: "Test revoke".to_string(),
            },
        )
        .unwrap();

        // VerifySeal should return valid=false
        let res = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("anyone", &[]),
            ExecuteMsg::VerifySeal {
                seal_id: seal_id.clone(),
            },
        )
        .unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "valid" && a.value == "false"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "status" && a.value == "revoked"));
    }

    #[test]
    fn verify_nonexistent_seal_fails() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let err = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("anyone", &[]),
            ExecuteMsg::VerifySeal {
                seal_id: "nonexistent".to_string(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, ContractError::SealNotFound {}));
    }

    #[test]
    fn batch_verify_returns_accurate_counts() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let (seal_id1, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );
        let (seal_id2, _) = create_seal(
            deps.as_mut(),
            "requester2",
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        // Revoke seal_id1 so batch has mixed results
        execute(
            deps.as_mut(),
            mock_env(),
            requester_info,
            ExecuteMsg::RevokeSeal {
                seal_id: seal_id1.clone(),
                reason: "Test".to_string(),
            },
        )
        .unwrap();

        let res = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("anyone", &[]),
            ExecuteMsg::BatchVerify {
                seal_ids: vec![seal_id1, seal_id2, "nonexistent".to_string()],
            },
        )
        .unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "total" && a.value == "3"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "verified" && a.value == "1"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "failed" && a.value == "2"));
        // Should have 3 per-seal events
        assert_eq!(res.events.len(), 3);
    }

    // ============ M-08 FIX: SUPERSEDE VALIDATOR COUNT TESTS ============

    #[test]
    fn supersede_seal_below_min_validators_fails() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (old_seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let msg = ExecuteMsg::SupersedeSeal {
            old_seal_id,
            job_id: "job123".to_string(),
            model_commitment: "new_model".to_string(),
            input_commitment: "new_input".to_string(),
            output_commitment: "new_output".to_string(),
            validator_addresses: vec![VALIDATOR1.to_string()], // Only 1, need 3
        };

        let err = execute(deps.as_mut(), mock_env(), mock_info(REQUESTER, &[]), msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidSealStatus {}));
    }

    // ============ EXTEND EXPIRATION TESTS ============

    #[test]
    fn extend_expiration_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let original_seal = seals().load(&deps.storage, seal_id.clone()).unwrap();
        let original_expiry = original_seal.expires_at.unwrap();

        let msg = ExecuteMsg::ExtendExpiration {
            seal_id: seal_id.clone(),
            additional_seconds: 86400 * 30, // Add 30 days
        };

        let res = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "extend_expiration"));

        let updated_seal = seals().load(&deps.storage, seal_id).unwrap();
        assert!(updated_seal.expires_at.unwrap().seconds() > original_expiry.seconds());
    }

    // ============ SUPERSEDE SEAL TESTS ============

    #[test]
    fn supersede_seal_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (old_seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let msg = ExecuteMsg::SupersedeSeal {
            old_seal_id: old_seal_id.clone(),
            job_id: "job123".to_string(),
            model_commitment: "new_model_hash".to_string(),
            input_commitment: "new_input_hash".to_string(),
            output_commitment: "new_output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
        };

        let res = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap();

        let new_seal_id = res
            .attributes
            .iter()
            .find(|a| a.key == "new_seal_id")
            .map(|a| a.value.clone())
            .unwrap();

        // Old seal should be superseded
        let old_seal = seals().load(&deps.storage, old_seal_id).unwrap();
        assert_eq!(old_seal.status, SealStatus::Superseded);

        // New seal should be active
        let new_seal = seals().load(&deps.storage, new_seal_id).unwrap();
        assert_eq!(new_seal.status, SealStatus::Active);
        assert_eq!(new_seal.model_commitment, "new_model_hash");
    }

    #[test]
    fn supersede_seal_rejects_completed_job_and_preserves_old_seal() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (old_seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );
        set_job_status(&mut deps, "job123", JobStatusResponse::Completed);

        let msg = ExecuteMsg::SupersedeSeal {
            old_seal_id: old_seal_id.clone(),
            job_id: "job123".to_string(),
            model_commitment: "new_model_hash".to_string(),
            input_commitment: "new_input_hash".to_string(),
            output_commitment: "new_output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
        };

        let err = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap_err();
        assert!(err.to_string().contains("not in a valid state"));

        let old_seal = seals().load(&deps.storage, old_seal_id).unwrap();
        assert_eq!(old_seal.status, SealStatus::Active);
    }

    #[test]
    fn supersede_seal_rejects_missing_job_and_preserves_old_seal() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (old_seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );
        set_missing_job(&mut deps);

        let msg = ExecuteMsg::SupersedeSeal {
            old_seal_id: old_seal_id.clone(),
            job_id: "job123".to_string(),
            model_commitment: "new_model_hash".to_string(),
            input_commitment: "new_input_hash".to_string(),
            output_commitment: "new_output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
        };

        let err = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap_err();
        assert!(err.to_string().contains("not found"));

        let old_seal = seals().load(&deps.storage, old_seal_id).unwrap();
        assert_eq!(old_seal.status, SealStatus::Active);
    }

    #[test]
    fn supersede_seal_rejects_different_job_id() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (old_seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let msg = ExecuteMsg::SupersedeSeal {
            old_seal_id: old_seal_id.clone(),
            job_id: "job456".to_string(),
            model_commitment: "new_model_hash".to_string(),
            input_commitment: "new_input_hash".to_string(),
            output_commitment: "new_output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
        };

        let err = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidSealStatus {}));

        let old_seal = seals().load(&deps.storage, old_seal_id).unwrap();
        assert_eq!(old_seal.status, SealStatus::Active);
    }

    #[test]
    fn supersede_seal_duplicate_validators_do_not_satisfy_quorum() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (old_seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let msg = ExecuteMsg::SupersedeSeal {
            old_seal_id: old_seal_id.clone(),
            job_id: "job123".to_string(),
            model_commitment: "new_model_hash".to_string(),
            input_commitment: "new_input_hash".to_string(),
            output_commitment: "new_output_hash".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
            ],
        };

        let err = execute(deps.as_mut(), mock_env(), requester_info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidSealStatus {}));

        let old_seal = seals().load(&deps.storage, old_seal_id).unwrap();
        assert_eq!(old_seal.status, SealStatus::Active);
    }

    // ============ BATCH VERIFY TESTS ============

    #[test]
    fn batch_verify_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let (seal_id1, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );
        let (seal_id2, _) = create_seal(
            deps.as_mut(),
            "requester2",
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let msg = ExecuteMsg::BatchVerify {
            seal_ids: vec![seal_id1, seal_id2],
        };

        let res = execute(deps.as_mut(), mock_env(), mock_info("anyone", &[]), msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "batch_verify"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "total" && a.value == "2"));
    }

    // ============ UPDATE CONFIG TESTS ============

    #[test]
    fn update_config_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let msg = ExecuteMsg::UpdateConfig {
            min_validators: Some(2),
            max_validators: Some(15),
        };

        let res = execute(deps.as_mut(), mock_env(), mock_info(ADMIN, &[]), msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "update_config"));

        let config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(config.min_validators, 2);
        assert_eq!(config.max_validators, 15);
    }

    #[test]
    fn update_config_not_admin_fails() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let msg = ExecuteMsg::UpdateConfig {
            min_validators: Some(2),
            max_validators: None,
        };

        let err = execute(deps.as_mut(), mock_env(), mock_info("not_admin", &[]), msg).unwrap_err();
        assert!(matches!(err, ContractError::Unauthorized {}));
    }

    #[test]
    fn update_config_rejects_invalid_validator_bounds() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let msg = ExecuteMsg::UpdateConfig {
            min_validators: Some(11),
            max_validators: None,
        };

        let err = execute(deps.as_mut(), mock_env(), mock_info(ADMIN, &[]), msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidConfig { .. }));
        assert!(err.to_string().contains("min_validators"));
    }

    // ============ QUERY TESTS ============

    #[test]
    fn query_seal_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::Seal {
                seal_id: seal_id.clone(),
            },
        )
        .unwrap();
        let seal: Seal = from_json(&res).unwrap();

        assert_eq!(seal.id, seal_id);
        assert_eq!(seal.status, SealStatus::Active);
    }

    #[test]
    fn query_list_seals_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );
        create_seal(
            deps.as_mut(),
            "requester2",
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::ListSeals {
                status: None,
                requester: Some(REQUESTER.to_string()),
                limit: Some(10),
            },
        )
        .unwrap();

        let seals: Vec<Seal> = from_json(&res).unwrap();
        assert_eq!(seals.len(), 1);
        assert_eq!(seals[0].requester, Addr::unchecked(REQUESTER));
    }

    #[test]
    fn query_verify_active_seal() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::Verify {
                seal_id: seal_id.clone(),
            },
        )
        .unwrap();
        let verify_res: VerifyResponse = from_json(&res).unwrap();

        assert!(verify_res.valid);
        assert_eq!(verify_res.status, "active");
    }

    #[test]
    fn query_verify_revoked_seal() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, requester_info) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        // Revoke first
        execute(
            deps.as_mut(),
            mock_env(),
            requester_info,
            ExecuteMsg::RevokeSeal {
                seal_id: seal_id.clone(),
                reason: "Test".to_string(),
            },
        )
        .unwrap();

        let res = query(deps.as_ref(), mock_env(), QueryMsg::Verify { seal_id }).unwrap();
        let verify_res: VerifyResponse = from_json(&res).unwrap();

        assert!(!verify_res.valid);
        assert_eq!(verify_res.status, "revoked");
    }

    #[test]
    fn query_job_history_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::JobSealHistory {
                job_id: "job123".to_string(),
            },
        )
        .unwrap();
        let seals: Vec<Seal> = from_json(&res).unwrap();

        assert_eq!(seals.len(), 1);
        assert_eq!(seals[0].id, seal_id);
    }

    #[test]
    fn query_stats_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );
        create_seal(
            deps.as_mut(),
            "requester2",
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let res = query(deps.as_ref(), mock_env(), QueryMsg::Stats {}).unwrap();
        let stats: SealStats = from_json(&res).unwrap();

        assert_eq!(stats.total_seals, 2);
    }

    #[test]
    fn query_is_valid_works() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        let res = query(deps.as_ref(), mock_env(), QueryMsg::IsValid { seal_id }).unwrap();
        let is_valid: bool = from_json(&res).unwrap();

        assert!(is_valid);
    }

    // ============ EDGE CASE TESTS ============

    #[test]
    fn seal_id_generation_unique() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        let (seal_id1, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );
        let (seal_id2, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        assert_ne!(seal_id1, seal_id2);
    }

    #[test]
    fn expired_seal_query_returns_invalid() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());
        let (seal_id, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        // Seal was created with expiration = 60 days from mock_env().block.time
        // Advance time past that expiry (mock_env time + 61 days)
        let mut env = mock_env();
        env.block.time = mock_env().block.time.plus_seconds(86400 * 61);

        let res = query(deps.as_ref(), env, QueryMsg::Verify { seal_id }).unwrap();
        let verify_res: VerifyResponse = from_json(&res).unwrap();

        assert!(!verify_res.valid);
        assert_eq!(verify_res.status, "expired");
    }

    #[test]
    fn multiple_seals_same_job() {
        let mut deps = mock_deps_with_wasm();
        setup_contract(deps.as_mut());

        // Create multiple seals for same job
        let (seal_id1, _) = create_seal(
            deps.as_mut(),
            REQUESTER,
            vec![VALIDATOR1, VALIDATOR2, VALIDATOR3],
        );

        // Supersede with new seal
        let msg = ExecuteMsg::SupersedeSeal {
            old_seal_id: seal_id1.clone(),
            job_id: "job123".to_string(),
            model_commitment: "new_model".to_string(),
            input_commitment: "new_input".to_string(),
            output_commitment: "new_output".to_string(),
            validator_addresses: vec![
                VALIDATOR1.to_string(),
                VALIDATOR2.to_string(),
                VALIDATOR3.to_string(),
            ],
        };

        execute(deps.as_mut(), mock_env(), mock_info(REQUESTER, &[]), msg).unwrap();

        // Query history
        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::JobSealHistory {
                job_id: "job123".to_string(),
            },
        )
        .unwrap();
        let seals: Vec<Seal> = from_json(&res).unwrap();

        assert_eq!(seals.len(), 2);
    }
}
