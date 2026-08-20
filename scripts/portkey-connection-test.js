#!/usr/bin/env node
/**
 * ===========================================================================
 *  PORTKEY CONNECTION TEST  —  a self-contained guide you can run
 * ===========================================================================
 *
 *  Requires Node 18 or newer (it uses the built-in `fetch`).
 *  Check with:  node --version
 *
 *  HOW TO RUN
 *    node scripts/portkey-connection-test.js --key YOUR_KEY --config pc-xxxxxx
 *
 *  OPTIONS
 *    --key <k>       Portkey API key (instead of the env var)
 *    --config <id>   Config ID (instead of the env var)
 *    --model <name>  Model to request (default: gpt-4o-mini)
 *    --calls <n>     How many calls the reliability check makes (default: 12)
 *    --quick         Skip the reliability check (it is the slow part)
 *    --verbose       Print the full JSON of the first response
 *
 * ===========================================================================
 */

'use strict';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const GATEWAY_URL = 'https://api.portkey.ai/v1/chat/completions';

const SETTINGS = {
  apiKey: value('--key', process.env.PORTKEY_API_KEY || ''),
  configId: value('--config', process.env.PORTKEY_CONFIG_ID || ''),
  model: value('--model', process.env.PORTKEY_MODEL || 'gpt-4o-mini'),
  calls: Number.parseInt(value('--calls', '12'), 10),
  quick: flag('--quick'),
  verbose: flag('--verbose'),
  timeoutMs: 60000,
};

const ESC = String.fromCharCode(27);
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c, s) => (color ? `${ESC}[${c}m${s}${ESC}[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const green = (s) => paint('32', s);
const red = (s) => paint('31', s);
const amber = (s) => paint('33', s);
const cyan = (s) => paint('36', s);

const checks = [];
const pass = (n, d) => { checks.push({ n, ok: true }); console.log(`   ${green('PASS')}  ${n}${d ? dim(`  ${d}`) : ''}`); };
const fail = (n, d) => { checks.push({ n, ok: false, d }); console.log(`   ${red('FAIL')}  ${n}${d ? `  ${d}` : ''}`); };
const skip = (n, d) => { checks.push({ n, ok: true, skipped: true }); console.log(`   ${amber('SKIP')}  ${n}${d ? dim(`  ${d}`) : ''}`); };
const kv = (k, v) => console.log(`         ${dim(String(k).padEnd(24))} ${v}`);
const note = (s) => console.log(`         ${dim('> ' + s)}`);

function step(number, title, explanation) {
  console.log(`\n${bold(cyan(`STEP ${number}`))}  ${bold(title)}`);
  console.log(dim('─'.repeat(72)));
  if (explanation) {
    for (const l of explanation.split('\n')) console.log(dim(`  ${l}`));
    console.log('');
  }
}

const mask = (s) => (!s ? '(not set)' : s.length <= 8 ? '****' : `${s.slice(0, 4)}...${s.slice(-4)}`);

async function callGateway({ body, noCache = false, extraHeaders = {} }) {
  const headers = {
    'Content-Type': 'application/json',
    'x-portkey-api-key': SETTINGS.apiKey,
    ...(SETTINGS.configId ? { 'x-portkey-config': SETTINGS.configId } : {}),
    'x-portkey-metadata': JSON.stringify({ _user: 'connection-test', feature: 'setup-check' }),
    'x-portkey-trace-id': `conn-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(noCache ? { 'x-portkey-cache-force-refresh': 'true' } : {}),
    ...extraHeaders,
  };

  const startedAt = Date.now();
  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SETTINGS.timeoutMs),
  });

  const receipts = {};
  response.headers.forEach((v, k) => {
    if (k.toLowerCase().startsWith('x-portkey')) receipts[k.toLowerCase()] = v;
  });

  const raw = await response.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* non-JSON error page */ }

  return { response, json, raw, receipts, elapsedMs: Date.now() - startedAt };
}

const explainError = (r) =>
  r.json?.error?.message || r.json?.message || r.raw?.slice(0, 200) || `HTTP ${r.response.status}`;

function stepSettings() {
  step(1, 'Your settings',
    'These are the two values you were given. The key authenticates you;\n' +
    'the config ID selects the routing policy stored inside Portkey.');

  kv('gateway URL', GATEWAY_URL);
  kv('PORTKEY_API_KEY', mask(SETTINGS.apiKey));
  kv('PORTKEY_CONFIG_ID', SETTINGS.configId || dim('(not set)'));
  kv('model you will request', SETTINGS.model);
  console.log('');

  if (!SETTINGS.apiKey) {
    fail('API key provided',
      'Set PORTKEY_API_KEY, or pass --key YOUR_KEY. See the header of this file.');
    return false;
  }
  pass('API key provided');

  if (!SETTINGS.configId) {
    skip('config ID provided', 'none given — Portkey will use the workspace default');
  } else {
    pass('config ID provided');
  }
  return true;
}

async function stepConnection() {
  step(2, 'Can you reach the gateway, and does your key work?',
    'This sends one ordinary chat request. Watch for two failure modes:\n' +
    '  401/403  the key is wrong, revoked, or from a different workspace\n' +
    '  timeout  a corporate proxy or firewall is blocking api.portkey.ai');

  let result;
  try {
    result = await callGateway({
      body: {
        model: SETTINGS.model,
        messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }],
        max_tokens: 10,
        temperature: 0,
      },
    });
  } catch (err) {
    fail('gateway reachable',
      err.name === 'TimeoutError'
        ? `no response in ${SETTINGS.timeoutMs} ms — check proxy/firewall`
        : err.message);
    return null;
  }

  if (!result.response.ok) {
    const detail = explainError(result);
    fail(`authentication (HTTP ${result.response.status})`, detail);
    if (/config id/i.test(detail)) {
      note(`The config ID "${SETTINGS.configId}" was rejected. Check it is correct and`);
      note('that it belongs to the same workspace as your API key.');
    } else if (result.response.status === 401 || result.response.status === 403) {
      note('The key was rejected. Check for stray whitespace when you copied it,');
      note('and confirm it has not been revoked.');
    }
    return null;
  }

  const text = result.json?.choices?.[0]?.message?.content?.trim();
  pass('gateway reachable', `${result.elapsedMs} ms`);
  pass('key accepted');
  if (text) pass('model answered', `"${text.slice(0, 40)}"`);
  else fail('model answered', 'response contained no message content');

  if (SETTINGS.verbose) {
    console.log(dim('\n  full response JSON:'));
    console.log(dim(JSON.stringify(result.json, null, 2).replace(/^/gm, '  ')));
  }

  return result;
}

function stepReceipts(result) {
  step(3, 'What did Portkey actually do?',
    'Portkey answers in `x-portkey-*` response headers. Learn to read these —\n' +
    'they are the difference between "it broke" and "target 4 broke".');

  if (!result) { skip('routing receipts', 'no successful response to inspect'); return; }

  const r = result.receipts;
  const served = result.json?.model;

  kv('model you asked for', SETTINGS.model);
  kv('model that answered', served || '(not reported)');

  if (served && served !== SETTINGS.model) {
    console.log('');
    console.log(`   ${amber('IMPORTANT')}  Your model choice was overridden.`);
    note('The Config sets `override_params.model`, which beats whatever you put');
    note('in the request body. This is normal and intentional — but it means the');
    note('model name in YOUR code is ignored. Do not write logic that depends on');
    note('it, and do not assume OpenAI-only response fields will be present.');
    console.log('');
  }

  if (r['x-portkey-provider']) kv('provider used', r['x-portkey-provider']);
  if (r['x-portkey-last-used-option-index']) {
    kv('config target used', r['x-portkey-last-used-option-index']);
    note('Which entry in the Config served you. Different on each call means');
    note('the Config is load-balancing across several targets.');
  }
  if (r['x-portkey-retry-attempt-count'] !== undefined) {
    kv('retries needed', r['x-portkey-retry-attempt-count']);
  }
  if (r['x-portkey-cache-status']) {
    kv('cache status', r['x-portkey-cache-status']);
  }
  if (r['x-portkey-trace-id']) {
    kv('trace id', r['x-portkey-trace-id']);
    note('Quote this to whoever owns the gateway — they can find your exact');
    note('request in the Portkey dashboard logs with it.');
  }

  const usage = result.json?.usage;
  if (usage) kv('tokens', `${usage.prompt_tokens} in / ${usage.completion_tokens} out / ${usage.total_tokens} total`);

  pass('routing receipts read');
}

async function stepCaching(first) {
  step(4, 'Is caching on?',
    'If the Config enables caching, an identical request can be answered by\n' +
    'Portkey WITHOUT reaching a provider — fast and free, but it also means a\n' +
    'test that repeats the same prompt may never exercise the real providers.');

  if (!first) { skip('cache probe', 'first request failed'); return; }

  try {
    const again = await callGateway({
      body: {
        model: SETTINGS.model,
        messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }],
        max_tokens: 10,
        temperature: 0,
      },
    });

    if (!again.response.ok) { fail('repeat request', explainError(again)); return; }

    const status = again.receipts['x-portkey-cache-status'];
    pass('repeat request', `${again.elapsedMs} ms (first call was ${first.elapsedMs} ms)`);

    if (!status) {
      kv('cache status', 'not reported');
      note('Caching appears to be disabled — every call costs provider spend.');
    } else if (/hit/i.test(status)) {
      kv('cache status', green(status));
      note('Served from cache. No provider was contacted, so this call was free —');
      note('and note that a cache hit can HIDE a broken provider. Step 5 sends');
      note('unique prompts with cache bypassed for exactly that reason.');
    } else {
      kv('cache status', status);
      note('Not cached — this call reached a real provider.');
    }
  } catch (err) {
    fail('repeat request', err.message);
  }
}

async function stepStreaming() {
  step(5, 'Does streaming work?',
    'Streaming returns the answer token by token as server-sent events.\n' +
    'Test it separately: some HTTP clients buffer or mangle the gateway\'s\n' +
    'chunked responses even though ordinary requests work fine.');

  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-portkey-api-key': SETTINGS.apiKey,
        ...(SETTINGS.configId ? { 'x-portkey-config': SETTINGS.configId } : {}),
      },
      body: JSON.stringify({
        model: SETTINGS.model,
        messages: [{ role: 'user', content: 'Count from 1 to 5, separated by spaces.' }],
        max_tokens: 40,
        temperature: 0,
        stream: true,
      }),
      signal: AbortSignal.timeout(SETTINGS.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (/api key not valid|invalid api key|credential/i.test(body)) {
        fail('streaming', `HTTP ${res.status} — a Config target rejected the request`);
        note('This looks like a bad provider credential on one target, not a');
        note('streaming problem. STEP 6 identifies which target is broken.');
      } else {
        fail('streaming', `HTTP ${res.status} — ${body.slice(0, 120)}`);
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunks = 0;
    let text = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (delta) { chunks += 1; text += delta; }
        } catch { /* keep-alive or split frame */ }
      }
    }

    if (chunks > 0) {
      pass('streaming', `${chunks} chunks received`);
      kv('assembled text', `"${text.trim().slice(0, 40)}"`);
    } else {
      fail('streaming', 'connection opened but no content arrived — likely a client buffering issue');
    }
  } catch (err) {
    fail('streaming', err.message);
  }
}

async function stepReliability() {
  step(6, 'Are all the Config targets healthy?',
    'A Config usually load-balances across several targets (different keys,\n' +
    'projects, or providers). If ONE target has a bad credential, you get\n' +
    'intermittent failures that look random and are easy to blame on your own\n' +
    'code. This sends unique prompts with the cache bypassed, so every call\n' +
    'reaches a real provider, and reports the result per target.');

  if (SETTINGS.quick) { skip('per-target health', '--quick was passed'); return; }

  const n = Number.isFinite(SETTINGS.calls) && SETTINGS.calls > 0 ? SETTINGS.calls : 12;
  const tally = new Map();
  let ok = 0;
  let bad = 0;

  process.stdout.write(dim(`         running ${n} calls `));

  for (let i = 0; i < n; i++) {
    try {
      const r = await callGateway({
        noCache: true,
        body: {
          model: SETTINGS.model,
          messages: [{ role: 'user', content: `Say OK. Ignore this id: ${Math.random()}` }],
          max_tokens: 8,
          temperature: 0,
        },
      });
      const target = r.receipts['x-portkey-last-used-option-index'] || '(single target)';
      const rec = tally.get(target) || { ok: 0, bad: 0, err: null };
      if (r.response.ok) { rec.ok += 1; ok += 1; }
      else { rec.bad += 1; bad += 1; rec.err = explainError(r).slice(0, 70); }
      tally.set(target, rec);
      process.stdout.write(r.response.ok ? green('.') : red('x'));
    } catch (err) {
      bad += 1;
      const rec = tally.get('(network error)') || { ok: 0, bad: 0, err: err.message };
      rec.bad += 1;
      tally.set('(network error)', rec);
      process.stdout.write(red('x'));
    }
  }
  console.log('\n');

  const rows = [...tally.entries()].sort();
  console.log(`         ${dim('target'.padEnd(32) + 'ok'.padEnd(5) + 'fail'.padEnd(6) + 'error')}`);
  for (const [target, rec] of rows) {
    const label = rec.bad > 0 ? red(target.padEnd(32)) : target.padEnd(32);
    console.log(`         ${label}${String(rec.ok).padEnd(5)}${String(rec.bad).padEnd(6)}${rec.err ? red(rec.err) : ''}`);
  }
  console.log('');

  const rate = Math.round((bad / n) * 100);
  if (bad === 0) {
    pass('per-target health', `${ok}/${n} succeeded across ${rows.length} target(s)`);
  } else {
    fail('per-target health', `${bad}/${n} calls failed (${rate}%)`);
    note('The failing target(s) are listed above in red. This is a gateway-side');
    note('problem, NOT your integration — send the target name and the error to');
    note('whoever owns the Portkey workspace so they can fix that credential.');
    note('Until it is fixed, expect roughly this failure rate in your own app,');
    note('so make sure you retry or handle errors gracefully.');
  }
}

async function stepErrors() {
  step(7, 'Do failures come back readably?',
    'Deliberately requests a model that does not exist, to show you what an\n' +
    'error looks like so you can handle it properly in your own code.');

  try {
    const r = await callGateway({
      body: {
        model: 'this-model-does-not-exist-xyz',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      },
    });

    if (r.response.ok) {
      skip('error handling', 'the Config pinned its own model, so the bad name was ignored');
      note('Expected when override_params sets the model — see STEP 3.');
      return;
    }

    pass('error handling', `HTTP ${r.response.status}`);
    kv('error message', explainError(r).slice(0, 90));
    note('Check for a non-2xx status and read `error.message`. Do not swallow it.');
  } catch (err) {
    fail('error handling', err.message);
  }
}

function stepIntegrate() {
  step(8, 'Now put it in your own code',
    'Portkey speaks the OpenAI API format. This project uses fetch with the\n' +
    'same headers as this test: x-portkey-api-key and x-portkey-config.');

  const cfg = SETTINGS.configId || 'pc-xxxxxx-xxxxxx';
  console.log(dim(`  Config ID in use: ${cfg}`));
  console.log(dim('  Model in the request body is a placeholder — routing config overrides it.'));
}

async function main() {
  console.log(bold(cyan('\n  PORTKEY CONNECTION TEST')));
  console.log(dim(`  node ${process.version}  ·  ${new Date().toISOString()}`));
  console.log(dim('  Open this file in an editor — the header explains how it all fits together.'));

  if (!stepSettings()) return finish();

  const first = await stepConnection();
  stepReceipts(first);

  if (first) {
    await stepCaching(first);
    await stepStreaming();
    await stepReliability();
    await stepErrors();
    stepIntegrate();
  }

  finish();
}

function finish() {
  const failed = checks.filter((c) => !c.ok);
  const skipped = checks.filter((c) => c.skipped);
  const passed = checks.filter((c) => c.ok && !c.skipped);

  console.log(`\n${bold('SUMMARY')}`);
  console.log(dim('─'.repeat(72)));
  console.log(`   ${green(passed.length + ' passed')}   ${failed.length ? red(failed.length + ' failed') : dim('0 failed')}   ${dim(skipped.length + ' skipped')}\n`);

  if (!failed.length) {
    console.log(green('   Your Portkey connection is working.'));
    return;
  }

  for (const f of failed) console.log(`   ${red('x')} ${f.n}${f.d ? dim(` — ${f.d}`) : ''}`);
  console.log(`\n${dim('   What the common failures mean:')}`);
  console.log(dim('     401 / 403                     key is wrong, revoked, or from another workspace'));
  console.log(dim('     400 "Invalid config id"       the config ID is wrong or from another workspace'));
  console.log(dim('     400 "API key not valid"       a Config target has a bad provider credential'));
  console.log(dim('     timeout                       a proxy or firewall is blocking api.portkey.ai'));
  console.log(dim('\n   Send the failing step and any trace id above to whoever gave you these'));
  console.log(dim('   credentials — they can look the request up in the Portkey dashboard.\n'));
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n${red('Unexpected error:')} ${err.stack || err.message}`);
  process.exitCode = 1;
});
