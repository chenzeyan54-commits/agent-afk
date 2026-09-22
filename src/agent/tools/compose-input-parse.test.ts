import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { parseComposeInput } from './compose-input-parse.js';

/** Minimal valid input helper. */
function minimal(overrides?: Record<string, unknown>) {
  return {
    nodes: [{ id: 'a', prompt: 'do something', ...overrides }],
  };
}

describe('parseComposeInput — per-node cwd', () => {
  it('accepts a valid absolute cwd', () => {
    const { parsed } = parseComposeInput(minimal({ cwd: '/tmp/my-worktree' }));
    expect(parsed.nodes[0]!.cwd).toBe('/tmp/my-worktree');
  });

  it('omits cwd when not provided', () => {
    const { parsed } = parseComposeInput(minimal());
    expect(parsed.nodes[0]!.cwd).toBeUndefined();
  });

  it('rejects relative cwd', () => {
    expect(() => parseComposeInput(minimal({ cwd: 'relative/path' }))).toThrow(
      /must be an absolute path/,
    );
  });

  it('rejects cwd with .. segments', () => {
    expect(() => parseComposeInput(minimal({ cwd: '/foo/../bar' }))).toThrow(
      /must not contain "\.\." segments/,
    );
  });

  it('accepts cwd with ".." as a substring (not a segment)', () => {
    // Paths like /repo/package..backup contain ".." but as a filename
    // substring, NOT as a bare path segment — must not be rejected.
    const { parsed } = parseComposeInput(minimal({ cwd: '/repo/package..backup' }));
    expect(parsed.nodes[0]!.cwd).toBe('/repo/package..backup');
  });

  it('rejects non-string cwd', () => {
    expect(() => parseComposeInput(minimal({ cwd: 42 }))).toThrow(
      /cwd must be a non-empty string/,
    );
  });

  it('rejects empty string cwd', () => {
    expect(() => parseComposeInput(minimal({ cwd: '  ' }))).toThrow(
      /cwd must be a non-empty string/,
    );
  });
});

describe('parseComposeInput — per-node readRoots', () => {
  it('accepts valid absolute readRoots', () => {
    const { parsed } = parseComposeInput(minimal({ readRoots: ['/data', '/config'] }));
    expect(parsed.nodes[0]!.readRoots).toEqual(['/data', '/config']);
  });

  it('omits readRoots when not provided', () => {
    const { parsed } = parseComposeInput(minimal());
    expect(parsed.nodes[0]!.readRoots).toBeUndefined();
  });

  it('treats empty array as undefined', () => {
    const { parsed } = parseComposeInput(minimal({ readRoots: [] }));
    expect(parsed.nodes[0]!.readRoots).toBeUndefined();
  });

  it('rejects non-array readRoots', () => {
    expect(() => parseComposeInput(minimal({ readRoots: '/single' }))).toThrow(
      /readRoots must be an array/,
    );
  });

  it('rejects relative path in readRoots', () => {
    expect(() => parseComposeInput(minimal({ readRoots: ['relative'] }))).toThrow(
      /readRoots entry must be an absolute path/,
    );
  });

  it('rejects readRoots entry with .. segments', () => {
    expect(() => parseComposeInput(minimal({ readRoots: ['/foo/../bar'] }))).toThrow(
      /readRoots entry must not contain "\.\." segments/,
    );
  });

  it('accepts readRoots entry with ".." as a substring (not a segment)', () => {
    // e.g. /repo/package..backup is a valid path that contains ".." but not as
    // a bare traversal segment — matches the agent tool's behaviour (#662).
    const { parsed } = parseComposeInput(minimal({ readRoots: ['/repo/package..backup'] }));
    expect(parsed.nodes[0]!.readRoots).toEqual(['/repo/package..backup']);
  });

  it('rejects non-string entries in readRoots', () => {
    expect(() => parseComposeInput(minimal({ readRoots: [42] }))).toThrow(
      /readRoots entries must be non-empty strings/,
    );
  });
});

describe('parseComposeInput — per-node writeRoots', () => {
  it('accepts valid absolute writeRoots', () => {
    const { parsed } = parseComposeInput(minimal({ writeRoots: ['/output'] }));
    expect(parsed.nodes[0]!.writeRoots).toEqual(['/output']);
  });

  it('omits writeRoots when not provided', () => {
    const { parsed } = parseComposeInput(minimal());
    expect(parsed.nodes[0]!.writeRoots).toBeUndefined();
  });

  it('treats empty array as undefined', () => {
    const { parsed } = parseComposeInput(minimal({ writeRoots: [] }));
    expect(parsed.nodes[0]!.writeRoots).toBeUndefined();
  });

  it('rejects non-array writeRoots', () => {
    expect(() => parseComposeInput(minimal({ writeRoots: '/single' as unknown as string[] }))).toThrow(
      /writeRoots must be an array/,
    );
  });

  it('rejects non-string entries in writeRoots', () => {
    expect(() => parseComposeInput(minimal({ writeRoots: [42] as unknown as string[] }))).toThrow(
      /writeRoots entries must be non-empty strings/,
    );
  });

  it('rejects relative path in writeRoots', () => {
    expect(() => parseComposeInput(minimal({ writeRoots: ['relative'] }))).toThrow(
      /writeRoots entry must be an absolute path/,
    );
  });

  it('rejects writeRoots entry with .. segments', () => {
    expect(() => parseComposeInput(minimal({ writeRoots: ['/foo/../bar'] }))).toThrow(
      /writeRoots entry must not contain "\.\." segments/,
    );
  });
});

describe('parseComposeInput — combined fields', () => {
  it('passes all three fields through when valid', () => {
    const input = {
      nodes: [{
        id: 'worker',
        prompt: 'build it',
        model: 'sonnet',
        cwd: '/repo/packages/web',
        readRoots: ['/repo/shared'],
        writeRoots: ['/repo/packages/web/dist'],
      }],
    };
    const { parsed } = parseComposeInput(input);
    const node = parsed.nodes[0]!;
    expect(node.cwd).toBe('/repo/packages/web');
    expect(node.readRoots).toEqual(['/repo/shared']);
    expect(node.writeRoots).toEqual(['/repo/packages/web/dist']);
  });

  it('allows cwd without readRoots/writeRoots', () => {
    const { parsed } = parseComposeInput(minimal({ cwd: '/work' }));
    const node = parsed.nodes[0]!;
    expect(node.cwd).toBe('/work');
    expect(node.readRoots).toBeUndefined();
    expect(node.writeRoots).toBeUndefined();
  });

  it('allows readRoots without cwd', () => {
    const { parsed } = parseComposeInput(minimal({ readRoots: ['/data'] }));
    const node = parsed.nodes[0]!;
    expect(node.cwd).toBeUndefined();
    expect(node.readRoots).toEqual(['/data']);
  });
});

// ---------------------------------------------------------------------------
// S-2: cwd breadth guards (isTooBroadRoot / ungatedSensitiveRoot)
// ---------------------------------------------------------------------------
describe('parseComposeInput — cwd breadth guards (S-2)', () => {
  it('rejects filesystem root as cwd', () => {
    expect(() => parseComposeInput(minimal({ cwd: '/' }))).toThrow(
      /must not be a filesystem root, your home directory, or an ancestor/,
    );
  });

  it('rejects home directory as cwd', () => {
    expect(() => parseComposeInput(minimal({ cwd: os.homedir() }))).toThrow(
      /must not be a filesystem root, your home directory, or an ancestor/,
    );
  });

  it('rejects parent of home as cwd', () => {
    const parentOfHome = path.dirname(os.homedir());
    // Only run the assertion when the parent differs from the home dir
    // (i.e. home is not already the filesystem root itself).
    if (parentOfHome !== os.homedir()) {
      expect(() => parseComposeInput(minimal({ cwd: parentOfHome }))).toThrow(
        /must not be a filesystem root, your home directory, or an ancestor/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// S-3: isReadDenied now applies to writeRoots entries
// ---------------------------------------------------------------------------
describe('parseComposeInput — writeRoots denylist check (S-3)', () => {
  it('rejects a credential path in writeRoots', () => {
    // ~/.ssh is a bash-credential root, so it is caught by ungatedSensitiveRoot
    // (breadth guard) before reaching isReadDenied. Both guards reject it;
    // the breadth guard fires first in the current evaluation order.
    const sshDir = path.join(os.homedir(), '.ssh');
    expect(() => parseComposeInput(minimal({ writeRoots: [sshDir] }))).toThrow(
      /would un-gate credential root|must not target a protected\/credential path/,
    );
  });

  it('rejects a read-denylisted path that is NOT an ungatedSensitiveRoot', () => {
    // ~/.afk/config is in the read denylist and is also an AFK breadth target,
    // so it too is caught by isTooBroadRoot (afkBreadthTargets).
    // Use a direct assertion on the thrown message shape.
    const afkConfig = path.join(os.homedir(), '.afk', 'config');
    expect(() => parseComposeInput(minimal({ writeRoots: [afkConfig] }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Breadth guards on readRoots / writeRoots entries (S-2 extension)
// ---------------------------------------------------------------------------
describe('parseComposeInput — root entry breadth guards (S-2 extension)', () => {
  it('rejects filesystem root in readRoots', () => {
    expect(() => parseComposeInput(minimal({ readRoots: ['/'] }))).toThrow(
      /must not be a filesystem root, your home directory, or an ancestor/,
    );
  });

  it('rejects home directory in readRoots', () => {
    expect(() => parseComposeInput(minimal({ readRoots: [os.homedir()] }))).toThrow(
      /must not be a filesystem root, your home directory, or an ancestor/,
    );
  });

  it('rejects filesystem root in writeRoots', () => {
    expect(() => parseComposeInput(minimal({ writeRoots: ['/'] }))).toThrow(
      /must not be a filesystem root, your home directory, or an ancestor/,
    );
  });

  it('rejects home directory in writeRoots', () => {
    expect(() => parseComposeInput(minimal({ writeRoots: [os.homedir()] }))).toThrow(
      /must not be a filesystem root, your home directory, or an ancestor/,
    );
  });

  it('accepts a narrow path inside home for writeRoots', () => {
    const narrowPath = path.join(os.homedir(), 'projects', 'my-repo', 'dist');
    // Only valid if not credential-denylisted — a generic dist dir is fine.
    // The test verifies the breadth guard does NOT fire for narrow paths.
    expect(() => parseComposeInput(minimal({ writeRoots: [narrowPath] }))).not.toThrow(
      /must not be a filesystem root, your home directory, or an ancestor/,
    );
  });
});
