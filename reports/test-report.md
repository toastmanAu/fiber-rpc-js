# fiber-rpc-js Test Report

**Date:** 2026-03-05 12:26:19 ACST
**Node:** ckbnode (127.0.0.1:8227 via SSH tunnel — mainnet)
**Library version:** 0.1.0

## Summary

| Result | Count |
|--------|-------|
| ✅ Passed | 35 |
| ❌ Failed | 0 |
| **Total** | **35** |

**Overall: ✅ ALL TESTS PASSED**

## Test Results

✅ toHex converts number to 0x hex
✅ toHex handles BigInt input
✅ toHex handles string input
✅ fromHex converts 0x hex to BigInt
✅ fromHex handles null/undefined gracefully
✅ shannonToCKB converts correctly
✅ round-trip: number → toHex → fromHex
✅ throws if url is missing
✅ creates client with valid url
✅ accepts biscuitToken option without throwing
✅ accepts timeoutMs option
✅ throws FiberConnectionError on unreachable host
✅ nodeInfo() returns node info with peerId
✅ listChannels() returns channels array
✅ listChannels() channels have required fields
✅ listChannels() CHANNEL_READY channels have positive local balance
✅ listChannels() with includeClosed returns superset
✅ listChannels() with unknown peerId returns empty array or error
✅ newInvoice() creates an invoice with address
✅ newInvoice() invoice address starts with fibb or fiber prefix
✅ newInvoice() with zero amount throws or returns error
✅ getInvoice() retrieves a created invoice
✅ getInvoice() with unknown hash throws FiberRpcError
✅ sendPayment() dry_run validates payment without sending
✅ getChannel() finds channel by ID
✅ getChannel() throws for unknown channel ID
✅ FiberRpcError has code and message
✅ localBalanceCKB matches localBalance / 1e8
✅ all channel balances are non-negative
✅ defaults to mainnet (Fibb) when no network specified
✅ selects Fibb for network=mainnet
✅ selects Fibt for network=testnet
✅ selects Fibd for network=devnet
✅ throws for unknown network name
✅ manual currency override takes precedence over network

## API Coverage

| Method | Tested | Notes |
|--------|--------|-------|
| `nodeInfo()` | ✅ | Returns peer ID |
| `listChannels()` | ✅ | Fields, balances, state validated |
| `listChannels({ peerId })` | ✅ | Handles unknown peerId |
| `listChannels({ includeClosed })` | ✅ | Superset check |
| `getChannel(id)` | ✅ | Find by ID + not found error |
| `newInvoice()` | ✅ | Address format, currency=Fibb |
| `getInvoice()` | ✅ | Status=Open, round-trip |
| `sendPayment({ dryRun })` | ✅ | Invalid invoice → FiberRpcError |
| `toHex()` | ✅ | number, BigInt, string inputs |
| `fromHex()` | ✅ | null/undefined safety |
| `shannonToCKB()` | ✅ | 1 CKB = 100M shannon |
| `FiberRpcError` | ✅ | code, message, name |
| `FiberConnectionError` | ✅ | Unreachable host |

## Key Findings

- Currency enum on mainnet: `Fibb` (not `CKB`) — `Fibt` = testnet, `Fibd` = devnet
- Invoice status uses PascalCase: `Open`, `Settled`, `Canceled`
- `listChannels({ peerId: unknown })` returns `FiberRpcError -32602` not empty array
- Biscuit auth not required when listening on `127.0.0.1` (even if key is set, removing key from config bypasses auth)
- `new_invoice` expiry field accepts hex-encoded seconds
- Payment hash is at `invoice.data.payment_hash` in the response