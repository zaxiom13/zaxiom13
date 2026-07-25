import { describe, expect, it } from 'vitest';
import { createInterp } from '../src/q/index';
import { hoverDefinitionAt } from '../src/ui/editor';

describe('editor definition hover', () => {
  it('describes a documented builtin', () => {
    const hit = hoverDefinitionAt('x:sum 1 2 3', 3, createInterp());
    expect(hit?.definition).toMatchObject({
      name: 'sum',
      kind: 'builtin',
      signature: 'sum x',
      description: 'Total. Nulls count as zero.',
      example: undefined,
    });
    expect([hit?.from, hit?.to]).toEqual([2, 5]);
  });

  it('supports symbolic builtins', () => {
    const hit = hoverDefinitionAt('1+2', 1, createInterp());
    expect(hit?.definition.name).toBe('+');
    expect(hit?.definition.signature).toBe('x+y   +x');
  });

  it('finds a local lambda without requiring Run', () => {
    const doc = 'move:{[p;v]\n  p+v };\nnext:move[10;2]';
    const hit = hoverDefinitionAt(doc, doc.lastIndexOf('move') + 1, createInterp());
    expect(hit?.definition).toEqual({
      name: 'move',
      kind: 'function',
      signature: 'move[p;v]',
      description: 'Function defined in this sketch.',
      source: 'move:{[p;v]\n  p+v }',
    });
  });

  it('infers implicit lambda arguments', () => {
    const doc = 'blend:{x+y*z}; blend[1;2;3]';
    const hit = hoverDefinitionAt(doc, doc.lastIndexOf('blend') + 2, createInterp());
    expect(hit?.definition.signature).toBe('blend[x;y;z]');
  });

  it('uses definitions from the current live session', () => {
    const ip = createInterp();
    ip.run('twice:{2*x}');
    const hit = hoverDefinitionAt('twice 21', 2, ip);
    expect(hit?.definition.source).toBe('twice:{2*x}');
  });

  it('does not activate inside strings, comments, or symbol literals', () => {
    const ip = createInterp();
    expect(hoverDefinitionAt('"sum"', 2, ip)).toBeNull();
    expect(hoverDefinitionAt('/ sum', 3, ip)).toBeNull();
    expect(hoverDefinitionAt('`sum', 2, ip)).toBeNull();
  });
});
