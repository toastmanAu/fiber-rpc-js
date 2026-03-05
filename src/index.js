'use strict';

/**
 * fiber-rpc-js — Nervos Fiber Network RPC Client
 *
 * JSON-RPC 2.0 client for the Fiber Network node RPC.
 * Supports optional Biscuit authentication for nodes listening on public addresses.
 *
 * Usage:
 *   const { FiberClient } = require('fiber-rpc-js');
 *   const client = new FiberClient({ url: 'http://127.0.0.1:8227' });
 *   const { channels } = await client.listChannels();
 */

const axios = require('axios');

// ── Hex helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a BigInt or number to a 0x-prefixed hex string.
 * Fiber RPC uses hex-encoded u64/u128 values throughout.
 */
function toHex(value) {
  return '0x' + BigInt(value).toString(16);
}

/**
 * Convert a 0x-prefixed hex string to a BigInt.
 */
function fromHex(hex) {
  if (!hex || hex === '0x0') return BigInt(0);
  return BigInt(hex);
}

/**
 * Convert Shannon (smallest CKB unit) to CKB for display.
 * 1 CKB = 100,000,000 Shannon.
 */
function shannonToCKB(shannonHex) {
  return Number(fromHex(shannonHex)) / 1e8;
}

// ── Errors ─────────────────────────────────────────────────────────────────────

class FiberRpcError extends Error {
  constructor(code, message, data) {
    super(`Fiber RPC error ${code}: ${message}`);
    this.name = 'FiberRpcError';
    this.code = code;
    this.data = data;
  }
}

class FiberConnectionError extends Error {
  constructor(url, cause) {
    super(`Failed to connect to Fiber node at ${url}: ${cause.message}`);
    this.name = 'FiberConnectionError';
    this.url = url;
    this.cause = cause;
  }
}

// ── Core RPC transport ─────────────────────────────────────────────────────────

class FiberRpcTransport {
  constructor({ url, biscuitToken, timeoutMs = 10000 }) {
    this.url = url;
    this.biscuitToken = biscuitToken || null;
    this.timeoutMs = timeoutMs;
    this._id = 1;

    this._http = axios.create({
      baseURL: url,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(biscuitToken ? { Authorization: `Bearer ${biscuitToken}` } : {}),
      },
    });
  }

  async call(method, params = {}) {
    const id = this._id++;
    const body = {
      jsonrpc: '2.0',
      id,
      method,
      params: [params],
    };

    let response;
    try {
      response = await this._http.post('/', body);
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        throw new FiberConnectionError(this.url, err);
      }
      throw err;
    }

    const { data } = response;

    if (data.error) {
      throw new FiberRpcError(data.error.code, data.error.message, data.error.data);
    }

    return data.result;
  }
}

// ── FiberClient ────────────────────────────────────────────────────────────────

class FiberClient {
  /**
   * @param {object} options
   * @param {string}  options.url           - Fiber node RPC URL, e.g. 'http://127.0.0.1:8227'
   * @param {string}  [options.biscuitToken] - Biscuit auth token (required if node has biscuit_public_key set)
   * @param {number}  [options.timeoutMs]    - Request timeout in ms (default 10000)
   */
  constructor(options) {
    if (!options || !options.url) throw new Error('FiberClient: options.url is required');
    this._rpc = new FiberRpcTransport(options);
  }

  // ── Channel methods ──────────────────────────────────────────────────────────

  /**
   * Open a payment channel with a peer.
   *
   * @param {object} params
   * @param {string}  params.peerId          - Peer's libp2p PeerId
   * @param {bigint|number|string} params.fundingAmount - Amount in Shannon (smallest CKB unit)
   * @param {boolean} [params.isPublic=true]  - Whether channel is announced to the network
   * @param {boolean} [params.isOneWay=false] - One-way (no remote funding)
   * @returns {{ temporaryChannelId: string }}
   */
  async openChannel({ peerId, fundingAmount, isPublic = true, isOneWay = false, ...rest }) {
    const result = await this._rpc.call('open_channel', {
      peer_id: peerId,
      funding_amount: toHex(fundingAmount),
      public: isPublic,
      one_way: isOneWay,
      ...rest,
    });
    return { temporaryChannelId: result.temporary_channel_id };
  }

  /**
   * List channels, optionally filtered by peer.
   *
   * @param {object}  [params]
   * @param {string}  [params.peerId]          - Filter by peer PeerId
   * @param {boolean} [params.includeClosed=false] - Include closed channels
   * @returns {{ channels: ChannelInfo[] }}
   */
  async listChannels({ peerId, includeClosed = false } = {}) {
    const result = await this._rpc.call('list_channels', {
      ...(peerId ? { peer_id: peerId } : {}),
      include_closed: includeClosed,
    });
    return {
      channels: (result.channels || []).map(this._parseChannel),
    };
  }

  /**
   * Get info about a specific channel by ID.
   */
  async getChannel(channelId) {
    const { channels } = await this.listChannels({ includeClosed: true });
    const ch = channels.find(c => c.channelId === channelId);
    if (!ch) throw new Error(`Channel not found: ${channelId}`);
    return ch;
  }

  // ── Payment methods ──────────────────────────────────────────────────────────

  /**
   * Send a payment via an invoice string or directly to a pubkey.
   *
   * @param {object} params
   * @param {string}  [params.invoice]        - Encoded invoice string (preferred)
   * @param {string}  [params.targetPubkey]   - Recipient pubkey (if no invoice)
   * @param {bigint|number|string} [params.amount] - Amount in Shannon (if no invoice)
   * @param {bigint|number|string} [params.maxFeeAmount] - Max fee in Shannon
   * @param {boolean} [params.dryRun=false]   - Validate without sending
   * @returns {{ paymentHash: string, status: string }}
   */
  async sendPayment({ invoice, targetPubkey, amount, maxFeeAmount, dryRun = false, ...rest }) {
    const params = { dry_run: dryRun, ...rest };
    if (invoice)       params.invoice        = invoice;
    if (targetPubkey)  params.target_pubkey  = targetPubkey;
    if (amount)        params.amount         = toHex(amount);
    if (maxFeeAmount)  params.max_fee_amount = toHex(maxFeeAmount);

    const result = await this._rpc.call('send_payment', params);
    return this._parsePayment(result);
  }

  /**
   * Get the status of a payment by its hash.
   *
   * @param {string} paymentHash - 0x-prefixed hash
   * @returns {{ paymentHash: string, status: string, fee: bigint }}
   */
  async getPayment(paymentHash) {
    const result = await this._rpc.call('get_payment', { payment_hash: paymentHash });
    return this._parsePayment(result);
  }

  // ── Invoice methods ──────────────────────────────────────────────────────────

  /**
   * Create a new invoice.
   *
   * @param {object} params
   * @param {bigint|number|string} params.amount  - Amount in Shannon
   * @param {string}  [params.description]         - Human-readable description
   * @param {string}  [params.currency='Fibb']      - 'Fibb' (mainnet), 'Fibt' (testnet), 'Fibd' (dev)
   * @param {number}  [params.expirySeconds=3600]  - Invoice expiry in seconds
   * @returns {{ invoiceAddress: string, invoice: object }}
   */
  async newInvoice({ amount, description, currency = 'Fibb', expirySeconds = 3600, ...rest }) {
    const result = await this._rpc.call('new_invoice', {
      amount: toHex(amount),
      currency,
      ...(description ? { description } : {}),
      expiry: toHex(expirySeconds),
      ...rest,
    });
    return {
      invoiceAddress: result.invoice_address,
      invoice: result.invoice,
    };
  }

  /**
   * Look up an invoice by payment hash.
   *
   * @param {string} paymentHash - 0x-prefixed hash
   * @returns {{ invoiceAddress: string, invoice: object, status: string }}
   */
  async getInvoice(paymentHash) {
    const result = await this._rpc.call('get_invoice', { payment_hash: paymentHash });
    return {
      invoiceAddress: result.invoice_address,
      invoice: result.invoice,
      status: result.status,
    };
  }

  // ── Node info ────────────────────────────────────────────────────────────────

  /**
   * Get node info (peer ID, addresses, version).
   */
  async nodeInfo() {
    const result = await this._rpc.call('node_info', {});
    return result;
  }

  /**
   * List connected peers.
   */
  async listPeers() {
    const result = await this._rpc.call('list_peers', {});
    return result;
  }

  // ── Internal parsers ─────────────────────────────────────────────────────────

  _parseChannel(ch) {
    return {
      channelId:       ch.channel_id,
      isPublic:        ch.is_public,
      isAcceptor:      ch.is_acceptor,
      isOneWay:        ch.is_one_way,
      channelOutpoint: ch.channel_outpoint,
      peerId:          ch.peer_id,
      state:           ch.state?.state_name,
      localBalance:    fromHex(ch.local_balance),
      remoteBalance:   fromHex(ch.remote_balance),
      localBalanceCKB: shannonToCKB(ch.local_balance),
      remoteBalanceCKB: shannonToCKB(ch.remote_balance),
      enabled:         ch.enabled,
      createdAt:       ch.created_at,
      raw:             ch,
    };
  }

  _parsePayment(p) {
    return {
      paymentHash: p.payment_hash,
      status:      p.status,
      fee:         p.fee ? fromHex(p.fee) : undefined,
      feesCKB:     p.fee ? shannonToCKB(p.fee) : undefined,
      raw:         p,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  FiberClient,
  FiberRpcError,
  FiberConnectionError,
  toHex,
  fromHex,
  shannonToCKB,
};
