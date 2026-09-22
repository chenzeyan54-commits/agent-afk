/**
 * Per-node attachment resolution for compose DAG nodes.
 *
 * Extracted from compose-executor.ts to keep that file within its baselined
 * code-line budget. Resolves per-node `attachments` (image IDs or file paths)
 * into ContentBlockParam[] arrays ready for dag-subagent's runToResult.
 */

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { resolveSubagentAttachments } from './subagent/attachment-resolve.js';
import { resolveChildManagerReadRoots } from '../subagent-read-scope.js';
import { inboundAttachmentRegistry } from '../content/attachment-registry.js';
import { appendImageBlocks } from '../content/image-blocks.js';
import type { ComposeNodeInput } from './compose-input-parse.js';
import type { ComposeExecutorContext } from './compose-executor.js';

/**
 * Resolve per-node image attachments for an array of compose nodes.
 *
 * Returns a parallel array where each entry is either `ContentBlockParam[]`
 * (image blocks ready for the DAG runner) or `undefined` (no attachments).
 * Throws on resolution failure (bad path, read-denied, size cap).
 */
export async function resolveComposeNodeAttachments(
  nodes: ComposeNodeInput[],
  cwd: string | undefined,
  ctx: Pick<ComposeExecutorContext, 'getReadScopeInputs' | 'parentSession'>,
): Promise<Array<ContentBlockParam[] | undefined>> {
  const readRoots = resolveChildManagerReadRoots(ctx.getReadScopeInputs?.(), cwd);
  const sessionId = ctx.parentSession.sessionId;
  const registry = inboundAttachmentRegistry;

  return Promise.all(
    nodes.map(async (n): Promise<ContentBlockParam[] | undefined> => {
      if (!n.attachments || n.attachments.length === 0) return undefined;
      const raw = await resolveSubagentAttachments({
        paths: n.attachments,
        resolveBase: cwd,
        readRoots,
        sessionId,
        registry,
      });
      const blocks: ContentBlockParam[] = [];
      appendImageBlocks(blocks, raw);
      return blocks.length > 0 ? blocks : undefined;
    }),
  );
}
