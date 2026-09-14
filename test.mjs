import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIds, parseDetails, parseTranscript } from './bridge.mjs';

test('parses only recording identifiers from the CLI table', () => {
  const id = '00000000000000000000000000000000';
  assert.deepEqual(parseIds(`Files on this page: 1\n  ID NAME DATE\n  ${id} Example 2026-01-01\n`), [id]);
});
test('retains the original recording time', () => {
  assert.equal(parseDetails('  id: abc\n  start_at: 2026-01-01T10:00:00\n  transcript: available\n').start_at, '2026-01-01T10:00:00');
});
test('does not treat a missing transcript as text', () => {
  assert.equal(parseTranscript('No transcript.'), null);
});
