// SPDX-License-Identifier: MIT
// R56: disposable, offline-only PDF phase-trace regression tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordPdfPhase } from '../lib/pdf-phase-trace.mjs';

test('three fixed PDF subphases report success in execution order', async () => {
  const report = {};
  const called = [];
  for (const phase of ['write_pdf_rpc', 'pdf_magic_and_size', 'read_pdf_fidelity']) {
    const value = await recordPdfPhase(report, phase, async () => { called.push(phase); return phase; });
    assert.equal(value, phase);
  }
  assert.deepEqual(called, report.pdfPhases.map(item => item.phase));
  assert.equal(report.pdfPhases.length, 3);
  for (const phase of report.pdfPhases) {
    assert.equal(phase.pass, true);
    assert.ok(Number.isSafeInteger(phase.durationMs) && phase.durationMs >= 0 && phase.durationMs <= 180000);
    assert.equal(typeof phase.durationCapped, 'boolean');
    assert.deepEqual(Object.keys(phase), ['phase', 'pass', 'durationMs', 'durationCapped']);
  }
});

test('a rejected upstream write_pdf response is not swallowed or logged verbatim', async () => {
  const report = {};
  const secret = 'secret-only-in-error--no-logs';
  const failure = new Error(secret);
  await assert.rejects(recordPdfPhase(report, 'write_pdf_rpc', async () => { throw failure; }), error => error === failure);
  assert.deepEqual(report.pdfPhases.map(x => [x.phase, x.pass]), [['write_pdf_rpc', false]]);
  assert.doesNotMatch(JSON.stringify(report), /secret-only-in-error|Error|stack|path|token/i);
});

test('a readback failure preserves both earlier successful PDF observations', async () => {
  const report = {};
  await recordPdfPhase(report, 'write_pdf_rpc', async () => {});
  await recordPdfPhase(report, 'pdf_magic_and_size', async () => {});
  await assert.rejects(recordPdfPhase(report, 'read_pdf_fidelity', async () => {
    throw new Error('synthetic_pdf_read_failed');
  }), /synthetic_pdf_read_failed/);
  assert.deepEqual(report.pdfPhases.map(item => [item.phase, item.pass]), [
    ['write_pdf_rpc', true], ['pdf_magic_and_size', true], ['read_pdf_fidelity', false],
  ]);
  assert.doesNotMatch(JSON.stringify(report), /synthetic_pdf_read_failed/);
});

test('unknown labels, skipping, duplication and continuing after failure are refused', async () => {
  const report = {};
  let invoked = 0;
  const action = async () => { invoked++; };
  await assert.rejects(recordPdfPhase(report, 'arbitrary_secret_label', action), /qualification_pdf_phase_contract/);
  await assert.rejects(recordPdfPhase(report, 'read_pdf_fidelity', action), /qualification_pdf_phase_contract/);
  await recordPdfPhase(report, 'write_pdf_rpc', action);
  await assert.rejects(recordPdfPhase(report, 'write_pdf_rpc', action), /qualification_pdf_phase_contract/);
  assert.equal(invoked, 1);
  await assert.rejects(recordPdfPhase(report, 'pdf_magic_and_size', async () => {
    throw new Error('fail-closed');
  }), /fail-closed/);
  await assert.rejects(recordPdfPhase(report, 'read_pdf_fidelity', action), /qualification_pdf_phase_contract/);
  assert.equal(invoked, 1);
});

test('invalid report/record inputs fail before invoking operations', async () => {
  let invoked = false;
  const action = async () => { invoked = true; };
  await assert.rejects(recordPdfPhase(null, 'write_pdf_rpc', action), /qualification_pdf_phase_contract/);
  await assert.rejects(recordPdfPhase([], 'write_pdf_rpc', action), /qualification_pdf_phase_contract/);
  await assert.rejects(recordPdfPhase({ pdfPhases: 'wrong' }, 'write_pdf_rpc', action), /qualification_pdf_phase_contract/);
  await assert.rejects(recordPdfPhase({}, 'write_pdf_rpc', null), /qualification_pdf_phase_contract/);
  assert.equal(invoked, false);
});

test('simultaneous duplicate phase calls fail closed without executing a second action', async () => {
  const report = {};
  let unblock;
  let entered;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const first = recordPdfPhase(report, 'write_pdf_rpc', async () => {
    calls++;
    entered();
    await blocked;
  });
  await started;
  try {
    await assert.rejects(recordPdfPhase(report, 'write_pdf_rpc', async () => {
      calls++;
      return 'unexpected-side-effect';
    }), /qualification_pdf_phase_contract/);
  } finally {
    unblock();
    await first;
  }
  assert.equal(calls, 1);
  assert.deepEqual(report.pdfPhases.map(({ phase, pass }) => [phase, pass]), [['write_pdf_rpc', true]]);
});

test('simultaneous later phase remains forbidden until the current phase completes', async () => {
  const report = {};
  let unblock;
  let entered;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let called = false;
  const first = recordPdfPhase(report, 'write_pdf_rpc', async () => {
    entered();
    await blocked;
  });
  await started;
  try {
    await assert.rejects(recordPdfPhase(report, 'pdf_magic_and_size', async () => {
      called = true;
    }), /qualification_pdf_phase_contract/);
  } finally {
    unblock();
    await first;
  }
  assert.equal(called, false);
  await recordPdfPhase(report, 'pdf_magic_and_size', async () => {});
  assert.deepEqual(report.pdfPhases.map(x => x.phase), ['write_pdf_rpc', 'pdf_magic_and_size']);
});

test('distinct reports can record independently while another report is in flight', async () => {
  const firstReport = {}, secondReport = {};
  let releaseFirst;
  let startedFirst;
  const release = new Promise(resolve => { releaseFirst = resolve; });
  const started = new Promise(resolve => { startedFirst = resolve; });
  const first = recordPdfPhase(firstReport, 'write_pdf_rpc', async () => {
    startedFirst();
    await release;
  });
  await started;
  try {
    await recordPdfPhase(secondReport, 'write_pdf_rpc', async () => {});
    assert.equal(secondReport.pdfPhases.length, 1);
    assert.equal(secondReport.pdfPhases[0].pass, true);
    assert.equal(firstReport.pdfPhases.length, 0);
  } finally {
    releaseFirst();
    await first;
  }
  assert.equal(firstReport.pdfPhases.length, 1);
  assert.equal(firstReport.pdfPhases[0].pass, true);
});
