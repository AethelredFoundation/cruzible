/**
 * MSW Handlers - API Mocking for Tests
 * Replaces hardcoded mock data with request interception
 */

import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:3000/v1';

export const handlers = [
  // =============================================================================
  // BLOCKS
  // =============================================================================
  
  http.get(`${API_BASE}/blocks`, ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const blocks = Array.from({ length: limit }, (_, i) => ({
      height: 1000000 - (page - 1) * limit - i,
      hash: `0x${'a'.repeat(64)}`,
      timestamp: new Date().toISOString(),
      proposer: 'aethelred1validator1',
      num_txs: Math.floor(Math.random() * 100),
      gas_used: 1000000,
      gas_limit: 30000000,
    }));
    
    return HttpResponse.json({
      success: true,
      data: blocks,
      pagination: {
        page,
        limit,
        total: 1000000,
        has_more: true,
      },
    });
  }),

  http.get(`${API_BASE}/blocks/:height`, ({ params }) => {
    const height = params.height;
    
    return HttpResponse.json({
      success: true,
      data: {
        height: parseInt(height as string),
        hash: `0x${'b'.repeat(64)}`,
        timestamp: new Date().toISOString(),
        proposer: 'aethelred1validator1',
        num_txs: 10,
        gas_used: 500000,
        gas_limit: 30000000,
        transactions: [],
      },
    });
  }),

  // =============================================================================
  // TRANSACTIONS
  // =============================================================================
  
  http.get(`${API_BASE}/transactions`, ({ request }) => {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const transactions = Array.from({ length: limit }, (_, i) => ({
      hash: `0x${'c'.repeat(64)}${i}`,
      block_height: 1000000 - i,
      sender: 'aethelred1sender1',
      recipient: 'aethelred1recipient1',
      amount: '1000000',
      denom: 'aeth',
      gas_used: 100000,
      gas_wanted: 200000,
      status: 'success',
      timestamp: new Date().toISOString(),
    }));
    
    return HttpResponse.json({
      success: true,
      data: transactions,
      pagination: {
        page,
        limit,
        total: 100000,
        has_more: true,
      },
    });
  }),

  http.get(`${API_BASE}/transactions/:hash`, ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: {
        hash: params.hash,
        block_height: 1000000,
        sender: 'aethelred1sender1',
        recipient: 'aethelred1recipient1',
        amount: '1000000',
        denom: 'aeth',
        gas_used: 100000,
        gas_wanted: 200000,
        status: 'success',
        timestamp: new Date().toISOString(),
      },
    });
  }),

  // =============================================================================
  // VALIDATORS
  // =============================================================================
  
  http.get(`${API_BASE}/validators`, () => {
    const validators = [
      {
        address: 'aethelred1validator1',
        moniker: 'Aethelred Foundation',
        status: 'active',
        voting_power: 1000000,
        commission: 0.05,
        uptime: 0.9999,
        total_staked: '1000000000',
      },
      {
        address: 'aethelred1validator2',
        moniker: 'Paradigm Stake',
        status: 'active',
        voting_power: 800000,
        commission: 0.03,
        uptime: 0.9995,
        total_staked: '800000000',
      },
      {
        address: 'aethelred1validator3',
        moniker: 'a16z Validator',
        status: 'active',
        voting_power: 600000,
        commission: 0.04,
        uptime: 0.9998,
        total_staked: '600000000',
      },
    ];
    
    return HttpResponse.json({
      success: true,
      data: validators,
      pagination: {
        page: 1,
        limit: 50,
        total: 3,
        has_more: false,
      },
    });
  }),

  http.get(`${API_BASE}/validators/:address`, ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: {
        address: params.address,
        moniker: 'Aethelred Foundation',
        status: 'active',
        voting_power: 1000000,
        commission: 0.05,
        uptime: 0.9999,
        total_staked: '1000000000',
        delegators: 1000,
        website: 'https://aethelred.io',
        description: 'Official Aethelred Foundation validator',
      },
    });
  }),

  // =============================================================================
  // AI JOBS
  // =============================================================================
  
  http.get(`${API_BASE}/jobs`, () => {
    const jobs = [
      {
        id: 'job_123456',
        creator: 'aethelred1creator1',
        validator: 'aethelred1validator1',
        status: 'verified',
        model_hash: '0x' + 'd'.repeat(64),
        input_hash: '0x' + 'e'.repeat(64),
        output_hash: '0x' + 'f'.repeat(64),
        max_payment: '1000000',
        actual_payment: '800000',
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        verification_score: 9500,
      },
    ];
    
    return HttpResponse.json({
      success: true,
      data: jobs,
      pagination: {
        page: 1,
        limit: 50,
        total: 1,
        has_more: false,
      },
    });
  }),

  // =============================================================================
  // STAKING
  // =============================================================================
  
  http.get(`${API_BASE}/staking/validators`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        validators: [
          { address: 'aethelred1validator1', moniker: 'Aethelred Foundation', commission: 0.05 },
          { address: 'aethelred1validator2', moniker: 'Paradigm Stake', commission: 0.03 },
        ],
      },
    });
  }),

  http.get(`${API_BASE}/staking/:address`, ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: {
        address: params.address,
        staked_amount: '1000000000',
        rewards: '5000000',
        unbonding: '0',
        validators: [
          { address: 'aethelred1validator1', amount: '500000000' },
          { address: 'aethelred1validator2', amount: '500000000' },
        ],
      },
    });
  }),

  // =============================================================================
  // HEALTH
  // =============================================================================
  
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        database: 'connected',
        redis: 'connected',
        blockchain: 'connected',
      },
    });
  }),
];
