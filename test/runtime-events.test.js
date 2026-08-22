import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnEventNormalizer, EdithState, stripInlineReasoning } from '../src/runtime/events.js';

test('turn event normalizer', async (t) => {
  await t.test('separates reasoning deltas from answer text deltas', () => {
    const normalizer = new TurnEventNormalizer();
    const thinking = normalizer.normalize({ type: 'model.message.delta', reasoning_content: 'hmm' });
    assert.equal(thinking[0].state, EdithState.THINKING);
    const streaming = normalizer.normalize({ type: 'model.message.delta', content: 'Hello' });
    assert.equal(streaming[0].state, EdithState.STREAMING);
    assert.equal(streaming[0].text, 'Hello');
  });

  await t.test('tracks tool calls so results and approvals carry tool names', () => {
    const normalizer = new TurnEventNormalizer();
    const calls = normalizer.normalize({
      type: 'model.message',
      tool_calls: [{ id: 'call-1', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }]
    });
    assert.equal(calls[0].type, 'tool-call');
    assert.equal(calls[0].tool, 'read_file');
    assert.deepEqual(calls[0].args, { path: 'a.js' });

    const result = normalizer.normalize({ type: 'tool.response', tool_call_id: 'call-1', content: 'file body' });
    assert.equal(result[0].tool, 'read_file');

    const approval = normalizer.normalize({
      type: 'tool.approval_required',
      thread_id: 'main',
      tool_calls: [{ id: 'call-1', source_event_id: 'e1' }]
    });
    assert.equal(approval[0].state, EdithState.WAITING_APPROVAL);
    assert.equal(approval[0].toolCalls[0].tool, 'read_file');
  });

  await t.test('streamed tool-call chunks announce once args are complete', () => {
    const normalizer = new TurnEventNormalizer();
    const first = normalizer.normalize({
      type: 'model.message.delta',
      tool_calls: [{ index: 0, id: 'call-9', function: { name: 'read_file', arguments: '' } }]
    });
    assert.equal(first.length, 0, 'no announcement before args are usable');
    const partial = normalizer.normalize({
      type: 'model.message.delta',
      tool_calls: [{ index: 0, function: { arguments: '{"path":' } }]
    });
    assert.equal(partial.length, 0, 'incomplete JSON args stay pending');
    const complete = normalizer.normalize({
      type: 'model.message.delta',
      tool_calls: [{ index: 0, function: { arguments: '"notes.txt"}' } }]
    });
    assert.equal(complete[0].type, 'tool-call');
    assert.deepEqual(complete[0].args, { path: 'notes.txt' });
    // The persisted complete message must not re-announce.
    const replay = normalizer.normalize({
      type: 'model.message',
      tool_calls: [{ id: 'call-9', function: { name: 'read_file', arguments: '{"path":"notes.txt"}' } }]
    });
    assert.equal(replay.filter((event) => event.type === 'tool-call').length, 0);
  });

  await t.test('never-completing args flush when the tool responds', () => {
    const normalizer = new TurnEventNormalizer();
    normalizer.normalize({
      type: 'model.message.delta',
      tool_calls: [{ index: 0, id: 'call-x', function: { name: 'git_status', arguments: '' } }]
    });
    const events = normalizer.normalize({ type: 'tool.response', tool_call_id: 'call-x', content: 'clean' });
    assert.equal(events[0].type, 'tool-call');
    assert.equal(events[0].tool, 'git_status');
    assert.equal(events[1].type, 'tool-result');
  });

  await t.test('marks complete message text as already-streamed when deltas were seen', () => {
    const normalizer = new TurnEventNormalizer();
    normalizer.normalize({ type: 'model.message.delta', content: 'Hi' });
    const events = normalizer.normalize({ type: 'model.message', content: 'Hi there' });
    assert.equal(events[0].streamed, true);
  });

  await t.test('maps terminal states', () => {
    const normalizer = new TurnEventNormalizer();
    assert.equal(normalizer.normalize({ type: 'turn.done', state: { status: 'done' } })[0].state, EdithState.COMPLETED);
    assert.equal(normalizer.normalize({ type: 'turn.done', state: { status: 'cancelled' } })[0].state, EdithState.CANCELLED);
    assert.equal(normalizer.normalize({ type: 'turn.done', state: { status: 'error', message: 'boom' } })[0].state, EdithState.FAILED);
  });

  await t.test('runtime plumbing events carry no UI state', () => {
    const normalizer = new TurnEventNormalizer();
    const events = normalizer.normalize({ type: 'mcp.initialize' });
    assert.equal(events[0].state, null);
    assert.equal(events[0].type, 'runtime');
  });

  await t.test('strips inline <think> blocks from local model output', () => {
    assert.equal(stripInlineReasoning('<think>internal</think>\nThe answer is 4.'), 'The answer is 4.');
  });
});
