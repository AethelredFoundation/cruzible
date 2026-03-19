/**
 * Blockchain Service
 *
 * Handles all blockchain interactions using CosmJS and Tendermint RPC
 */

import { injectable } from "tsyringe";
import { Tendermint34Client, TxSearchResponse } from "@cosmjs/tendermint-rpc";
import {
  StargateClient,
  QueryClient,
  setupBankExtension,
  setupStakingExtension,
  setupDistributionExtension,
  setupGovExtension,
} from "@cosmjs/stargate";
import { HttpBatchClient } from "@cosmjs/tendermint-rpc";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  Block,
  Transaction,
  Validator,
  NetworkStats,
  PaginatedResponse,
} from "../types";
import { bytesToHex, computeEligibleUniverseHash } from "../lib/protocolSdk";

type ExtendedQueryClient = QueryClient & {
  staking: {
    validator(address: string): Promise<{ validator?: any }>;
    validators(
      status: string,
      paginationKey: Uint8Array,
    ): Promise<{ validators: any[] }>;
  };
};

@injectable()
export class BlockchainService {
  private tmClient: Tendermint34Client | null = null;
  private sgClient: StargateClient | null = null;
  private queryClient: ExtendedQueryClient | null = null;

  async initialize(): Promise<void> {
    try {
      // Initialize Tendermint client with batching for performance
      const httpClient = new HttpBatchClient(config.rpcUrl, {
        batchSizeLimit: 20,
        dispatchInterval: 50,
      });
      this.tmClient = await Tendermint34Client.create(httpClient);

      // Initialize Stargate client
      this.sgClient = await StargateClient.connect(config.rpcUrl);

      // Setup query client with extensions
      this.queryClient = QueryClient.withExtensions(
        this.tmClient,
        setupBankExtension,
        setupStakingExtension,
        setupDistributionExtension,
        setupGovExtension,
      ) as ExtendedQueryClient;

      logger.info("Blockchain service initialized");
    } catch (error) {
      logger.error("Failed to initialize blockchain service:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.sgClient) {
      await this.sgClient.disconnect();
    }
    logger.info("Blockchain service disconnected");
  }

  // ============== BLOCK METHODS ==============

  async getBlocks(options: {
    limit?: number;
    offset?: number;
    height?: number;
  }): Promise<PaginatedResponse<Block>> {
    const { limit = 20, offset = 0, height } = options;

    if (!this.tmClient) throw new Error("Client not initialized");

    let blocks: Block[] = [];

    if (height) {
      // Get specific block
      const block = await this.getBlockByHeight(height);
      if (block) blocks = [block];
    } else {
      // Get latest blocks
      const latestHeight = await this.getLatestHeight();
      const startHeight = Math.max(1, latestHeight - offset);
      const endHeight = Math.max(1, startHeight - limit + 1);

      const blockPromises: Promise<Block | null>[] = [];
      for (let h = startHeight; h >= endHeight; h--) {
        blockPromises.push(this.getBlockByHeight(h));
      }

      const results = await Promise.all(blockPromises);
      blocks = results.filter((b): b is Block => b !== null);
    }

    return {
      data: blocks,
      pagination: {
        limit,
        offset,
        total: await this.getLatestHeight(),
        hasMore: blocks.length === limit,
      },
    };
  }

  async getLatestBlock(): Promise<Block> {
    if (!this.tmClient) throw new Error("Client not initialized");

    const response = await this.tmClient.block();
    return this.mapBlockResponse(response);
  }

  async getBlockByHeight(height: number): Promise<Block | null> {
    if (!this.tmClient) throw new Error("Client not initialized");

    try {
      const response = await this.tmClient.block(height);
      return this.mapBlockResponse(response);
    } catch (error) {
      return null;
    }
  }

  async getLatestHeight(): Promise<number> {
    if (!this.tmClient) throw new Error("Client not initialized");

    const status = await this.tmClient.status();
    return status.syncInfo.latestBlockHeight;
  }

  async getBlockTransactions(
    height: number,
    options: { limit?: number; offset?: number },
  ): Promise<PaginatedResponse<Transaction>> {
    const { limit = 50, offset = 0 } = options;

    if (!this.tmClient) throw new Error("Client not initialized");

    // Search for transactions in block
    const query = `tx.height=${height}`;
    const response: TxSearchResponse = await this.tmClient.txSearch({
      query,
      per_page: limit,
      page: Math.floor(offset / limit) + 1,
    });

    const transactions = response.txs.map(this.mapTransactionResponse);

    return {
      data: transactions,
      pagination: {
        limit,
        offset,
        total: response.totalCount,
        hasMore: offset + transactions.length < response.totalCount,
      },
    };
  }

  // ============== TRANSACTION METHODS ==============

  async getTransactions(options: {
    limit?: number;
    offset?: number;
    type?: string;
    address?: string;
    block?: number;
  }): Promise<PaginatedResponse<Transaction>> {
    const { limit = 20, offset = 0, address, block } = options;

    if (!this.tmClient) throw new Error("Client not initialized");

    // Build query
    let query = "";
    if (block) {
      query = `tx.height=${block}`;
    } else if (address) {
      query = `transfer.recipient='${address}' OR transfer.sender='${address}'`;
    }

    if (!query) {
      // No query - return empty or fetch recent from indexer
      return {
        data: [],
        pagination: { limit, offset, total: 0, hasMore: false },
      };
    }

    const response = await this.tmClient.txSearch({
      query,
      per_page: limit,
      page: Math.floor(offset / limit) + 1,
    });

    const transactions = response.txs.map(this.mapTransactionResponse);

    return {
      data: transactions,
      pagination: {
        limit,
        offset,
        total: response.totalCount,
        hasMore: offset + transactions.length < response.totalCount,
      },
    };
  }

  async getTransactionByHash(hash: string): Promise<Transaction | null> {
    if (!this.tmClient) throw new Error("Client not initialized");

    try {
      const response = await this.tmClient.tx({
        hash: Buffer.from(hash, "hex"),
      });
      return this.mapTransactionResponse(response);
    } catch (error) {
      return null;
    }
  }

  // ============== VALIDATOR METHODS ==============

  async getValidators(options: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<PaginatedResponse<Validator>> {
    if (!this.queryClient) throw new Error("Client not initialized");

    const { limit = 50, offset = 0, status = "BOND_STATUS_BONDED" } = options;

    const response = await this.queryClient.staking.validators(
      status,
      Buffer.from(String(offset)),
    );

    const validators: Validator[] = response.validators
      .slice(0, limit)
      .map((v) => ({
        address: v.operatorAddress,
        moniker: v.description?.moniker || "",
        identity: v.description?.identity || "",
        website: v.description?.website || "",
        details: v.description?.details || "",
        tokens: v.tokens,
        delegatorShares: v.delegatorShares,
        commission: {
          rate: v.commission?.commissionRates?.rate || "0",
          maxRate: v.commission?.commissionRates?.maxRate || "0",
          maxChangeRate: v.commission?.commissionRates?.maxChangeRate || "0",
        },
        status: v.status,
        jailed: v.jailed,
        unbondingHeight: Number(v.unbondingHeight),
        unbondingTime: v.unbondingTime?.getTime() || 0,
      }));

    const eligibleUniverseHash = bytesToHex(
      computeEligibleUniverseHash(
        validators.map((validator) => validator.address),
      ),
    );

    return {
      data: validators,
      pagination: {
        limit,
        offset,
        total: response.validators.length, // Approximate
        hasMore: response.validators.length === limit,
      },
      protocol: {
        eligibleUniverseHash,
      },
    };
  }

  async getValidator(address: string): Promise<Validator | null> {
    if (!this.queryClient) throw new Error("Client not initialized");

    try {
      const response = await this.queryClient.staking.validator(address);
      const v = response.validator;

      if (!v) return null;

      return {
        address: v.operatorAddress,
        moniker: v.description?.moniker || "",
        identity: v.description?.identity || "",
        website: v.description?.website || "",
        details: v.description?.details || "",
        tokens: v.tokens,
        delegatorShares: v.delegatorShares,
        commission: {
          rate: v.commission?.commissionRates?.rate || "0",
          maxRate: v.commission?.commissionRates?.maxRate || "0",
          maxChangeRate: v.commission?.commissionRates?.maxChangeRate || "0",
        },
        status: v.status,
        jailed: v.jailed,
        unbondingHeight: Number(v.unbondingHeight),
        unbondingTime: v.unbondingTime?.getTime() || 0,
      };
    } catch (error) {
      return null;
    }
  }

  // ============== NETWORK STATS ==============

  async getNetworkStats(): Promise<NetworkStats> {
    if (!this.tmClient || !this.queryClient) {
      throw new Error("Client not initialized");
    }

    const [latestHeight, validators] = await Promise.all([
      this.getLatestHeight(),
      this.queryClient.staking.validators(
        "BOND_STATUS_BONDED",
        Buffer.from(""),
      ),
    ]);

    // Calculate total staked
    const totalStaked = validators.validators.reduce(
      (acc, v) => acc + BigInt(v.tokens),
      BigInt(0),
    );

    return {
      blockHeight: latestHeight,
      totalTransactions: 0, // Would need indexer
      totalAccounts: 0, // Would need indexer
      totalValidators: validators.validators.length,
      activeValidators: validators.validators.filter((v) => !v.jailed).length,
      totalStaked: totalStaked.toString(),
      inflationRate: 0.07, // Would query mint module
      communityPool: "0", // Would query distribution
    };
  }

  // ============== HELPER METHODS ==============

  private mapBlockResponse(response: any): Block {
    const block = response.block;
    const blockId = response.blockId;

    return {
      height: response.block.header.height,
      hash: Buffer.from(blockId.hash).toString("hex").toUpperCase(),
      parentHash: Buffer.from(block.header.lastBlockId?.hash || [])
        .toString("hex")
        .toUpperCase(),
      timestamp: new Date(block.header.time).toISOString(),
      proposer: block.header.proposerAddress,
      txCount: block.txs.length,
      gasUsed: 0, // Would need to decode txs
      gasLimit: 30000000,
      size: JSON.stringify(block).length,
      appHash: Buffer.from(block.header.appHash).toString("hex").toUpperCase(),
    };
  }

  private mapTransactionResponse(tx: any): Transaction {
    return {
      hash: Buffer.from(tx.hash).toString("hex").toUpperCase(),
      height: tx.height,
      index: tx.index,
      gasUsed: tx.txResult?.gasUsed || 0,
      gasWanted: tx.txResult?.gasWanted || 0,
      code: tx.txResult?.code || 0,
      log: tx.txResult?.log || "",
      timestamp: tx.height, // Would need to fetch block
      memo: "", // Would need to decode
      messages: [], // Would need to decode
    };
  }

  // Raw client access for advanced queries
  getTmClient(): Tendermint34Client {
    if (!this.tmClient) throw new Error("Client not initialized");
    return this.tmClient;
  }

  getSgClient(): StargateClient {
    if (!this.sgClient) throw new Error("Client not initialized");
    return this.sgClient;
  }

  getQueryClient(): QueryClient {
    if (!this.queryClient) throw new Error("Client not initialized");
    return this.queryClient;
  }
}
