/**
 * Unit tests for topology.ts — pure tree-builder, no DOM or React.
 *
 * Coverage:
 *   - categorizeToolName: every category + MCP prefix + unknown fallback
 *   - formatSpineDuration: <1s, seconds, minutes, boundary values
 *   - formatSpineCost: below threshold, above threshold, exact boundary
 *   - buildSpineTree: empty, tool-only, subagent parent-child, orphan
 *     re-parenting, claimed-tool dedup, root sort order
 */

import { describe, it, expect } from 'vitest';
import {
  categorizeToolName,
  formatSpineDuration,
  formatSpineCost,
  buildSpineTree,
} from './topology';
import type { TranscriptItem } from '@/lib/ledger-adapter';

// ---------------------------------------------------------------------------
// Helpers — minimal TranscriptItem factories
// ---------------------------------------------------------------------------

let seq = 0;
function nextId(): string {
  return `id-${++seq}`;
}

function toolItem(
  overrides: Partial<Extract<TranscriptItem, { kind: 'tool' }>> = {},
): Extract<TranscriptItem, { kind: 'tool' }> {
  const id = nextId();
  return {
    kind: 'tool',
    id,
    name: 'bash',
    toolUseId: `use-${id}`,
    inputPreview: '{}',
    status: 'ok',
    ...overrides,
  };
}

function subagentItem(
  overrides: Partial<Extract<TranscriptItem, { kind: 'subagent' }>> = {},
): Extract<TranscriptItem, { kind: 'subagent' }> {
  const id = nextId();
  return {
    kind: 'subagent',
    id,
    subagentId: `sub-${id}`,
    status: 'succeeded',
    label: 'child agent',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// categorizeToolName
// ---------------------------------------------------------------------------

describe('categorizeToolName', () => {
  it('classifies read tools', () => {
    expect(categorizeToolName('read_file')).toBe('read');
    expect(categorizeToolName('glob')).toBe('read');
    expect(categorizeToolName('grep')).toBe('read');
    expect(categorizeToolName('list_directory')).toBe('read');
    expect(categorizeToolName('json_query')).toBe('read');
    expect(categorizeToolName('read_witness')).toBe('read');
    expect(categorizeToolName('search_witness')).toBe('read');
    expect(categorizeToolName('get_facet')).toBe('read');
    expect(categorizeToolName('clipboard_read')).toBe('read');
  });

  it('classifies write tools', () => {
    expect(categorizeToolName('write_file')).toBe('write');
    expect(categorizeToolName('edit_file')).toBe('write');
    expect(categorizeToolName('patch_apply')).toBe('write');
    expect(categorizeToolName('clipboard_write')).toBe('write');
    expect(categorizeToolName('procedure_write')).toBe('write');
  });

  it('classifies shell tools', () => {
    expect(categorizeToolName('bash')).toBe('shell');
    expect(categorizeToolName('test_run')).toBe('shell');
    expect(categorizeToolName('wait_for')).toBe('shell');
  });

  it('classifies agent tools', () => {
    expect(categorizeToolName('agent')).toBe('agent');
    expect(categorizeToolName('send_message_to_agent')).toBe('agent');
    expect(categorizeToolName('cancel_background_job')).toBe('agent');
  });

  it('classifies skill tools', () => {
    expect(categorizeToolName('skill')).toBe('skill');
  });

  it('classifies dag tools', () => {
    expect(categorizeToolName('compose')).toBe('dag');
  });

  it('classifies web tools', () => {
    expect(categorizeToolName('web_scrape')).toBe('web');
    expect(categorizeToolName('web_request')).toBe('web');
  });

  it('classifies browser tools', () => {
    expect(categorizeToolName('browser_open')).toBe('browser');
    expect(categorizeToolName('browser_act')).toBe('browser');
    expect(categorizeToolName('browser_observe')).toBe('browser');
    expect(categorizeToolName('browser_screenshot')).toBe('browser');
    expect(categorizeToolName('browser_close')).toBe('browser');
  });

  it('classifies MCP tools by mcp__ prefix', () => {
    expect(categorizeToolName('mcp__my_server__some_tool')).toBe('mcp');
    expect(categorizeToolName('mcp__github__create_pr')).toBe('mcp');
  });

  it('falls through to other for storage tools', () => {
    expect(categorizeToolName('memory_search')).toBe('other');
    expect(categorizeToolName('memory_update')).toBe('other');
    expect(categorizeToolName('state_get')).toBe('other');
    expect(categorizeToolName('workspace_publish')).toBe('other');
    expect(categorizeToolName('workspace_query')).toBe('other');
  });

  it('returns other for completely unknown names', () => {
    expect(categorizeToolName('totally_unknown_tool')).toBe('other');
    expect(categorizeToolName('')).toBe('other');
    expect(categorizeToolName('READ_FILE')).toBe('other'); // case-sensitive
  });
});

// ---------------------------------------------------------------------------
// formatSpineDuration
// ---------------------------------------------------------------------------

describe('formatSpineDuration', () => {
  it('returns <1s for 0 ms', () => {
    expect(formatSpineDuration(0)).toBe('<1s');
  });

  it('returns <1s for any value under 1000 ms', () => {
    expect(formatSpineDuration(1)).toBe('<1s');
    expect(formatSpineDuration(500)).toBe('<1s');
    expect(formatSpineDuration(999)).toBe('<1s');
  });

  it('returns X.Xs for exactly 1000 ms', () => {
    expect(formatSpineDuration(1000)).toBe('1.0s');
  });

  it('returns X.Xs for values in the 1-60 second range', () => {
    expect(formatSpineDuration(1500)).toBe('1.5s');
    expect(formatSpineDuration(10000)).toBe('10.0s');
    expect(formatSpineDuration(59999)).toBe('60.0s'); // rounds up at toFixed
  });

  it('returns Xm Xs for values at 60 seconds', () => {
    expect(formatSpineDuration(60000)).toBe('1m 0s');
  });

  it('returns Xm Xs for values above 60 seconds', () => {
    expect(formatSpineDuration(61000)).toBe('1m 1s');
    expect(formatSpineDuration(90000)).toBe('1m 30s');
    expect(formatSpineDuration(120000)).toBe('2m 0s');
    expect(formatSpineDuration(3661000)).toBe('61m 1s');
  });

  it('truncates fractional seconds in the minutes range', () => {
    // 90500 ms → 90.5s → 1m 30s (floor, not round)
    expect(formatSpineDuration(90500)).toBe('1m 30s');
  });
});

// ---------------------------------------------------------------------------
// formatSpineCost
// ---------------------------------------------------------------------------

describe('formatSpineCost', () => {
  it('returns <$0.001 for values below the threshold', () => {
    expect(formatSpineCost(0)).toBe('<$0.001');
    expect(formatSpineCost(0.0001)).toBe('<$0.001');
    expect(formatSpineCost(0.0009999)).toBe('<$0.001');
  });

  it('returns formatted string for values at and above threshold', () => {
    expect(formatSpineCost(0.001)).toBe('$0.001');
    expect(formatSpineCost(0.0234)).toBe('$0.023');
    expect(formatSpineCost(1.5)).toBe('$1.500');
    expect(formatSpineCost(10)).toBe('$10.000');
  });
});

// ---------------------------------------------------------------------------
// buildSpineTree
// ---------------------------------------------------------------------------

describe('buildSpineTree', () => {
  // Reset the item id sequence before each describe block runs.
  // (seq is module-level so tests are order-dependent within this file —
  // factories always produce unique ids regardless.)

  it('returns an empty array for empty input', () => {
    expect(buildSpineTree([])).toEqual([]);
  });

  it('returns non-transcript items ignored (user, assistant, etc.)', () => {
    const items: TranscriptItem[] = [
      { kind: 'user', id: 'u1', text: 'hello' },
      { kind: 'assistant', id: 'a1', text: 'hi' },
      { kind: 'notice', id: 'n1', text: 'note' },
    ];
    expect(buildSpineTree(items)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Tool-only input — flat list
  // -------------------------------------------------------------------------

  it('returns tool-only inputs as flat root nodes', () => {
    const t1 = toolItem({ name: 'bash', status: 'ok' });
    const t2 = toolItem({ name: 'read_file', status: 'running' });
    const roots = buildSpineTree([t1, t2]);

    expect(roots).toHaveLength(2);
    expect(roots[0]!.kind).toBe('tool');
    expect(roots[0]!.label).toBe('bash');
    expect(roots[0]!.category).toBe('shell');
    expect(roots[0]!.status).toBe('ok');
    expect(roots[0]!.children).toEqual([]);
    expect(roots[1]!.kind).toBe('tool');
    expect(roots[1]!.label).toBe('read_file');
    expect(roots[1]!.status).toBe('running');
  });

  it('maps tool statuses correctly', () => {
    const ok = toolItem({ status: 'ok' });
    const err = toolItem({ status: 'error' });
    const running = toolItem({ status: 'running' });

    const roots = buildSpineTree([ok, err, running]);
    expect(roots[0]!.status).toBe('ok');
    expect(roots[0]!.isActive).toBe(false);
    expect(roots[1]!.status).toBe('error');
    expect(roots[1]!.isActive).toBe(false);
    expect(roots[2]!.status).toBe('running');
    expect(roots[2]!.isActive).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Subagent parent-child linking via parentToolUseId
  // -------------------------------------------------------------------------

  it('links a subagent to its parent tool node via parentToolUseId', () => {
    const agentTool = toolItem({ name: 'agent', status: 'ok', toolUseId: 'use-agent-1' });
    const child = subagentItem({ parentToolUseId: 'use-agent-1' });

    const roots = buildSpineTree([agentTool, child]);

    // Only the parent tool node appears at root level; the subagent is nested.
    expect(roots).toHaveLength(1);
    const parentNode = roots[0]!;
    // Tool node is promoted to kind='agent' when claimed.
    expect(parentNode.kind).toBe('agent');
    expect(parentNode.label).toBe('agent');
    expect(parentNode.children).toHaveLength(1);
    expect(parentNode.children[0]!.kind).toBe('agent');
    expect(parentNode.children[0]!.label).toBe('child agent');
  });

  it('links a subagent to its parent via secondary parentId when parentToolUseId is absent', () => {
    const parentSub = subagentItem({ subagentId: 'parent-sub', status: 'running' });
    const childSub = subagentItem({ parentId: 'parent-sub', subagentId: 'child-sub' });

    const roots = buildSpineTree([parentSub, childSub]);

    expect(roots).toHaveLength(1);
    const parentNode = roots[0]!;
    expect(parentNode.kind).toBe('agent');
    expect(parentNode.children).toHaveLength(1);
    expect(parentNode.children[0]!.kind).toBe('agent');
  });

  it('appears as a flat root when a subagent has no parentToolUseId and no parentId', () => {
    const standalone = subagentItem({});
    const roots = buildSpineTree([standalone]);

    expect(roots).toHaveLength(1);
    expect(roots[0]!.kind).toBe('agent');
    expect(roots[0]!.children).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Orphan re-parenting — out-of-order SSE
  // -------------------------------------------------------------------------

  it('re-parents a subagent that arrived before its parent tool node', () => {
    // Simulate out-of-order SSE: child arrives first in the list,
    // but the parent tool arrives after. Pass 4 should re-parent.
    const agentTool = toolItem({ name: 'agent', status: 'ok', toolUseId: 'use-ooo-1' });
    const child = subagentItem({ parentToolUseId: 'use-ooo-1' });

    // Reverse the order relative to normal SSE so child arrives "first".
    // Since both are in the same flat list and the algorithm processes
    // tool items first, we need to verify that even when listed after tools
    // the orphan pass handles references to tools that had been built in pass 2.
    // We can force the scenario more precisely by omitting toolUseId initially:
    // build a tool without a toolUseId so the initial linkage fails.
    const orphanChild = subagentItem({
      subagentId: 'sub-orphan',
      parentToolUseId: 'use-late',
    });
    const lateTool = toolItem({
      name: 'agent',
      toolUseId: 'use-late',
      status: 'ok',
    });

    // Pass the subagent BEFORE the tool in the items list.
    // The algorithm processes toolItems and subagentItems separately,
    // so the order within items[] determines inputPosition but not linkage.
    // The orphan pass (pass 4) handles the miss from pass 3.
    const roots = buildSpineTree([orphanChild as TranscriptItem, lateTool as TranscriptItem]);

    // The tool should be claimed and the orphan re-parented under it.
    expect(roots).toHaveLength(1);
    expect(roots[0]!.kind).toBe('agent');
    expect(roots[0]!.children).toHaveLength(1);
    expect(roots[0]!.children[0]!.sourceId).toBe('sub-orphan');
  });

  it('re-parents a subagent whose parentId parent arrived later', () => {
    const orphanChild = subagentItem({ subagentId: 'sub-late-child', parentId: 'sub-late-parent' });
    const parentSub = subagentItem({ subagentId: 'sub-late-parent' });

    // Child listed first; pass 3 will orphan it; pass 4 re-parents.
    const roots = buildSpineTree([orphanChild as TranscriptItem, parentSub as TranscriptItem]);

    // The parent appears as root with the child nested.
    expect(roots).toHaveLength(1);
    const parentNode = roots.find((n) => n.sourceId === 'sub-late-parent');
    expect(parentNode).toBeDefined();
    expect(parentNode!.children).toHaveLength(1);
    expect(parentNode!.children[0]!.sourceId).toBe('sub-late-child');
  });

  it('falls back to flat root when parentToolUseId references a non-existent tool', () => {
    const orphan = subagentItem({ parentToolUseId: 'no-such-tool' });
    const roots = buildSpineTree([orphan as TranscriptItem]);

    expect(roots).toHaveLength(1);
    expect(roots[0]!.kind).toBe('agent');
  });

  // -------------------------------------------------------------------------
  // Claimed-tool dedup
  // -------------------------------------------------------------------------

  it('does not add a claimed tool node as a standalone root', () => {
    const agentTool = toolItem({ name: 'agent', toolUseId: 'use-claimed' });
    const child = subagentItem({ parentToolUseId: 'use-claimed' });

    const roots = buildSpineTree([agentTool, child] as TranscriptItem[]);

    // Exactly one root: the claimed (promoted) tool node.
    expect(roots).toHaveLength(1);
    // No duplicate raw tool node at root level.
    const toolRoots = roots.filter((n) => n.id === agentTool.id && n.children.length === 0);
    expect(toolRoots).toHaveLength(0);
  });

  it('handles multiple agent tools each claiming a different subagent', () => {
    const t1 = toolItem({ name: 'agent', toolUseId: 'use-t1' });
    const t2 = toolItem({ name: 'agent', toolUseId: 'use-t2' });
    const s1 = subagentItem({ parentToolUseId: 'use-t1', label: 'child-1' });
    const s2 = subagentItem({ parentToolUseId: 'use-t2', label: 'child-2' });
    const unclaimed = toolItem({ name: 'bash', toolUseId: 'use-t3' });

    const roots = buildSpineTree([t1, s1, t2, s2, unclaimed] as TranscriptItem[]);

    // Two claimed agent nodes + one unclaimed bash node = 3 roots.
    expect(roots).toHaveLength(3);
    const agentRoots = roots.filter((n) => n.children.length > 0);
    expect(agentRoots).toHaveLength(2);
    const bashRoot = roots.find((n) => n.label === 'bash');
    expect(bashRoot).toBeDefined();
    expect(bashRoot!.children).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Root sort order — reflects SSE arrival order
  // -------------------------------------------------------------------------

  it('sorts roots by SSE arrival order (input position)', () => {
    const first = toolItem({ name: 'bash' });
    const second = toolItem({ name: 'read_file' });
    const third = toolItem({ name: 'write_file' });

    // Roots should appear in input order regardless of kind.
    const roots = buildSpineTree([first, second, third] as TranscriptItem[]);
    expect(roots[0]!.label).toBe('bash');
    expect(roots[1]!.label).toBe('read_file');
    expect(roots[2]!.label).toBe('write_file');
  });

  it('preserves arrival order when tools and subagents are interleaved', () => {
    const t1 = toolItem({ name: 'bash' });
    const s1 = subagentItem({ label: 'agent-A' }); // no parent → flat root
    const t2 = toolItem({ name: 'glob' });

    const roots = buildSpineTree([t1, s1, t2] as TranscriptItem[]);
    expect(roots).toHaveLength(3);
    expect(roots[0]!.label).toBe('bash');
    expect(roots[1]!.label).toBe('agent-A');
    expect(roots[2]!.label).toBe('glob');
  });

  // -------------------------------------------------------------------------
  // SpineNode field mapping
  // -------------------------------------------------------------------------

  it('copies sourceId from toolUseId for tool nodes', () => {
    const t = toolItem({ toolUseId: 'tuid-abc' });
    const roots = buildSpineTree([t] as TranscriptItem[]);
    expect(roots[0]!.sourceId).toBe('tuid-abc');
  });

  it('copies sourceId from subagentId for subagent nodes', () => {
    const s = subagentItem({ subagentId: 'sub-xyz' });
    const roots = buildSpineTree([s] as TranscriptItem[]);
    expect(roots[0]!.sourceId).toBe('sub-xyz');
  });

  it('maps subagent statuses correctly', () => {
    const succeeded = subagentItem({ status: 'succeeded' });
    const failed = subagentItem({ status: 'failed' });
    const cancelled = subagentItem({ status: 'cancelled' });
    const running = subagentItem({ status: 'running' });

    const roots = buildSpineTree([succeeded, failed, cancelled, running] as TranscriptItem[]);
    expect(roots[0]!.status).toBe('ok');
    expect(roots[0]!.isActive).toBe(false);
    expect(roots[1]!.status).toBe('error');
    expect(roots[1]!.isActive).toBe(false);
    expect(roots[2]!.status).toBe('cancelled');
    expect(roots[2]!.isActive).toBe(false);
    expect(roots[3]!.status).toBe('running');
    expect(roots[3]!.isActive).toBe(true);
  });

  it('propagates optional fields from subagent items to the node', () => {
    const s = subagentItem({
      label: 'my-agent',
      model: 'claude-opus-4-5',
      agentType: 'research',
      durationMs: 3500,
      totalCostUsd: 0.042,
      promptHead: 'investigate the thing',
      turnCount: 7,
    });
    const roots = buildSpineTree([s] as TranscriptItem[]);
    const node = roots[0]!;
    expect(node.model).toBe('claude-opus-4-5');
    expect(node.agentType).toBe('research');
    expect(node.durationMs).toBe(3500);
    expect(node.costUsd).toBe(0.042);
    expect(node.preview).toBe('investigate the thing');
    expect(node.turnCount).toBe(7);
  });

  it('propagates optional fields from tool items to the node', () => {
    const t = toolItem({
      name: 'bash',
      inputPreview: 'ls -la',
      durationMs: 120,
      status: 'ok',
    });
    const roots = buildSpineTree([t] as TranscriptItem[]);
    const node = roots[0]!;
    expect(node.preview).toBe('ls -la');
    expect(node.durationMs).toBe(120);
    expect(node.category).toBe('shell');
  });
});
