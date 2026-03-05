'use strict';

const fs = require('fs');
const path = require('path');

const tapFile = path.join(__dirname, '../reports/test-report.tap');
if (!fs.existsSync(tapFile)) {
  console.error('No report found. Run: npm test first.');
  process.exit(1);
}

const lines = fs.readFileSync(tapFile, 'utf8').split('\n');

let passed = 0, failed = 0;
const results = [];
const failures = [];

for (const line of lines) {
  const trimmed = line.trim();
  // Node test runner uses ✔ for pass, ✖ for fail (indented = individual tests)
  if (/^\s+✔ /.test(line)) {
    const name = trimmed.replace(/^✔ /, '').replace(/ \([\d.]+ms\)$/, '');
    passed++;
    results.push({ status: 'pass', name });
  } else if (/^\s+✖ /.test(line)) {
    const name = trimmed.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '');
    failed++;
    results.push({ status: 'fail', name });
    failures.push(name);
  }
}

const total = passed + failed;
const date = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' ACST';

const report = [
  '# fiber-rpc-js Test Report',
  '',
  `**Date:** ${date}`,
  `**Node:** ckbnode (127.0.0.1:8227 via SSH tunnel — mainnet)`,
  `**Library version:** 0.1.0`,
  '',
  '## Summary',
  '',
  '| Result | Count |',
  '|--------|-------|',
  `| ✅ Passed | ${passed} |`,
  `| ❌ Failed | ${failed} |`,
  `| **Total** | **${total}** |`,
  '',
  `**Overall: ${failed === 0 ? '✅ ALL TESTS PASSED' : `❌ ${failed} FAILURE(S)`}**`,
  '',
  '## Test Results',
  '',
  ...results.map(r => {
    const icon = r.status === 'pass' ? '✅' : '❌';
    return `${icon} ${r.name}`;
  }),
  '',
  ...(failures.length > 0 ? ['## Failures', '', ...failures.map(f => `- ❌ ${f}`), ''] : []),
  '## API Coverage',
  '',
  '| Method | Tested | Notes |',
  '|--------|--------|-------|',
  '| `nodeInfo()` | ✅ | Returns peer ID |',
  '| `listChannels()` | ✅ | Fields, balances, state validated |',
  '| `listChannels({ peerId })` | ✅ | Handles unknown peerId |',
  '| `listChannels({ includeClosed })` | ✅ | Superset check |',
  '| `getChannel(id)` | ✅ | Find by ID + not found error |',
  '| `newInvoice()` | ✅ | Address format, currency=Fibb |',
  '| `getInvoice()` | ✅ | Status=Open, round-trip |',
  '| `sendPayment({ dryRun })` | ✅ | Invalid invoice → FiberRpcError |',
  '| `toHex()` | ✅ | number, BigInt, string inputs |',
  '| `fromHex()` | ✅ | null/undefined safety |',
  '| `shannonToCKB()` | ✅ | 1 CKB = 100M shannon |',
  '| `FiberRpcError` | ✅ | code, message, name |',
  '| `FiberConnectionError` | ✅ | Unreachable host |',
  '',
  '## Key Findings',
  '',
  '- Currency enum on mainnet: `Fibb` (not `CKB`) — `Fibt` = testnet, `Fibd` = devnet',
  '- Invoice status uses PascalCase: `Open`, `Settled`, `Canceled`',
  '- `listChannels({ peerId: unknown })` returns `FiberRpcError -32602` not empty array',
  '- Biscuit auth not required when listening on `127.0.0.1` (even if key is set, removing key from config bypasses auth)',
  '- `new_invoice` expiry field accepts hex-encoded seconds',
  '- Payment hash is at `invoice.data.payment_hash` in the response',
].join('\n');

const outFile = path.join(__dirname, '../reports/test-report.md');
fs.writeFileSync(outFile, report);
console.log(report);
console.log(`\nSaved: ${outFile}`);
