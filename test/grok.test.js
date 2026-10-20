import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GrokAssistant, GROK_TOOLS, grokFromEnv } from '../src/assistant/grok.js';

const ok = (body) => ({ status: 200, ok: true, json: async () => body });

test('Grok gets read-only tools only: nothing can buy, sell, approve or change the desk', () => {
  for (const t of GROK_TOOLS) {
    assert.equal(t.type, 'function');
    assert.doesNotMatch(t.function.name, /buy|sell|swap|trade|order|approve|desk|mode|watch|confirm/i, t.function.name);
    assert.equal(t.function.parameters.additionalProperties, false);
  }
});

test('runs the tool loop with what is on screen and returns the final answer', async () => {
  const calls = [];
  const replies = [
    ok({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_coin', arguments: '{"address":"MINT"}' } }] } }] }),
    ok({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ZAP is up because 3 smart wallets bought.' } }], usage: { cost_in_usd_ticks: 11_000_000 } }),
  ];
  const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return replies.shift(); };
  const svc = { coin: async () => ({ symbol: 'ZAP', marketCapUsd: 50_000, momentum: { score: 70, stage: 'Ignition', reasons: ['r'], warnings: [] }, early: { summary: { text: 's' }, buyers: [] }, explosiveIn: [], changes: {}, safety: {}, flow: {} }) };
  const g = new GrokAssistant({ apiKey: 'k', fetch, svc });
  const out = await g.ask('why is this pumping?', { view: 'coin', coin: { address: 'MINT', symbol: 'ZAP' }, element: { key: 'coin.momentum', label: 'Momentum', value: '70' } });
  assert.equal(out.text, 'ZAP is up because 3 smart wallets bought.');
  assert.equal(out.by, 'grok');
  assert.equal(calls[0].url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(calls[0].body.model, 'grok-4.7');
  assert.match(calls[0].body.messages[1].content, /ZAP/, 'the screen context goes with the question');
  assert.match(calls[0].body.messages[1].content, /coin\.momentum/);
  const toolMsg = calls[1].body.messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.match(toolMsg.content, /50000/);
  assert.doesNotMatch(toolMsg.content, /\bSOL\b|lamport/);
  assert.ok(out.costUsd > 0 && out.costUsd < 0.01, 'xAI reports cost in 1e-10 dollar ticks');
});

test('X chatter uses Grok live X search, returns the summary with its links, and is cached', async () => {
  let n = 0;
  const fetch = async (url, init) => {
    n += 1;
    assert.equal(url, 'https://api.x.ai/v1/responses');
    assert.deepEqual(JSON.parse(init.body).tools, [{ type: 'x_search' }]);
    return ok({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Mostly hype posts.', annotations: [{ url: 'https://x.com/a/status/1' }] }] }], usage: { cost_in_usd_ticks: 1_900_000_000 } });
  };
  const g = new GrokAssistant({ apiKey: 'k', fetch, svc: {}, now: () => 0 });
  const r1 = await g.xChatter({ symbol: 'ZAP', address: 'MINT' });
  const r2 = await g.xChatter({ symbol: 'ZAP', address: 'MINT' });
  assert.equal(r1.summary, 'Mostly hype posts.');
  assert.deepEqual(r1.links, ['https://x.com/a/status/1']);
  assert.ok(Math.abs(r1.costUsd - 0.19) < 1e-9);
  assert.equal(n, 1, 'second ask within 10 minutes is free');
  assert.equal(r2.cached, true);
});

test('the key comes from the app\'s private secrets file or the environment', () => {
  assert.equal(grokFromEnv('/nonexistent', {}), null);
  assert.ok(grokFromEnv('/nonexistent', { XAI_API_KEY: 'xai-test' }));
});
