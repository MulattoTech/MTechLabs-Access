// SPDX-License-Identifier: MIT
// R58: offline, exact-Git-blob attestation of the R56/R57 PDF qualifier edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const qualifier = path.resolve(here, '../qualify-upstream.mjs');
const reviewedOriginalBlob = '5bd1fa10fad4f55af6e7b01349beb3b1b0793c26';
const importLine = "import { recordPdfPhase } from './lib/pdf-phase-trace.mjs';\n";
const oldBlock = [
  "      await call('write_pdf', { path: pdf, content: '# MTERM PDF FIXTURE\\n\\nDisposable qualification document.\\n' }, 90000);",
  "      const bytes = await fs.readFile(pdf); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(bytes.length > 1000);",
  "      assert.match(resultText(await call('read_file', { path: pdf }, 90000)), /MTERM PDF FIXTURE/);",
].join('\n') + '\n';
const observedBlock = [
  "      await recordPdfPhase(report, 'write_pdf_rpc', async () => {",
  "        await call('write_pdf', { path: pdf, content: '# MTERM PDF FIXTURE\\n\\nDisposable qualification document.\\n' }, 90000);",
  "      });",
  "      let bytes;",
  "      await recordPdfPhase(report, 'pdf_magic_and_size', async () => {",
  "        bytes = await fs.readFile(pdf);",
  "        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');",
  "        assert.ok(bytes.length > 1000);",
  "      });",
  "      await recordPdfPhase(report, 'read_pdf_fidelity', async () => {",
  "        assert.match(resultText(await call('read_file', { path: pdf }, 90000)), /MTERM PDF FIXTURE/);",
  "      });",
].join('\n') + '\n';

function normalizeEol(text) {
  if (text.includes('\r\n')) {
    if (text.replaceAll('\r\n', '').includes('\n')) throw new Error('mixed_source_line_endings');
    text = text.replaceAll('\r\n', '\n');
  }
  if (text.includes('\r')) throw new Error('unqualified_source_line_endings');
  return text;
}

function exactlyOnce(text, snippet) {
  const first = text.indexOf(snippet);
  if (first < 0 || text.indexOf(snippet, first + snippet.length) !== -1) {
    throw new Error('source_binding_not_unique');
  }
}

function reverseCandidateInstrumentation(source) {
  source = normalizeEol(source);
  exactlyOnce(source, importLine);
  exactlyOnce(source, observedBlock);
  return source.replace(importLine, '').replace(observedBlock, oldBlock);
}

function gitBlobSha(text) {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}

async function currentSource() {
  return normalizeEol(await fs.readFile(qualifier, 'utf8'));
}

function assertOriginalStillRecoverable(source) {
  assert.equal(gitBlobSha(reverseCandidateInstrumentation(source)), reviewedOriginalBlob,
    'qualifier differs outside exact PDF timing wrappers and fixed import');
}

test('R57 qualifier reconstructs the exact pinned R46 Git source blob', async () => {
  const source = await currentSource();
  assertOriginalStillRecoverable(source);
});

test('negative controls reject modified PDF tool deadline or fixture markdown', async () => {
  const source = await currentSource();
  assertOriginalStillRecoverable(source);
  for (const replacement of [
    source.replace(" }, 90000);\n", " }, 90001);\n"),
    source.replace('Disposable qualification document.', 'Different fixture content.'),
  ]) {
    assert.notEqual(replacement, source);
    assert.throws(() => assertOriginalStillRecoverable(replacement));
  }
});

test('negative controls reject omitted PDF fidelity, malformed phase order, or modified assertions', async () => {
  const source = await currentSource();
  for (const replacement of [
    source.replace("report, 'read_pdf_fidelity'", "report, 'write_pdf_rpc'"),
    source.replace("assert.ok(bytes.length > 1000);", "assert.ok(bytes.length > 0);"),
    source.replace("/MTERM PDF FIXTURE/", "/whatever/"),
  ]) {
    assert.notEqual(replacement, source);
    assert.throws(() => assertOriginalStillRecoverable(replacement));
  }
});

test('negative controls reject unexpected non-PDF source changes and duplicate instrumentation', async () => {
  const source = await currentSource();
  for (const replacement of [
    source.replace("const exec = promisify(execFile);", "const exec = promisify(execFile);\nconst unexpected = true;"),
    source.replace(importLine, ''),
    source.replace(importLine, importLine + importLine),
    source.replace(observedBlock, observedBlock + observedBlock),
  ]) {
    assert.notEqual(replacement, source);
    assert.throws(() => assertOriginalStillRecoverable(replacement));
  }
});

test('reject mixed newline or lone-CR source normalization', () => {
  assert.throws(() => normalizeEol('a\r\nb\nc'), /mixed_source_line_endings/);
  assert.throws(() => normalizeEol('a\rb\nc'), /unqualified_source_line_endings/);
  assert.equal(normalizeEol('a\r\nb\r\n'), 'a\nb\n');
});
