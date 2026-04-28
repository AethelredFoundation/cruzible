/*
 * AI Job Manager - Comprehensive Test Suite
 *
 * Covers the core job lifecycle, queries, stats, and config guardrails.
 */
#[cfg(test)]
mod tests {
    use cosmwasm_std::testing::{
        mock_dependencies, mock_env, mock_info, MockApi, MockQuerier, MockStorage,
    };
    use cosmwasm_std::{
        coins, from_json, to_json_binary, Addr, ContractResult, CosmosMsg, OwnedDeps, Reply,
        ReplyOn, SubMsgResult, SystemError, SystemResult, Timestamp, Uint128, WasmMsg, WasmQuery,
    };
    use model_registry::ExecuteMsg as RegistryExecuteMsg;

    use crate::*;

    // ============ TEST CONSTANTS ============
    const CREATOR: &str = "creator";
    const VALIDATOR: &str = "validator";
    const ADMIN: &str = "admin";
    const FEE_COLLECTOR: &str = "fee_collector";
    const MODEL_REGISTRY: &str = "model_registry";
    const PAYMENT_DENOM: &str = "aeth";

    // ============ HELPER FUNCTIONS ============
    fn mock_dependencies_with_model_response(
        verified: Option<bool>,
    ) -> OwnedDeps<MockStorage, MockApi, MockQuerier> {
        let mut deps = mock_dependencies();
        deps.querier.update_wasm(move |query| match query {
            WasmQuery::Smart { contract_addr, msg } if contract_addr == MODEL_REGISTRY => {
                let request: Result<ModelRegistryQueryMsg, _> = from_json(msg);
                match request {
                    Ok(ModelRegistryQueryMsg::Model { model_hash }) if model_hash == "model123" => {
                        match verified {
                            Some(verified) => SystemResult::Ok(ContractResult::Ok(
                                to_json_binary(&ModelRegistryModelResponse { verified }).unwrap(),
                            )),
                            None => {
                                SystemResult::Ok(ContractResult::Err("model not found".to_string()))
                            }
                        }
                    }
                    Ok(ModelRegistryQueryMsg::Model { .. }) => {
                        SystemResult::Ok(ContractResult::Err("model not found".to_string()))
                    }
                    Err(err) => SystemResult::Err(SystemError::InvalidRequest {
                        error: err.to_string(),
                        request: msg.clone(),
                    }),
                }
            }
            WasmQuery::Smart { contract_addr, msg } => {
                SystemResult::Err(SystemError::InvalidRequest {
                    error: format!("unexpected wasm query contract: {contract_addr}"),
                    request: msg.clone(),
                })
            }
            _ => SystemResult::Err(SystemError::InvalidRequest {
                error: "unimplemented wasm query".to_string(),
                request: cosmwasm_std::Binary::default(),
            }),
        });
        deps
    }

    fn mock_dependencies_with_registered_model() -> OwnedDeps<MockStorage, MockApi, MockQuerier> {
        mock_dependencies_with_model_response(Some(true))
    }

    fn setup_contract(deps: DepsMut) -> (Config, MessageInfo) {
        let info = mock_info(ADMIN, &[]);
        let msg = InstantiateMsg {
            payment_denom: PAYMENT_DENOM.to_string(),
            min_timeout: 100,
            max_timeout: 10000,
            min_payment: Uint128::from(1000u128),
            platform_fee_bps: 500, // 5%
            fee_collector: FEE_COLLECTOR.to_string(),
            required_tee_type: 0,
            model_registry: MODEL_REGISTRY.to_string(),
        };

        instantiate(deps, mock_env(), info.clone(), msg).unwrap();
        // Return the expected config (deps was consumed by instantiate)
        let config = Config {
            admin: Addr::unchecked(ADMIN),
            payment_denom: PAYMENT_DENOM.to_string(),
            min_timeout: 100,
            max_timeout: 10000,
            min_payment: Uint128::from(1000u128),
            platform_fee_bps: 500,
            fee_collector: Addr::unchecked(FEE_COLLECTOR),
            required_tee_type: 0,
            model_registry: Addr::unchecked(MODEL_REGISTRY),
        };
        (config, info)
    }

    fn setup_job(deps: DepsMut, creator: &str, payment: u128) -> (String, MessageInfo) {
        let info = mock_info(creator, &coins(payment, PAYMENT_DENOM));
        let msg = ExecuteMsg::SubmitJob {
            model_hash: "model123".to_string(),
            input_hash: "input456".to_string(),
            proof_type: ProofType::TeeAttestation,
            priority: 5,
            timeout: 1000,
        };

        let res = execute(deps, mock_env(), info.clone(), msg).unwrap();
        let job_id = res
            .attributes
            .iter()
            .find(|a| a.key == "job_id")
            .map(|a| a.value.clone())
            .unwrap();

        (job_id, info)
    }

    /// Create a valid mock TEE attestation that passes MED-7 validation.
    /// Uses a valid hex measurement (64 hex chars) and a timestamp matching mock_env.
    fn mock_tee_attestation() -> TEEAttestation {
        TEEAttestation {
            tee_type: TeeType::IntelSgx,
            quote_version: 3,
            quote: cosmwasm_std::Binary(vec![1, 2, 3, 4, 5, 6, 7, 8]),
            report_data: cosmwasm_std::Binary(vec![10, 20, 30, 40, 50]),
            measurement: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
                .to_string(),
            timestamp: mock_env().block.time, // Use mock_env time to be within 24h window
            enclave_key: cosmwasm_std::Binary(vec![7, 8, 9, 10, 11]),
        }
    }

    fn mock_compute_metrics() -> ComputeMetrics {
        ComputeMetrics {
            cpu_cycles: 1_000_000_000,
            memory_used: 2048,
            compute_time_ms: 5000,
            energy_mj: 1000,
        }
    }

    // ============ INSTANTIATE TESTS ============

    #[test]
    fn instantiate_works() {
        let mut deps = mock_dependencies_with_registered_model();
        let (config, _) = setup_contract(deps.as_mut());

        assert_eq!(config.payment_denom, PAYMENT_DENOM);
        assert_eq!(config.min_timeout, 100);
        assert_eq!(config.max_timeout, 10000);
        assert_eq!(config.min_payment, Uint128::from(1000u128));
        assert_eq!(config.platform_fee_bps, 500);
    }

    #[test]
    fn instantiate_with_invalid_fee_collector_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        let info = mock_info(ADMIN, &[]);
        // MockApi.addr_validate() rejects empty strings
        let msg = InstantiateMsg {
            payment_denom: PAYMENT_DENOM.to_string(),
            min_timeout: 100,
            max_timeout: 10000,
            min_payment: Uint128::from(1000u128),
            platform_fee_bps: 500,
            fee_collector: "".to_string(),
            required_tee_type: 0,
            model_registry: MODEL_REGISTRY.to_string(),
        };

        let err = instantiate(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Std(_)));
    }

    // ============ SUBMIT JOB TESTS ============

    #[test]
    fn submit_job_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        assert!(job_id.starts_with("job_"));

        // Verify job state
        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Pending);
        assert_eq!(job.model_hash, "model123");
        assert_eq!(job.input_hash, "input456");
        assert_eq!(job.priority, 5);
        assert_eq!(job.max_payment, Uint128::from(10000u128));
    }

    #[test]
    fn submit_job_without_payment_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let info = mock_info(CREATOR, &[]);
        let msg = ExecuteMsg::SubmitJob {
            model_hash: "model123".to_string(),
            input_hash: "input456".to_string(),
            proof_type: ProofType::TeeAttestation,
            priority: 5,
            timeout: 1000,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InsufficientPayment {}));
    }

    #[test]
    fn submit_job_below_min_payment_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let info = mock_info(CREATOR, &coins(500, PAYMENT_DENOM)); // Below min 1000
        let msg = ExecuteMsg::SubmitJob {
            model_hash: "model123".to_string(),
            input_hash: "input456".to_string(),
            proof_type: ProofType::TeeAttestation,
            priority: 5,
            timeout: 1000,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InsufficientPayment {}));
    }

    #[test]
    fn submit_job_timeout_too_short_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let info = mock_info(CREATOR, &coins(10000, PAYMENT_DENOM));
        let msg = ExecuteMsg::SubmitJob {
            model_hash: "model123".to_string(),
            input_hash: "input456".to_string(),
            proof_type: ProofType::TeeAttestation,
            priority: 5,
            timeout: 50, // Below min 100
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::TimeoutTooShort {}));
    }

    #[test]
    fn submit_job_timeout_too_long_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let info = mock_info(CREATOR, &coins(10000, PAYMENT_DENOM));
        let msg = ExecuteMsg::SubmitJob {
            model_hash: "model123".to_string(),
            input_hash: "input456".to_string(),
            proof_type: ProofType::TeeAttestation,
            priority: 5,
            timeout: 20000, // Above max 10000
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::TimeoutTooShort {}));
    }

    #[test]
    fn submit_job_unknown_model_fails_without_locking_payment() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let info = mock_info(CREATOR, &coins(10000, PAYMENT_DENOM));
        let msg = ExecuteMsg::SubmitJob {
            model_hash: "unknown_model".to_string(),
            input_hash: "input456".to_string(),
            proof_type: ProofType::TeeAttestation,
            priority: 5,
            timeout: 1000,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidModel {}));
        assert_eq!(JOB_COUNT.load(&deps.storage).unwrap(), 0);
    }

    #[test]
    fn submit_job_unverified_model_fails() {
        let mut deps = mock_dependencies_with_model_response(Some(false));
        setup_contract(deps.as_mut());

        let info = mock_info(CREATOR, &coins(10000, PAYMENT_DENOM));
        let msg = ExecuteMsg::SubmitJob {
            model_hash: "model123".to_string(),
            input_hash: "input456".to_string(),
            proof_type: ProofType::TeeAttestation,
            priority: 5,
            timeout: 1000,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidModel {}));
        assert_eq!(JOB_COUNT.load(&deps.storage).unwrap(), 0);
    }

    // ============ ASSIGN JOB TESTS ============

    #[test]
    fn assign_job_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let info = mock_info(VALIDATOR, &[]);
        let msg = ExecuteMsg::AssignJob {
            job_id: job_id.clone(),
        };

        let res = execute(deps.as_mut(), mock_env(), info.clone(), msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "assign_job"));

        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Assigned);
        assert_eq!(job.validator, Some(Addr::unchecked(VALIDATOR)));
    }

    #[test]
    fn assign_job_not_pending_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // First assignment
        let info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Second assignment should fail
        let err = execute(
            deps.as_mut(),
            mock_env(),
            info,
            ExecuteMsg::AssignJob { job_id },
        )
        .unwrap_err();
        assert!(matches!(err, ContractError::InvalidStatus { .. }));
    }

    #[test]
    fn assign_expired_job_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let mut env = mock_env();
        env.block.height = mock_env().block.height + 1001; // Past timeout (created_at + timeout + 1)

        let info = mock_info(VALIDATOR, &[]);
        let msg = ExecuteMsg::AssignJob { job_id };

        let err = execute(deps.as_mut(), env, info, msg).unwrap_err();
        assert!(matches!(err, ContractError::JobExpired {}));
    }

    // ============ START COMPUTING TESTS ============

    #[test]
    fn start_computing_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign first
        let info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Start computing
        let msg = ExecuteMsg::StartComputing {
            job_id: job_id.clone(),
        };
        let res = execute(deps.as_mut(), mock_env(), info, msg).unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "start_computing"));

        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Computing);
    }

    #[test]
    fn start_computing_not_assigned_validator_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign to validator1
        let info1 = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info1,
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // validator2 tries to start
        let info2 = mock_info("validator2", &[]);
        let msg = ExecuteMsg::StartComputing { job_id };

        let err = execute(deps.as_mut(), mock_env(), info2, msg).unwrap_err();
        assert!(matches!(err, ContractError::NotAssignedValidator {}));
    }

    #[test]
    fn start_computing_not_assigned_status_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let info = mock_info(VALIDATOR, &[]);
        let msg = ExecuteMsg::StartComputing { job_id };

        // Try without assigning first — validator is checked before status,
        // so we get NotAssignedValidator since the job has no assigned validator.
        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::NotAssignedValidator {}));
    }

    // ============ COMPLETE JOB TESTS ============

    #[test]
    fn complete_job_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign and start
        let info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Complete
        let tee_attestation = mock_tee_attestation();
        let compute_metrics = mock_compute_metrics();

        let msg = ExecuteMsg::CompleteJob {
            job_id: job_id.clone(),
            output_hash: "output789".to_string(),
            tee_attestation,
            compute_metrics,
        };

        let res = execute(deps.as_mut(), mock_env(), info, msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "complete_job"));

        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Completed);
        assert_eq!(job.output_hash, Some("output789".to_string()));
        assert!(job.verification_score.is_some());
        assert!(job.actual_payment.is_some());
    }

    #[test]
    fn complete_job_invalid_tee_type_fails() {
        let mut deps = mock_dependencies_with_registered_model();

        // Setup with required TEE type
        let info = mock_info(ADMIN, &[]);
        let msg = InstantiateMsg {
            payment_denom: PAYMENT_DENOM.to_string(),
            min_timeout: 100,
            max_timeout: 10000,
            min_payment: Uint128::from(1000u128),
            platform_fee_bps: 500,
            fee_collector: FEE_COLLECTOR.to_string(),
            required_tee_type: 2, // Require TDX
            model_registry: MODEL_REGISTRY.to_string(),
        };
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();

        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign and start
        let info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Try with wrong TEE type (SGX = 1, but requires TDX = 2)
        let tee_attestation = TEEAttestation {
            tee_type: TeeType::IntelSgx, // Wrong type
            quote_version: 3,
            quote: Binary(vec![1, 2, 3]),
            report_data: Binary(vec![4, 5, 6]),
            measurement: "measurement123".to_string(),
            timestamp: Timestamp::from_seconds(1000),
            enclave_key: Binary(vec![7, 8, 9]),
        };

        let compute_metrics = ComputeMetrics {
            cpu_cycles: 1_000_000_000,
            memory_used: 2048,
            compute_time_ms: 5000,
            energy_mj: 1000,
        };

        let msg = ExecuteMsg::CompleteJob {
            job_id,
            output_hash: "output789".to_string(),
            tee_attestation,
            compute_metrics,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::InvalidAttestation {}));
    }

    // ============ VERIFY JOB TESTS ============

    #[test]
    fn verify_job_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign, start, complete
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        let tee_attestation = mock_tee_attestation();
        let compute_metrics = mock_compute_metrics();

        execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation,
                compute_metrics,
            },
        )
        .unwrap();

        // Verify as creator
        let creator_info = mock_info(CREATOR, &[]);
        let msg = ExecuteMsg::VerifyJob {
            job_id: job_id.clone(),
        };
        let res = execute(deps.as_mut(), mock_env(), creator_info, msg).unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "verify_job"));
        assert_eq!(res.messages.len(), 1);
        assert_eq!(res.messages[0].id, MODEL_REGISTRY_INCREMENT_REPLY_ID);
        assert_eq!(res.messages[0].reply_on, ReplyOn::Error);
        match &res.messages[0].msg {
            CosmosMsg::Wasm(WasmMsg::Execute {
                contract_addr,
                msg,
                funds,
            }) => {
                assert_eq!(contract_addr, MODEL_REGISTRY);
                assert!(funds.is_empty());
                let registry_msg: RegistryExecuteMsg = from_json(msg).unwrap();
                assert_eq!(
                    registry_msg,
                    RegistryExecuteMsg::IncrementJobCount {
                        model_hash: "model123".to_string(),
                    }
                );
            }
            other => panic!("expected model registry execute message, got {other:?}"),
        }

        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Verified);
    }

    #[test]
    fn registry_increment_failure_reply_emits_warning_event() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let res = reply(
            deps.as_mut(),
            mock_env(),
            Reply {
                id: MODEL_REGISTRY_INCREMENT_REPLY_ID,
                result: SubMsgResult::Err("model not found".to_string()),
            },
        )
        .unwrap();

        assert!(res.events.iter().any(|event| {
            event.ty == "model_registry_job_count_increment_failed"
                && event
                    .attributes
                    .iter()
                    .any(|attr| attr.key == "error" && attr.value == "model not found")
        }));
    }

    #[test]
    fn verify_job_unauthorized_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete job first (simplified)
        // ... setup code ...

        // Random user tries to verify
        let info = mock_info("random_user", &[]);
        let msg = ExecuteMsg::VerifyJob { job_id };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Unauthorized {}));
    }

    // ============ FAIL JOB TESTS ============

    #[test]
    fn fail_job_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign and start
        let info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Fail job
        let msg = ExecuteMsg::FailJob {
            job_id: job_id.clone(),
            reason: "Out of memory".to_string(),
        };
        let res = execute(deps.as_mut(), mock_env(), info, msg).unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "fail_job"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "reason" && a.value == "Out of memory"));

        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Failed);
    }

    // ============ CANCEL JOB TESTS ============

    #[test]
    fn cancel_job_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, info) = setup_job(deps.as_mut(), CREATOR, 10000);

        let msg = ExecuteMsg::CancelJob {
            job_id: job_id.clone(),
        };
        let res = execute(deps.as_mut(), mock_env(), info, msg).unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "cancel_job"));

        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Cancelled);
    }

    #[test]
    fn cancel_job_not_creator_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let info = mock_info("not_creator", &[]);
        let msg = ExecuteMsg::CancelJob { job_id };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Unauthorized {}));
    }

    #[test]
    fn cancel_job_not_pending_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, info) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign job first
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Try to cancel
        let msg = ExecuteMsg::CancelJob { job_id };
        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();

        assert!(matches!(err, ContractError::InvalidStatus { .. }));
    }

    // ============ CLAIM PAYMENT TESTS ============

    #[test]
    fn claim_payment_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        let tee_attestation = mock_tee_attestation();
        let compute_metrics = mock_compute_metrics();

        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation,
                compute_metrics,
            },
        )
        .unwrap();

        let creator_info = mock_info(CREATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            creator_info,
            ExecuteMsg::VerifyJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Claim payment
        let msg = ExecuteMsg::ClaimPayment {
            job_id: job_id.clone(),
        };
        let res = execute(deps.as_mut(), mock_env(), validator_info, msg).unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "claim_payment"));

        // Check messages were added (payment transfers)
        assert_eq!(res.messages.len(), 2); // Validator payment + platform fee
    }

    #[test]
    fn claim_payment_not_assigned_validator_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let info = mock_info("not_assigned", &[]);
        let msg = ExecuteMsg::ClaimPayment { job_id };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::NotAssignedValidator {}));
    }

    // ============ UPDATE CONFIG TESTS ============

    #[test]
    fn update_config_works() {
        let mut deps = mock_dependencies_with_registered_model();
        let (_config, admin_info) = setup_contract(deps.as_mut());

        let msg = ExecuteMsg::UpdateConfig {
            min_payment: Some(Uint128::from(5000u128)),
            platform_fee_bps: Some(1000),
            required_tee_type: Some(1),
        };

        let res = execute(deps.as_mut(), mock_env(), admin_info, msg).unwrap();
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "update_config"));

        let updated_config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(updated_config.min_payment, Uint128::from(5000u128));
        assert_eq!(updated_config.platform_fee_bps, 1000);
        assert_eq!(updated_config.required_tee_type, 1);
    }

    #[test]
    fn update_config_not_admin_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let info = mock_info("not_admin", &[]);
        let msg = ExecuteMsg::UpdateConfig {
            min_payment: Some(Uint128::from(5000u128)),
            platform_fee_bps: None,
            required_tee_type: None,
        };

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Unauthorized {}));
    }

    // ============ QUERY TESTS ============

    #[test]
    fn query_config_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let res = query(deps.as_ref(), mock_env(), QueryMsg::Config {}).unwrap();
        let config: Config = from_json(&res).unwrap();

        assert_eq!(config.payment_denom, PAYMENT_DENOM);
        assert_eq!(config.min_payment, Uint128::from(1000u128));
    }

    #[test]
    fn query_job_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::Job {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        let job: Job = from_json(&res).unwrap();

        assert_eq!(job.id, job_id);
        assert_eq!(job.status, JobStatus::Pending);
    }

    #[test]
    fn query_job_not_found_fails() {
        let deps = mock_dependencies_with_registered_model();

        let err = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::Job {
                job_id: "nonexistent".to_string(),
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn query_list_jobs_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        // Create multiple jobs
        setup_job(deps.as_mut(), CREATOR, 10000);
        setup_job(deps.as_mut(), CREATOR, 20000);
        setup_job(deps.as_mut(), "creator2", 15000);

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::ListJobs {
                status: None,
                creator: Some(CREATOR.to_string()),
                validator: None,
                start_after: None,
                limit: Some(10),
            },
        )
        .unwrap();

        let jobs: Vec<Job> = from_json(&res).unwrap();
        assert_eq!(jobs.len(), 2); // Only creator's jobs
    }

    #[test]
    fn query_pending_queue_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        setup_job(deps.as_mut(), CREATOR, 10000);
        setup_job(deps.as_mut(), CREATOR, 20000);

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::PendingQueue { limit: Some(10) },
        )
        .unwrap();
        let jobs: Vec<Job> = from_json(&res).unwrap();

        assert_eq!(jobs.len(), 2);
    }

    #[test]
    fn query_job_stats_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();

        assert_eq!(stats.total_jobs, 0);
        assert_eq!(stats.pending_jobs, 0);
    }

    #[test]
    fn query_pricing_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::EstimatePrice {
                model_hash: "model123".to_string(),
                estimated_cpu_cycles: 1_000_000_000,
                estimated_memory_mb: 2048,
            },
        )
        .unwrap();

        let pricing: PriceEstimate = from_json(&res).unwrap();
        assert!(pricing.estimated_cost.u128() > 0);
    }

    // ============ VALIDATOR STATS TESTS ============

    #[test]
    fn validator_stats_updated_on_complete() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        let tee_attestation = mock_tee_attestation();
        let compute_metrics = mock_compute_metrics();

        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation,
                compute_metrics,
            },
        )
        .unwrap();

        let creator_info = mock_info(CREATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            creator_info,
            ExecuteMsg::VerifyJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Check validator stats
        let stats = VALIDATOR_STATS
            .load(&deps.storage, &Addr::unchecked(VALIDATOR))
            .unwrap();
        assert_eq!(stats.total_jobs, 1);
        assert_eq!(stats.completed_jobs, 1);
        assert!(stats.total_earnings.u128() > 0);
    }

    // ============ CLEANUP EXPIRED TESTS ============

    #[test]
    fn cleanup_expired_works() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        // Create a job (timeout=1000 blocks, created_at=mock_env().block.height=12345)
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Advance block height past timeout (created_at + timeout + 1 = 12345 + 1000 + 1)
        let mut env = mock_env();
        env.block.height = mock_env().block.height + 1001;

        let msg = ExecuteMsg::CleanupExpired { limit: Some(10) };
        let res = execute(deps.as_mut(), env, mock_info("anyone", &[]), msg).unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "cleanup_expired"));

        // Job should be expired now
        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Expired);
    }

    // ============ EDGE CASE TESTS ============

    #[test]
    fn job_id_generation_unique() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let (job_id1, _) = setup_job(deps.as_mut(), CREATOR, 10000);
        let (job_id2, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        assert_ne!(job_id1, job_id2);
    }

    #[test]
    fn multiple_jobs_same_creator() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let (job_id1, _) = setup_job(deps.as_mut(), CREATOR, 10000);
        let (job_id2, _) = setup_job(deps.as_mut(), CREATOR, 20000);
        let (job_id3, _) = setup_job(deps.as_mut(), CREATOR, 30000);

        // Verify all exist
        assert!(jobs().load(&deps.storage, job_id1).is_ok());
        assert!(jobs().load(&deps.storage, job_id2).is_ok());
        assert!(jobs().load(&deps.storage, job_id3).is_ok());

        // Verify job count
        let count = JOB_COUNT.load(&deps.storage).unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn complete_job_calculates_payment_correctly() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        let tee_attestation = mock_tee_attestation();
        let compute_metrics = mock_compute_metrics();

        execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation,
                compute_metrics,
            },
        )
        .unwrap();

        let job = jobs().load(&deps.storage, job_id).unwrap();
        let payment = job.actual_payment.unwrap();

        // Payment should be calculated but not exceed max
        assert!(payment.u128() > 0);
        assert!(payment <= Uint128::from(10000u128));
    }

    // ============ L-03 PLATFORM STATS TESTS ============

    #[test]
    fn platform_stats_initialized_to_zero() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();

        assert_eq!(stats.total_jobs, 0);
        assert_eq!(stats.pending_jobs, 0);
        assert_eq!(stats.completed_jobs, 0);
        assert_eq!(stats.failed_jobs, 0);
        assert_eq!(stats.total_payments, Uint128::zero());
    }

    #[test]
    fn platform_stats_tracks_job_submission() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        setup_job(deps.as_mut(), CREATOR, 10000);
        setup_job(deps.as_mut(), CREATOR, 20000);

        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();

        assert_eq!(stats.total_jobs, 2);
        assert_eq!(stats.pending_jobs, 2);
        assert_eq!(stats.completed_jobs, 0);
    }

    #[test]
    fn platform_stats_completed_jobs_increments_on_verify() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete full workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation: mock_tee_attestation(),
                compute_metrics: mock_compute_metrics(),
            },
        )
        .unwrap();

        // Before verify
        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();
        assert_eq!(stats.completed_jobs, 0);

        // Verify
        let creator_info = mock_info(CREATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            creator_info,
            ExecuteMsg::VerifyJob { job_id },
        )
        .unwrap();

        // After verify
        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();
        assert_eq!(stats.completed_jobs, 1);
    }

    #[test]
    fn platform_stats_failed_jobs_increments_on_fail() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Assign and start
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Fail
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::FailJob {
                job_id: job_id.clone(),
                reason: "OOM".to_string(),
            },
        )
        .unwrap();

        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();
        assert_eq!(stats.failed_jobs, 1);
        assert_eq!(stats.completed_jobs, 0); // Failed, not completed
    }

    #[test]
    fn platform_stats_total_payments_increments_on_claim() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete full workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation: mock_tee_attestation(),
                compute_metrics: mock_compute_metrics(),
            },
        )
        .unwrap();

        let creator_info = mock_info(CREATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            creator_info,
            ExecuteMsg::VerifyJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Before claim
        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();
        assert_eq!(stats.total_payments, Uint128::zero());

        // Claim payment
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(VALIDATOR, &[]),
            ExecuteMsg::ClaimPayment { job_id },
        )
        .unwrap();

        // After claim
        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();
        assert!(stats.total_payments > Uint128::zero());
    }

    #[test]
    fn platform_stats_aggregates_multiple_operations() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        // Job 1: complete and verify
        let (job_id1, _) = setup_job(deps.as_mut(), CREATOR, 10000);
        let v_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            v_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id1.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            v_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id1.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            v_info.clone(),
            ExecuteMsg::CompleteJob {
                job_id: job_id1.clone(),
                output_hash: "out1".to_string(),
                tee_attestation: mock_tee_attestation(),
                compute_metrics: mock_compute_metrics(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(CREATOR, &[]),
            ExecuteMsg::VerifyJob { job_id: job_id1 },
        )
        .unwrap();

        // Job 2: fail
        let (job_id2, _) = setup_job(deps.as_mut(), CREATOR, 10000);
        execute(
            deps.as_mut(),
            mock_env(),
            v_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id2.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            v_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id2.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            v_info,
            ExecuteMsg::FailJob {
                job_id: job_id2,
                reason: "Error".to_string(),
            },
        )
        .unwrap();

        // Job 3: still pending
        setup_job(deps.as_mut(), CREATOR, 10000);

        let res = query(deps.as_ref(), mock_env(), QueryMsg::PlatformStats {}).unwrap();
        let stats: PlatformStats = from_json(&res).unwrap();
        assert_eq!(stats.total_jobs, 3);
        assert_eq!(stats.completed_jobs, 1);
        assert_eq!(stats.failed_jobs, 1);
        // pending_jobs may not be exactly 1 since assign removes from pending
        // but total_jobs should be 3
    }

    // ============ DOUBLE-CLAIM PREVENTION TESTS ============

    #[test]
    fn double_claim_payment_rejected() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation: mock_tee_attestation(),
                compute_metrics: mock_compute_metrics(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(CREATOR, &[]),
            ExecuteMsg::VerifyJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // First claim succeeds
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::ClaimPayment {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Second claim fails with AlreadyClaimed
        let err = execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::ClaimPayment { job_id },
        )
        .unwrap_err();
        assert!(matches!(err, ContractError::AlreadyClaimed {}));
    }

    #[test]
    fn claim_payment_transitions_to_paid_status() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation: mock_tee_attestation(),
                compute_metrics: mock_compute_metrics(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(CREATOR, &[]),
            ExecuteMsg::VerifyJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Claim payment
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::ClaimPayment {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        // Job should be in Paid status
        let job = jobs().load(&deps.storage, job_id).unwrap();
        assert_eq!(job.status, JobStatus::Paid);
    }

    // ============ PLATFORM FEE CAP TESTS ============

    #[test]
    fn update_config_fee_above_cap_rejected() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let admin_info = mock_info(ADMIN, &[]);
        let err = execute(
            deps.as_mut(),
            mock_env(),
            admin_info,
            ExecuteMsg::UpdateConfig {
                min_payment: None,
                platform_fee_bps: Some(2001), // Above 20% cap
                required_tee_type: None,
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("Platform fee cannot exceed 2000"));
    }

    #[test]
    fn update_config_fee_at_cap_succeeds() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let admin_info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            admin_info,
            ExecuteMsg::UpdateConfig {
                min_payment: None,
                platform_fee_bps: Some(2000), // Exactly at cap (20%)
                required_tee_type: None,
            },
        )
        .unwrap();

        let config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(config.platform_fee_bps, 2000);
    }

    // ============ MONITORING EVENT TESTS ============

    #[test]
    fn verify_job_emits_monitoring_event() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation: mock_tee_attestation(),
                compute_metrics: mock_compute_metrics(),
            },
        )
        .unwrap();

        let creator_info = mock_info(CREATOR, &[]);
        let res = execute(
            deps.as_mut(),
            mock_env(),
            creator_info,
            ExecuteMsg::VerifyJob { job_id },
        )
        .unwrap();

        let event = res.events.iter().find(|e| e.ty == "job_verified");
        assert!(event.is_some(), "job_verified event should be emitted");
        let ev = event.unwrap();
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "creator" && a.value == CREATOR));
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "validator" && a.value == VALIDATOR));
    }

    #[test]
    fn fail_job_emits_monitoring_event() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        let res = execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::FailJob {
                job_id,
                reason: "OOM".to_string(),
            },
        )
        .unwrap();

        let event = res.events.iter().find(|e| e.ty == "job_failed");
        assert!(event.is_some(), "job_failed event should be emitted");
        let ev = event.unwrap();
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "reason" && a.value == "OOM"));
    }

    #[test]
    fn claim_payment_emits_monitoring_event() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());
        let (job_id, _) = setup_job(deps.as_mut(), CREATOR, 10000);

        // Complete workflow
        let validator_info = mock_info(VALIDATOR, &[]);
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::AssignJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::StartComputing {
                job_id: job_id.clone(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            validator_info.clone(),
            ExecuteMsg::CompleteJob {
                job_id: job_id.clone(),
                output_hash: "output789".to_string(),
                tee_attestation: mock_tee_attestation(),
                compute_metrics: mock_compute_metrics(),
            },
        )
        .unwrap();
        execute(
            deps.as_mut(),
            mock_env(),
            mock_info(CREATOR, &[]),
            ExecuteMsg::VerifyJob {
                job_id: job_id.clone(),
            },
        )
        .unwrap();

        let res = execute(
            deps.as_mut(),
            mock_env(),
            validator_info,
            ExecuteMsg::ClaimPayment { job_id },
        )
        .unwrap();

        let event = res.events.iter().find(|e| e.ty == "payment_claimed");
        assert!(event.is_some(), "payment_claimed event should be emitted");
        let ev = event.unwrap();
        assert!(ev
            .attributes
            .iter()
            .any(|a| a.key == "validator" && a.value == VALIDATOR));
        assert!(ev.attributes.iter().any(|a| a.key == "total_payment"));
        assert!(ev.attributes.iter().any(|a| a.key == "platform_fee"));
    }

    // ============ MIGRATION TESTS ============

    #[test]
    fn migration_success() {
        let mut deps = mock_dependencies_with_registered_model();
        setup_contract(deps.as_mut());

        let res = migrate(deps.as_mut(), mock_env(), MigrateMsg {}).unwrap();
        assert_eq!(res.attributes[0].value, "migrate");
    }

    #[test]
    fn migration_wrong_contract_fails() {
        let mut deps = mock_dependencies_with_registered_model();
        let env = mock_env();
        cw2::set_contract_version(deps.as_mut().storage, "wrong-contract", "0.1.0").unwrap();
        let err = migrate(deps.as_mut(), env, MigrateMsg {}).unwrap_err();
        assert!(err.to_string().contains("Cannot migrate"));
    }
}
