import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeAssistant, TOOLS } from '../src/assistant/llm.js';

test('the AI gets read-only tools only: nothing can buy, sell or change the copy desk', () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of names) assert.doesNotMatch(n, /buy|sell|swap|trade|order|approve|copy_desk|mode|watch/i, n);
  for (const t of TOOLS) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
  }
});

test('runs the tool loop through the service and returns the final text', async () => {
  const calls = [];
  const replies = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_suggestions', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Copy W1: about +$19.88 a week after fees.' }] },
  ];
  const client = { beta: { messages: { create: async (req) => { calls.push(req); return replies.shift(); } } } };
  const svc = { suggestions: async () => ({ picks: [{ wallet: 'W1', perWeekUsd: 19.88, headline: 'h', reasons: [] }], note: '' }) };
  const a = new ClaudeAssistant({ client, svc });
  const out = await a.ask('who should I copy?', {});
  assert.equal(out.text, 'Copy W1: about +$19.88 a week after fees.');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.equal(calls[0].fallbacks, 'default');
  assert.deepEqual(calls[0].betas, ['server-side-fallback-2026-07-01']);
  assert.equal(calls[0].tool_choice, undefined, 'forced tool choice is a 400 on this model');
  const toolResult = calls[1].messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.match(toolResult.content, /19.88/);
  assert.doesNotMatch(toolResult.content, /SOL|lamport/);
});

test('a refusal becomes a polite plain answer, not a crash', async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } };
  const a = new ClaudeAssistant({ client, svc: {} });
  const out = await a.ask('x', {});
  assert.match(out.text, /can't help with that/i);
});
