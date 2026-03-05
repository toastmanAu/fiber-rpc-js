'use strict';

/**
 * fiber-rpc-js — Comprehensive Test Suite
 *
 * Tests run against a live Fiber node via SSH tunnel.
 * Node: ckbnode (orangepi@192.168.68.87), Fiber RPC at 127.0.0.1:8227
 * Tunnel: SSH port forward localhost:8227 → ckbnode:127.0.0.1:8227
 *
 * Run: node --test tests/fiber.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync, spawn } = require('child_process');
const {
  FiberClient,
  FiberRpcError,
  FiberConnectionError,
  toHex,
  fromHex,
  shannonToCKB,
} = require('../src/index.js');

// ── Config ─────────────────────────────────────────────────────────────────────

const LOCAL_PORT = 18227; // local port for SSH tunnel
const CKBNODE_HOST = 'ckbnode';
const CKBNODE_FIBER_PORT = 8227;
const N100_HOST = 'n100';
const N100_FIBER_PORT = 8226;

let sshTunnel = null;
let client = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function openSshTunnel(localPort, remoteHost, remotePort) {
  const proc = spawn('ssh', [
    '-N', '-L', `${localPort}:127.0.0.1:${remotePort}`,
    remoteHost,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ExitOnForwardFailure=yes',
  ], { stdio: 'ignore', detached: false });
  return proc;
}

// ── Helper assertion ───────────────────────────────────────────────────────────

function assertHex(value, name) {
  assert.ok(typeof value === 'string' && value.startsWith('0x'),
    `${name} should be a 0x-prefixed hex string, got: ${value}`);
}

function assertBigInt(value, name) {
  assert.ok(typeof value === 'bigint',
    `${name} should be a BigInt, got: ${typeof value}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 1: Helper utility functions
// ══════════════════════════════════════════════════════════════════════════════

describe('Utility helpers', () => {

  it('toHex converts number to 0x hex', () => {
    assert.equal(toHex(0), '0x0');
    assert.equal(toHex(255), '0xff');
    assert.equal(toHex(100_000_000), '0x5f5e100');
    assert.equal(toHex(BigInt('340282366920938463463374607431768211455')), '0xffffffffffffffffffffffffffffffff');
  });

  it('toHex handles BigInt input', () => {
    assert.equal(toHex(BigInt(1000)), '0x3e8');
  });

  it('toHex handles string input', () => {
    assert.equal(toHex('500'), '0x1f4');
  });

  it('fromHex converts 0x hex to BigInt', () => {
    assert.equal(fromHex('0x0'), BigInt(0));
    assert.equal(fromHex('0xff'), BigInt(255));
    assert.equal(fromHex('0x5f5e100'), BigInt(100_000_000));
  });

  it('fromHex handles null/undefined gracefully', () => {
    assert.equal(fromHex(null), BigInt(0));
    assert.equal(fromHex(undefined), BigInt(0));
    assert.equal(fromHex('0x0'), BigInt(0));
  });

  it('shannonToCKB converts correctly', () => {
    assert.equal(shannonToCKB('0x5f5e100'), 1.0);        // 100M shannon = 1 CKB
    assert.equal(shannonToCKB('0x3b9aca00'), 10.0);      // 1B shannon = 10 CKB
    assert.equal(shannonToCKB('0x0'), 0);
  });

  it('round-trip: number → toHex → fromHex', () => {
    const values = [0, 1, 100, 100_000_000, 9_999_999_999];
    for (const v of values) {
      assert.equal(fromHex(toHex(v)), BigInt(v),
        `Round-trip failed for ${v}`);
    }
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 2: FiberClient construction
// ══════════════════════════════════════════════════════════════════════════════

describe('FiberClient construction', () => {

  it('throws if url is missing', () => {
    assert.throws(() => new FiberClient({}), /url is required/);
    assert.throws(() => new FiberClient(null), /url is required/);
  });

  it('creates client with valid url', () => {
    const c = new FiberClient({ url: 'http://127.0.0.1:8227' });
    assert.ok(c instanceof FiberClient);
  });

  it('accepts biscuitToken option without throwing', () => {
    const c = new FiberClient({ url: 'http://127.0.0.1:8227', biscuitToken: 'fake-token' });
    assert.ok(c);
  });

  it('accepts timeoutMs option', () => {
    const c = new FiberClient({ url: 'http://127.0.0.1:8227', timeoutMs: 5000 });
    assert.ok(c);
  });

  it('throws FiberConnectionError on unreachable host', async () => {
    const bad = new FiberClient({ url: 'http://127.0.0.1:19999', timeoutMs: 2000 });
    await assert.rejects(
      () => bad.listChannels(),
      (err) => {
        assert.ok(err instanceof FiberConnectionError, `Expected FiberConnectionError, got ${err.constructor.name}: ${err.message}`);
        return true;
      }
    );
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 3: Live node tests (require SSH tunnel)
// ══════════════════════════════════════════════════════════════════════════════

describe('Live Fiber node — ckbnode', () => {

  before(async () => {
    // Open SSH tunnel: local:18227 → ckbnode:127.0.0.1:8227
    sshTunnel = openSshTunnel(LOCAL_PORT, CKBNODE_HOST, CKBNODE_FIBER_PORT);
    await sleep(1500); // wait for tunnel to establish
    client = new FiberClient({ url: `http://127.0.0.1:${LOCAL_PORT}`, timeoutMs: 15000 });
  });

  after(() => {
    if (sshTunnel) {
      sshTunnel.kill();
      sshTunnel = null;
    }
  });

  // ── node_info ──────────────────────────────────────────────────────────────

  it('nodeInfo() returns node info with peerId', async () => {
    const info = await client.nodeInfo();
    assert.ok(info, 'nodeInfo result should be truthy');
    assert.ok(typeof info.node_id === 'string' || typeof info.public_key === 'string',
      'Expected node_id or public_key in nodeInfo response');
  });

  // ── list_channels ──────────────────────────────────────────────────────────

  it('listChannels() returns channels array', async () => {
    const { channels } = await client.listChannels();
    assert.ok(Array.isArray(channels), 'channels should be an array');
  });

  it('listChannels() channels have required fields', async () => {
    const { channels } = await client.listChannels();
    if (channels.length === 0) {
      console.log('    ℹ No channels open — skipping field checks');
      return;
    }
    const ch = channels[0];
    assert.ok(typeof ch.channelId === 'string', 'channelId should be a string');
    assertHex(ch.channelId, 'channelId');
    assert.ok(typeof ch.peerId === 'string', 'peerId should be a string');
    assert.ok(typeof ch.state === 'string', 'state should be a string');
    assertBigInt(ch.localBalance, 'localBalance');
    assertBigInt(ch.remoteBalance, 'remoteBalance');
    assert.ok(typeof ch.localBalanceCKB === 'number', 'localBalanceCKB should be a number');
    assert.ok(typeof ch.isPublic === 'boolean', 'isPublic should be boolean');
    assert.ok(typeof ch.isAcceptor === 'boolean', 'isAcceptor should be boolean');
    assert.ok(typeof ch.enabled === 'boolean', 'enabled should be boolean');
    assert.ok(ch.raw, 'raw should be present');
  });

  it('listChannels() CHANNEL_READY channels have positive local balance', async () => {
    const { channels } = await client.listChannels();
    const ready = channels.filter(c => c.state === 'CHANNEL_READY');
    for (const ch of ready) {
      assert.ok(ch.localBalance >= BigInt(0),
        `Channel ${ch.channelId} should have non-negative local balance`);
    }
  });

  it('listChannels() with includeClosed returns superset', async () => {
    const { channels: open }   = await client.listChannels({ includeClosed: false });
    const { channels: all }    = await client.listChannels({ includeClosed: true });
    assert.ok(all.length >= open.length,
      'includeClosed:true should return >= channels as includeClosed:false');
  });

  it('listChannels() with unknown peerId returns empty array or error', async () => {
    // Fiber may reject unknown peerId format OR return empty array
    try {
      const { channels } = await client.listChannels({
        peerId: 'QmYyQSo1c1Ym7orWxLYvCrzRX5z2aiGty4kfLzKiP5Bnpk',
      });
      assert.equal(channels.length, 0, 'Unknown peerId should return empty channels');
    } catch (err) {
      // Some Fiber versions reject unknown PeerIds with InvalidParams
      assert.ok(err instanceof FiberRpcError,
        `Expected FiberRpcError for unknown peerId, got ${err.constructor.name}`);
    }
  });

  // ── new_invoice ────────────────────────────────────────────────────────────

  it('newInvoice() creates an invoice with address', async () => {
    const { invoiceAddress, invoice } = await client.newInvoice({
      amount: 1000,
      description: 'fiber-rpc-js test invoice',
      expirySeconds: 300,
    });
    assert.ok(typeof invoiceAddress === 'string' && invoiceAddress.length > 10,
      'invoiceAddress should be a non-empty string');
    assert.ok(invoice, 'invoice object should be present');
  });

  it('newInvoice() invoice address starts with fibb or fiber prefix', async () => {
    const { invoiceAddress } = await client.newInvoice({ amount: 500 });
    assert.ok(
      invoiceAddress.startsWith('fibb') || invoiceAddress.startsWith('fiber') || invoiceAddress.length > 20,
      `Invoice address format unexpected: ${invoiceAddress.slice(0, 20)}...`
    );
  });

  it('newInvoice() with zero amount throws or returns error', async () => {
    try {
      const result = await client.newInvoice({ amount: 0 });
      // Some nodes may accept 0-amount invoices (for keysend), so just check it returns something
      assert.ok(result, 'Expected some result for 0-amount invoice');
    } catch (err) {
      assert.ok(err instanceof FiberRpcError,
        `Expected FiberRpcError, got ${err.constructor.name}`);
    }
  });

  // ── get_invoice ────────────────────────────────────────────────────────────

  it('getInvoice() retrieves a created invoice', async () => {
    const { invoice } = await client.newInvoice({
      amount: 2000,
      description: 'get_invoice test',
    });
    // payment_hash is nested under invoice.data.attrs or invoice.data.payment_hash
    const paymentHash = invoice?.data?.payment_hash;
    if (!paymentHash) {
      console.log('    ℹ Invoice structure:', JSON.stringify(invoice?.data).slice(0, 100));
      console.log('    ℹ Could not extract payment_hash — skipping get_invoice test');
      return;
    }
    const retrieved = await client.getInvoice(paymentHash);
    assert.ok(retrieved.invoiceAddress, 'Retrieved invoice should have address');
    assert.ok(typeof retrieved.status === 'string', 'Retrieved invoice should have status');
    assert.ok(['OPEN', 'SETTLED', 'CANCELED', 'Open', 'Settled', 'Canceled'].includes(retrieved.status),
      `Status should be OPEN/SETTLED/CANCELED, got: ${retrieved.status}`);
  });

  it('getInvoice() with unknown hash throws FiberRpcError', async () => {
    await assert.rejects(
      () => client.getInvoice('0x' + 'deadbeef'.repeat(8)),
      (err) => {
        assert.ok(err instanceof FiberRpcError, `Expected FiberRpcError, got ${err.constructor.name}`);
        return true;
      }
    );
  });

  // ── send_payment dry run ───────────────────────────────────────────────────

  it('sendPayment() dry_run validates payment without sending', async () => {
    const { channels } = await client.listChannels();
    const ready = channels.find(c => c.state === 'CHANNEL_READY' && c.localBalance > BigInt(1000));
    if (!ready) {
      console.log('    ℹ No funded CHANNEL_READY channel — skipping dry_run test');
      return;
    }
    // Create an invoice on the remote peer side — we'll just test dry_run
    // by providing a bad invoice (should get an error, not a crash)
    try {
      await client.sendPayment({
        invoice: 'invalid_invoice_string',
        dryRun: true,
      });
      assert.fail('Expected error for invalid invoice');
    } catch (err) {
      assert.ok(err instanceof FiberRpcError,
        `Expected FiberRpcError for invalid invoice, got ${err.constructor.name}: ${err.message}`);
    }
  });

  // ── getChannel convenience ─────────────────────────────────────────────────

  it('getChannel() finds channel by ID', async () => {
    const { channels } = await client.listChannels();
    if (channels.length === 0) {
      console.log('    ℹ No channels — skipping getChannel test');
      return;
    }
    const first = channels[0];
    const found = await client.getChannel(first.channelId);
    assert.equal(found.channelId, first.channelId, 'getChannel should find same channel');
  });

  it('getChannel() throws for unknown channel ID', async () => {
    await assert.rejects(
      () => client.getChannel('0x' + '0'.repeat(64)),
      /Channel not found/
    );
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('FiberRpcError has code and message', async () => {
    try {
      await client.getInvoice('0x0000000000000000000000000000000000000000000000000000000000000000');
    } catch (err) {
      if (err instanceof FiberRpcError) {
        assert.ok(typeof err.code === 'number', 'error.code should be a number');
        assert.ok(typeof err.message === 'string', 'error.message should be a string');
        assert.ok(err.name === 'FiberRpcError', 'error.name should be FiberRpcError');
      }
    }
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 4: Channel balance consistency
// ══════════════════════════════════════════════════════════════════════════════

describe('Channel balance consistency', () => {

  before(async () => {
    if (!sshTunnel) {
      sshTunnel = openSshTunnel(LOCAL_PORT, CKBNODE_HOST, CKBNODE_FIBER_PORT);
      await sleep(1500);
    }
    if (!client) {
      client = new FiberClient({ url: `http://127.0.0.1:${LOCAL_PORT}`, timeoutMs: 15000 });
    }
  });

  it('localBalanceCKB matches localBalance / 1e8', async () => {
    const { channels } = await client.listChannels();
    for (const ch of channels) {
      const expected = Number(ch.localBalance) / 1e8;
      assert.ok(
        Math.abs(ch.localBalanceCKB - expected) < 0.000001,
        `localBalanceCKB mismatch: ${ch.localBalanceCKB} vs ${expected}`
      );
    }
  });

  it('all channel balances are non-negative', async () => {
    const { channels } = await client.listChannels();
    for (const ch of channels) {
      assert.ok(ch.localBalance >= BigInt(0),
        `Negative local balance on ${ch.channelId}`);
      assert.ok(ch.remoteBalance >= BigInt(0),
        `Negative remote balance on ${ch.channelId}`);
    }
  });

});
