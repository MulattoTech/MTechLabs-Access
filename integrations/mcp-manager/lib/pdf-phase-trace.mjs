// SPDX-License-Identifier: MIT
// R56: Source-only candidate for bounded, non-secret PDF phase evidence.
// This does not instrument upstream Chrome or replace hosted acceptance.
import { performance } from 'node:perf_hooks';

const PDF_PHASES = Object.freeze(['write_pdf_rpc', 'pdf_magic_and_size', 'read_pdf_fidelity']);
const MAX_RECORDED_MS = 180000;

// Records only a fixed phase label and monotonic duration, never tool output,
// exception messages, paths, arguments, process environments or credentials.
// An exception propagates to the original fail-closed qualification handler.
export async function recordPdfPhase(report, phase, action) {
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      typeof action !== 'function' ||
      !Array.isArray(report.pdfPhases ?? []) ||
      !PDF_PHASES.includes(phase) ||
      (report.pdfPhases?.length ?? 0) >= PDF_PHASES.length ||
      PDF_PHASES[report.pdfPhases?.length ?? 0] !== phase ||
      report.pdfPhases?.some(item => item?.pass !== true)) {
    throw new Error('qualification_pdf_phase_contract');
  }
  report.pdfPhases ??= [];
  const start = performance.now();
  let pass = false;
  try {
    const value = await action();
    pass = true;
    return value;
  } finally {
    const elapsed = Math.max(0, performance.now() - start);
    report.pdfPhases.push({
      phase,
      pass,
      durationMs: Math.min(MAX_RECORDED_MS, Math.round(elapsed)),
      durationCapped: elapsed > MAX_RECORDED_MS,
    });
  }
}
