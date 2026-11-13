'use strict';

// Fleetum-local patch for GHSA-vfj7-8cjw-p6xm. Bounds are fixed so caller
// options cannot re-enable unbounded recursive walks. Parent/prev links are
// not child edges; parsed ASTs contain legitimate back references.
const MAX_AST_DEPTH = 128;
const MAX_AST_NODES = 20000;

const limitError = reason => {
  const error = new SyntaxError(`Brace AST limit exceeded: ${reason}`);
  error.code = 'ERR_BRACES_AST_LIMIT';
  return error;
};

const assertDepth = depth => {
  if (depth > MAX_AST_DEPTH) throw limitError('nesting depth');
};

const assertAstLimits = ast => {
  const stack = [{ node: ast, depth: 0, exit: false }];
  const ancestors = new WeakSet();
  let visited = 0;
  let scheduled = 1;
  while (stack.length) {
    const { node, depth, exit } = stack.pop();
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) continue;
    if (exit) {
      ancestors.delete(node);
      continue;
    }
    assertDepth(depth);
    if (++visited > MAX_AST_NODES) throw limitError('node count');
    if (ancestors.has(node)) throw limitError('cyclic children');

    // expand also follows parent links. Validate them without following prev
    // links or counting normal backlinks as child cycles.
    let parent = node;
    let parentDepth = 0;
    const parents = new Set();
    while (parent && parent.parent) {
      if (parents.has(parent)) throw limitError('cyclic parents');
      parents.add(parent);
      assertDepth(++parentDepth);
      parent = parent.parent;
    }

    if (node.nodes == null) continue;
    if (!Array.isArray(node.nodes)) throw limitError('invalid children');
    // Count edges before allocating pending work. A shared DAG can have few
    // unique nodes but an enormous number of traversal paths.
    scheduled += node.nodes.length;
    if (scheduled > MAX_AST_NODES) throw limitError('node count');
    ancestors.add(node);
    stack.push({ node, depth, exit: true });
    for (let i = node.nodes.length - 1; i >= 0; i--) {
      stack.push({ node: node.nodes[i], depth: depth + 1, exit: false });
    }
  }
};

module.exports = { assertDepth, assertAstLimits };
