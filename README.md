# fiber-rpc-js

A Node.js client library for the [Nervos Fiber Network](https://github.com/nervosnetwork/fiber) RPC.

The Fiber Network is CKB's payment channel network — enabling near-instant, near-free micropayments that settle on CKB L1. This library provides a clean, idiomatic JavaScript interface to the Fiber node JSON-RPC API.

## Installation

```bash
npm install fiber-rpc-js
```

## Quick Start

```js
const { FiberClient, toHex, shannonToCKB } = require('fiber-rpc-js');

const client = new FiberClient({ url: 'http://127.0.0.1:8227' });

// List open channels
const { channels } = await client.listChannels();
for (const ch of channels) {
  console.log(`Channel ${ch.channelId.slice(0,10)}... | ${ch.localBalanceCKB} CKB | ${ch.state}`);
}

// Create an invoice for 100 Shannon
const { invoiceAddress } = await client.newInvoice({
  amount: 100,
  description: 'Payment for service',
});
console.log('Invoice:', invoiceAddress);

// Send a payment
const payment = await client.sendPayment({ invoice: invoiceAddress });
console.log('Status:', payment.status);
```

## Authentication

If your Fiber node has `biscuit_public_key` set in config (required for public addresses), pass the Biscuit token:

```js
const client = new FiberClient({
  url: 'http://your-node:8227',
  biscuitToken: 'your-biscuit-token',
});
```

For nodes listening on `127.0.0.1` only, no authentication is required.

## API

### `new FiberClient(options)`

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `url` | string | ✅ | — | Fiber node RPC URL |
| `biscuitToken` | string | ❌ | — | Biscuit auth token |
| `timeoutMs` | number | ❌ | 10000 | Request timeout in ms |

### Channel Methods

#### `listChannels({ peerId?, includeClosed? })`
Returns all channels, optionally filtered by peer or including closed channels.

#### `openChannel({ peerId, fundingAmount, isPublic?, isOneWay? })`
Opens a payment channel with a peer. `fundingAmount` is in Shannon (1 CKB = 100,000,000 Shannon).

#### `getChannel(channelId)`
Convenience method — finds a channel by ID from `listChannels`.

### Payment Methods

#### `sendPayment({ invoice?, targetPubkey?, amount?, maxFeeAmount?, dryRun? })`
Sends a payment. Use `invoice` (preferred) or `targetPubkey + amount` for keysend.

#### `getPayment(paymentHash)`
Gets the status of a payment by its hash.

### Invoice Methods

#### `newInvoice({ amount, description?, currency?, expirySeconds? })`
Creates a new invoice. Returns `{ invoiceAddress, invoice }`.

#### `getInvoice(paymentHash)`
Retrieves an invoice by payment hash. Returns `{ invoiceAddress, invoice, status }`.

### Node Methods

#### `nodeInfo()`
Returns node information (peer ID, addresses, version).

#### `listPeers()`
Returns connected peers.

### Utility Functions

```js
const { toHex, fromHex, shannonToCKB } = require('fiber-rpc-js');

toHex(100_000_000)    // → '0x5f5e100'
fromHex('0x5f5e100') // → BigInt(100000000)
shannonToCKB('0x5f5e100') // → 1.0
```

## Error Handling

```js
const { FiberRpcError, FiberConnectionError } = require('fiber-rpc-js');

try {
  await client.getInvoice('0x...');
} catch (err) {
  if (err instanceof FiberRpcError) {
    console.log('RPC error:', err.code, err.message);
  } else if (err instanceof FiberConnectionError) {
    console.log('Node unreachable:', err.url);
  }
}
```

## Running Tests

Tests run against a live Fiber node via SSH tunnel:

```bash
npm test
```

Requires SSH access to `ckbnode` (configured in `~/.ssh/config`).

## License

MIT
