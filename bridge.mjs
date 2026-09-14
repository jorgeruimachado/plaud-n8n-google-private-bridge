/**
 * Private Plaud collector.
 *
 * Keep config.json, auth/, and state/ on the NAS only. They are ignored by Git.
 * This program sends only transcripts already produced by Plaud to an authenticated
 * n8n webhook. It never uploads audio or triggers a new transcription.
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const exec = promisify(execFile);
const root = process.env.BRIDGE_ROOT || '/project';
const cli = path.join(root, 'runtime/node_modules/@plaud-ai/cli/dist/index.js');
const statePath = path.join(root, 'state/state.json');
const configPath = path.join(root, 'config.json');
const timezone = process.env.TZ || 'UTC';
let busy = false;
let health = { status: 'starting', lastCheck: null, pending: 0 };

export function parseIds(text) {
  return [...new Set([...text.matchAll(/^\s+([a-f0-9]{32})\s+/gm)].map(match => match[1]))];
}
export function parseDetails(text) {
  const value = key => text.match(new RegExp(`^\\s+${key}:\\s*(.*)$`, 'm'))?.[1]?.trim();
  return { id: value('id'), name: value('name'), created_at: value('created_at'), start_at: value('start_at'), transcript: value('transcript') === 'available' };
}
export function parseTranscript(text) {
  const match = text.match(/^\s*Transcript: [^\n]*\n([\s\S]*)$/m);
  return match ? match[1].trim() : null;
}
async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function save(state) {
  await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  await writeFile(`${statePath}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(`${statePath}.tmp`, statePath);
}
async function command(args) {
  try {
    const { stdout } = await exec(process.execPath, [cli, ...args], {
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', PLAUD_NO_UPDATE_NOTIFIER: '1' }
    });
    return stdout.replace(/\u001b\[[0-9;]*m/g, '');
  } catch (error) {
    throw new Error(error.code === 2 ? 'plaud_authentication_required' : 'plaud_cli_failed');
  }
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const config = await readJson(configPath);
    if (!config.enabled) { health.status = 'disabled'; return; }
    let state;
    try { state = await readJson(statePath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { version: 1, initialized: false, records: {} };
    }
    const ids = [];
    for (let page = 1; page <= 20; page += 1) {
      const output = await command(['files', '--page', String(page), '--page-size', '100']);
      const batch = parseIds(output);
      const count = Number(output.match(/Files on this page: (\d+)/)?.[1]);
      if (!Number.isFinite(count) || count !== batch.length) throw new Error('cli_format_changed');
      ids.push(...batch);
      if (batch.length < 100) break;
      if (page === 20) throw new Error('recording_scan_limit_reached');
    }
    if (!state.initialized) {
      for (const id of ids) state.records[id] = { status: 'baseline' };
      state.initialized = true;
      await save(state);
      health.status = 'baseline_created';
      return;
    }
    for (const id of ids) if (!state.records[id]) state.records[id] = { status: 'waiting_for_transcript' };
    await save(state);
    for (const [id, record] of Object.entries(state.records)) {
      if (record.status === 'baseline' || record.status === 'delivered') continue;
      if (!record.payload) {
        const details = parseDetails(await command(['file', id]));
        if (details.id !== id || !details.transcript) continue;
        const transcript = parseTranscript(await command(['transcript', id]));
        if (!transcript) continue;
        record.payload = { ...details, transcript, source: 'plaud', timezone, idempotency_key: `plaud:${id}` };
        record.status = 'ready';
        await save(state);
      }
      if (!config.webhook_url || !config.webhook_token) continue;
      const response = await fetch(config.webhook_url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { 'Content-Type': 'application/json', 'X-Plaud-Bridge-Key': config.webhook_token },
        body: JSON.stringify(record.payload)
      });
      if (!response.ok) throw new Error('n8n_delivery_failed');
      const receipt = await response.json();
      if (receipt.accepted !== true || receipt.idempotency_key !== record.payload.idempotency_key) throw new Error('n8n_acknowledgement_missing');
      state.records[id] = { status: 'delivered', delivered_at: new Date().toISOString() };
      await save(state);
    }
    health.pending = Object.values(state.records).filter(record => !['baseline', 'delivered'].includes(record.status)).length;
    health.status = health.pending ? 'pending' : 'ok';
  } catch (error) {
    health.status = /^(plaud_|cli_|n8n_|recording_)/.test(error.message) ? error.message : 'configuration_or_storage_error';
  } finally {
    health.lastCheck = new Date().toISOString();
    busy = false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/proposals') {
      try {
        const config = await readJson(configPath);
        const supplied = Buffer.from(req.headers['x-plaud-bridge-key'] || '');
        const expected = Buffer.from(config.webhook_token || '');
        if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end('{}'); return; }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('body_too_large');
        }
        const data = JSON.parse(body);
        if (!/^plaud:[a-f0-9]{32}$/.test(data.idempotency_key) || !Array.isArray(data.actions)) throw new Error('invalid_proposal');
        const directory = path.join(root, 'state/proposals');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const file = path.join(directory, `${data.idempotency_key.slice(6)}.json`);
        try { await writeFile(file, JSON.stringify({ ...data, received_at: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        res.end(JSON.stringify({ accepted: true, idempotency_key: data.idempotency_key }));
      } catch { res.writeHead(400); res.end('{"accepted":false}'); }
      return;
    }
    if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify(health)); return; }
    res.writeHead(404); res.end('{}');
  }).listen(8090, '0.0.0.0');
  await poll();
  setInterval(poll, 10 * 60 * 1000);
}
