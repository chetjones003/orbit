// A small GraphQL executor for the fake GitHub server. It parses queries and mutations (fields, aliases,
// arguments, variables, inline fragments, object and list literals) and resolves them against plain
// objects. Fields with no resolver read the object property of the same name; anything else resolves
// to null and is reported in `warnings`, so a query the app sends that the fake does not model is visible.

const PUNCT = new Set(['{', '}', '(', ')', '[', ']', ':', '!', '$', '=', '@']);

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s|,/.test(ch)) {
      i++;
    } else if (ch === '#') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (source.startsWith('...', i)) {
      tokens.push({ t: '...' });
      i += 3;
    } else if (PUNCT.has(ch)) {
      tokens.push({ t: ch });
      i++;
    } else if (ch === '"') {
      let end = i + 1;
      let value = '';
      while (end < source.length && source[end] !== '"') {
        if (source[end] === '\\') {
          end++;
          value += JSON.parse(`"\\${source[end]}"`);
        } else {
          value += source[end];
        }
        end++;
      }
      if (end >= source.length) throw new Error('Unterminated string in query');
      tokens.push({ t: 'string', v: value });
      i = end + 1;
    } else if (/[-0-9]/.test(ch)) {
      const match = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(source.slice(i));
      tokens.push({ t: 'number', v: Number(match[0]) });
      i += match[0].length;
    } else if (/[_A-Za-z]/.test(ch)) {
      const match = /^[_A-Za-z][_0-9A-Za-z]*/.exec(source.slice(i));
      tokens.push({ t: 'name', v: match[0] });
      i += match[0].length;
    } else {
      throw new Error(`Unexpected character "${ch}" in query`);
    }
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek() {
    return this.tokens[this.pos];
  }
  next() {
    const token = this.tokens[this.pos++];
    if (!token) throw new Error('Unexpected end of query');
    return token;
  }
  expect(t) {
    const token = this.next();
    if (token.t !== t) throw new Error(`Expected "${t}" but found "${token.v ?? token.t}"`);
    return token;
  }
  name() {
    const token = this.next();
    if (token.t !== 'name') throw new Error(`Expected a name but found "${token.v ?? token.t}"`);
    return token.v;
  }

  document() {
    const operations = [];
    while (this.pos < this.tokens.length) {
      const token = this.peek();
      if (token.t === '{') {
        operations.push({ type: 'query', name: null, variables: [], selections: this.selectionSet() });
        continue;
      }
      if (token.t === 'name' && (token.v === 'query' || token.v === 'mutation')) {
        this.next();
        const type = token.v;
        let name = null;
        if (this.peek()?.t === 'name') name = this.name();
        const variables = this.peek()?.t === '(' ? this.variableDefinitions() : [];
        operations.push({ type, name, variables, selections: this.selectionSet() });
        continue;
      }
      throw new Error(`Unexpected "${token.v ?? token.t}" at the top of the query`);
    }
    return operations;
  }

  variableDefinitions() {
    this.expect('(');
    const variables = [];
    while (this.peek()?.t !== ')') {
      this.expect('$');
      const name = this.name();
      this.expect(':');
      this.skipType();
      if (this.peek()?.t === '=') {
        this.next();
        this.value();
      }
      variables.push(name);
    }
    this.expect(')');
    return variables;
  }

  skipType() {
    if (this.peek()?.t === '[') {
      this.next();
      this.skipType();
      this.expect(']');
    } else {
      this.name();
    }
    if (this.peek()?.t === '!') this.next();
  }

  selectionSet() {
    this.expect('{');
    const selections = [];
    while (this.peek()?.t !== '}') selections.push(this.selection());
    this.expect('}');
    return selections;
  }

  selection() {
    if (this.peek()?.t === '...') {
      this.next();
      if (this.peek()?.t === 'name' && this.peek().v === 'on') {
        this.next();
        const typeCondition = this.name();
        return { kind: 'inline', typeCondition, selections: this.selectionSet() };
      }
      throw new Error('Fragment spreads are not supported by the fake GitHub server');
    }
    let alias = null;
    let name = this.name();
    if (this.peek()?.t === ':') {
      this.next();
      alias = name;
      name = this.name();
    }
    const args = this.peek()?.t === '(' ? this.arguments() : {};
    const selections = this.peek()?.t === '{' ? this.selectionSet() : null;
    return { kind: 'field', name, alias: alias ?? name, args, selections };
  }

  arguments() {
    this.expect('(');
    const args = {};
    while (this.peek()?.t !== ')') {
      const name = this.name();
      this.expect(':');
      args[name] = this.value();
    }
    this.expect(')');
    return args;
  }

  value() {
    const token = this.next();
    switch (token.t) {
      case '$':
        return { variable: this.name() };
      case 'number':
      case 'string':
        return token.v;
      case '[': {
        const items = [];
        while (this.peek()?.t !== ']') items.push(this.value());
        this.next();
        return { list: items };
      }
      case '{': {
        const fields = {};
        while (this.peek()?.t !== '}') {
          const name = this.name();
          this.expect(':');
          fields[name] = this.value();
        }
        this.next();
        return { object: fields };
      }
      case 'name':
        if (token.v === 'true') return true;
        if (token.v === 'false') return false;
        if (token.v === 'null') return null;
        return { enum: token.v };
      default:
        throw new Error(`Unexpected "${token.t}" in a value`);
    }
  }
}

/** Turns a parsed argument value into a plain value, reading variables. */
function resolveValue(value, variables) {
  if (value === null || typeof value !== 'object') return value;
  if ('variable' in value) return variables[value.variable] ?? null;
  if ('list' in value) return value.list.map((item) => resolveValue(item, variables));
  if ('object' in value) {
    return Object.fromEntries(Object.entries(value.object).map(([k, v]) => [k, resolveValue(v, variables)]));
  }
  if ('enum' in value) return value.enum;
  return value;
}

/**
 * Creates an executor. `resolvers` maps a type name (or 'Query' / 'Mutation') to field resolvers
 * `(parent, args, ctx) => value`. `abstracts` maps an interface or union name to the concrete types that
 * satisfy it, so `... on Interface` fragments match.
 */
export function createExecutor({ resolvers, abstracts = {} }) {
  const satisfies = (typename, condition) =>
    typename === condition || (abstracts[condition]?.has(typename) ?? false);

  function selectAll(selections, parent, typename, variables, ctx, out) {
    for (const selection of selections) {
      if (selection.kind === 'inline') {
        if (satisfies(typename, selection.typeCondition)) {
          selectAll(selection.selections, parent, typename, variables, ctx, out);
        }
        continue;
      }
      out[selection.alias] = resolveField(selection, parent, typename, variables, ctx);
    }
    return out;
  }

  function resolveField(selection, parent, typename, variables, ctx) {
    if (selection.name === '__typename') return typename ?? null;
    const args = Object.fromEntries(
      Object.entries(selection.args).map(([k, v]) => [k, resolveValue(v, variables)])
    );
    const resolver = resolvers[typename]?.[selection.name];
    let value;
    if (resolver) {
      value = resolver(parent, args, ctx);
    } else if (parent && typeof parent === 'object' && selection.name in parent) {
      value = parent[selection.name];
    } else {
      ctx.warnings.push(`${typename ?? 'value'}.${selection.name} is not modelled by the fake`);
      value = null;
    }
    return complete(value, selection, variables, ctx);
  }

  function complete(value, selection, variables, ctx) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      return value.map((item) => complete(item, selection, variables, ctx));
    }
    if (!selection.selections) return value;
    const typename = value.__typename ?? null;
    return selectAll(selection.selections, value, typename, variables, ctx, {});
  }

  /** Runs a document. Returns `{ data }` or `{ errors }`, the shape GraphQL responds with. */
  return function execute(source, variables = {}, root = {}, options = {}) {
    const ctx = { warnings: [], ...options };
    let operations;
    try {
      operations = new Parser(tokenize(source)).document();
    } catch (error) {
      return { errors: [{ message: error.message }] };
    }
    const operation = operations.find((op) => !options.operationName || op.name === options.operationName);
    if (!operation) return { errors: [{ message: 'No operation to run' }] };
    const rootType = operation.type === 'mutation' ? 'Mutation' : 'Query';
    try {
      const data = selectAll(operation.selections, root, rootType, variables, ctx, {});
      return { data, warnings: ctx.warnings };
    } catch (error) {
      return { errors: [{ message: error.message }], warnings: ctx.warnings };
    }
  };
}
