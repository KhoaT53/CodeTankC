import { EnemyInfo } from './types';

export interface CppApiBindings {
  moveDir: (dir: number | string, steps: number) => void;
  moveTo: (x: number, y: number, avoidEnemy?: boolean, mode?: string) => void;
  dash: (dir: number | string) => void;
  shoot: (angle: number) => void;
  autoFire: (bulletCount: number, strategy?: string) => void;
  reload: () => void;
  useSkill: (targetX?: number, targetY?: number) => void;
  getNearestEnemyAngleStatus: () => { first: number; second: number };
  getNearestEnemyInfo: () => EnemyInfo;
  getAllVisibleEnemies: () => EnemyInfo[];
  getNearestItemPos: (itemType?: string) => { first: number; second: number };
  getX: () => number;
  getY: () => number;
  getHP: () => number;
  getAmmo: () => number;
  isSkillReady: () => boolean;
  isDashReady: () => boolean;
  getGridType: (x: number, y: number) => number;
  log?: (msg: string) => void;
}

type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'
  | 'SYMBOL'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  line: number;
}

const MULTI_CHAR_OPS = [
  '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '<<', '>>', '::'
];

export function tokenizeCpp(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Preprocessor directives (#include, #define)
    if (ch === '#') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // Line comment
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // Block comment
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = '';
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i++;
          const esc = source[i];
          str += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
        } else {
          str += source[i];
        }
        i++;
      }
      i++; // closing quote
      tokens.push({ type: 'STRING', value: str, line });
      continue;
    }

    // Number literal
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] || ''))) {
      let num = '';
      while (i < source.length && /[0-9.]/.test(source[i])) {
        num += source[i];
        i++;
      }
      if (source[i] === 'f' || source[i] === 'F') i++;
      tokens.push({ type: 'NUMBER', value: num, line });
      continue;
    }

    // Identifier / keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
        id += source[i];
        i++;
      }
      tokens.push({ type: 'IDENT', value: id, line });
      continue;
    }

    // Multi-char operators
    const two = source.slice(i, i + 2);
    if (MULTI_CHAR_OPS.includes(two)) {
      tokens.push({ type: 'SYMBOL', value: two, line });
      i += 2;
      continue;
    }

    // Single char symbol
    tokens.push({ type: 'SYMBOL', value: ch, line });
    i++;
  }

  tokens.push({ type: 'EOF', value: '', line });
  return tokens;
}

// AST Node types
type Stmt =
  | { kind: 'BLOCK'; stmts: Stmt[] }
  | { kind: 'VAR_DECL'; name: string; typeName: string; init: Expr | null }
  | { kind: 'MULTI_VAR_DECL'; decls: Array<{ name: string; typeName: string; init: Expr | null }> }
  | { kind: 'IF'; cond: Expr; thenBranch: Stmt; elseBranch: Stmt | null }
  | { kind: 'FOR'; init: Stmt | null; cond: Expr | null; step: Expr | null; body: Stmt }
  | { kind: 'WHILE'; cond: Expr; body: Stmt }
  | { kind: 'RETURN'; expr: Expr | null }
  | { kind: 'BREAK' }
  | { kind: 'CONTINUE' }
  | { kind: 'EXPR_STMT'; expr: Expr }
  | { kind: 'EMPTY' };

type Expr =
  | { kind: 'LITERAL'; value: any }
  | { kind: 'INIT_LIST'; items: Expr[] }
  | { kind: 'VAR'; name: string }
  | { kind: 'BINARY'; op: string; left: Expr; right: Expr }
  | { kind: 'UNARY'; op: string; expr: Expr; prefix: boolean }
  | { kind: 'ASSIGN'; op: string; target: Expr; value: Expr }
  | { kind: 'CALL'; callee: Expr; args: Expr[] }
  | { kind: 'MEMBER'; object: Expr; property: string }
  | { kind: 'INDEX'; object: Expr; index: Expr }
  | { kind: 'TERNARY'; cond: Expr; truthy: Expr; falsy: Expr };

interface FuncDecl {
  name: string;
  params: Array<{ name: string; typeName: string }>;
  body: Stmt;
}

export interface ParsedProgram {
  globals: Stmt[];
  functions: Record<string, FuncDecl>;
  topLevelStatements: Stmt[];
}

const TYPE_KEYWORDS = new Set([
  'int', 'double', 'float', 'bool', 'string', 'void', 'auto', 'long', 'short', 'unsigned', 'const',
  'pair', 'vector', 'EnemyInfo', 'std'
]);

export class CppParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private matchSymbol(val: string): boolean {
    if (this.peek().type === 'SYMBOL' && this.peek().value === val) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectSymbol(val: string): void {
    const tok = this.peek();
    if (tok.type === 'SYMBOL' && tok.value === val) {
      this.pos++;
      return;
    }
    throw new Error(`Dòng ${tok.line}: Kỳ vọng '${val}' nhưng gặp '${tok.value || 'EOF'}'`);
  }

  private isTypeStart(): boolean {
    let p = this.pos;
    if (this.tokens[p]?.type === 'IDENT' && this.tokens[p].value === 'const') p++;
    if (this.tokens[p]?.type === 'IDENT' && this.tokens[p].value === 'std' && this.tokens[p + 1]?.value === '::') {
      p += 2;
    }
    const t = this.tokens[p];
    if (!t || t.type !== 'IDENT') return false;
    if (!TYPE_KEYWORDS.has(t.value)) return false;

    // Look ahead past template `<...>` to verify an identifier follows
    p++;
    if (this.tokens[p]?.value === '<') {
      let depth = 1;
      p++;
      while (p < this.tokens.length && depth > 0) {
        if (this.tokens[p].value === '<') depth++;
        else if (this.tokens[p].value === '>') depth--;
        else if (this.tokens[p].value === '>>') depth -= 2;
        p++;
      }
    }
    while (this.tokens[p]?.value === '&' || this.tokens[p]?.value === '*') p++;
    return this.tokens[p]?.type === 'IDENT';
  }

  private parseType(): string {
    let typeStr = '';
    if (this.peek().type === 'IDENT' && this.peek().value === 'const') {
      this.next();
    }
    if (this.peek().type === 'IDENT' && this.peek().value === 'std' && this.peek(1).value === '::') {
      this.next();
      this.next();
    }
    const base = this.next();
    typeStr += base.value;

    if (this.matchSymbol('<')) {
      typeStr += '<';
      let depth = 1;
      while (this.peek().type !== 'EOF' && depth > 0) {
        const tok = this.next();
        if (tok.value === '<') depth++;
        else if (tok.value === '>') depth--;
        else if (tok.value === '>>') depth -= 2;
        typeStr += tok.value;
      }
    }
    while (this.matchSymbol('&') || this.matchSymbol('*')) {
      // ignore ref/pointer modifiers
    }
    return typeStr;
  }

  public parseProgram(): ParsedProgram {
    const globals: Stmt[] = [];
    const functions: Record<string, FuncDecl> = {};
    const topLevelStatements: Stmt[] = [];

    while (this.peek().type !== 'EOF') {
      // Skip `using namespace std;`
      if (this.peek().type === 'IDENT' && this.peek().value === 'using') {
        while (this.peek().type !== 'EOF' && !this.matchSymbol(';')) {
          this.next();
        }
        continue;
      }

      // Skip `struct EnemyInfo { ... };` if user pasted it
      if (this.peek().type === 'IDENT' && this.peek().value === 'struct') {
        this.next();
        if (this.peek().type === 'IDENT') this.next();
        if (this.matchSymbol('{')) {
          let depth = 1;
          while (this.peek().type !== 'EOF' && depth > 0) {
            const tk = this.next();
            if (tk.value === '{') depth++;
            else if (tk.value === '}') depth--;
          }
          this.matchSymbol(';');
          continue;
        }
      }

      if (this.isTypeStart()) {
        const savedPos = this.pos;
        const typeName = this.parseType();
        const nameTok = this.next();
        if (this.matchSymbol('(')) {
          // Function declaration
          const params: Array<{ name: string; typeName: string }> = [];
          if (!this.matchSymbol(')')) {
            do {
              const pType = this.parseType();
              const pName = this.next();
              // Optional default param value `= ...`
              if (this.matchSymbol('=')) {
                this.parseExpression();
              }
              params.push({ name: pName.value, typeName: pType });
            } while (this.matchSymbol(','));
            this.expectSymbol(')');
          }
          const body = this.parseBlock();
          functions[nameTok.value] = { name: nameTok.value, params, body };
          continue;
        } else {
          // Rewind and parse as variable declaration statement
          this.pos = savedPos;
          const declStmt = this.parseVarDeclStmt(true);
          globals.push(declStmt);
          topLevelStatements.push(declStmt);
          continue;
        }
      }

      // Top-level statement (useful for Live Override snippets!)
      const stmt = this.parseStatement();
      topLevelStatements.push(stmt);
    }

    return { globals, functions, topLevelStatements };
  }

  private parseBlock(): Stmt {
    this.expectSymbol('{');
    const stmts: Stmt[] = [];
    while (this.peek().type !== 'EOF' && !(this.peek().type === 'SYMBOL' && this.peek().value === '}')) {
      stmts.push(this.parseStatement());
    }
    this.expectSymbol('}');
    return { kind: 'BLOCK', stmts };
  }

  private parseVarDeclStmt(expectSemicolon = true): Stmt {
    const typeName = this.parseType();
    const decls: Array<{ name: string; typeName: string; init: Expr | null }> = [];

    do {
      const nameTok = this.next();
      if (nameTok.type !== 'IDENT') {
        throw new Error(`Dòng ${nameTok.line}: Tên biến không hợp lệ '${nameTok.value}'`);
      }
      let init: Expr | null = null;
      if (this.matchSymbol('=')) {
        init = this.parseExpression();
      } else if (this.peek().value === '{') {
        init = this.parsePrimary();
      }
      decls.push({ name: nameTok.value, typeName, init });
    } while (this.matchSymbol(','));

    if (expectSemicolon) {
      this.expectSymbol(';');
    }

    if (decls.length === 1) {
      return { kind: 'VAR_DECL', name: decls[0].name, typeName: decls[0].typeName, init: decls[0].init };
    }
    return { kind: 'MULTI_VAR_DECL', decls };
  }

  private parseStatement(): Stmt {
    const tok = this.peek();

    if (tok.type === 'SYMBOL' && tok.value === '{') {
      return this.parseBlock();
    }
    if (this.matchSymbol(';')) {
      return { kind: 'EMPTY' };
    }

    if (tok.type === 'IDENT') {
      if (tok.value === 'if') {
        this.next();
        this.expectSymbol('(');
        const cond = this.parseExpression();
        this.expectSymbol(')');
        const thenBranch = this.parseStatement();
        let elseBranch: Stmt | null = null;
        if (this.peek().type === 'IDENT' && this.peek().value === 'else') {
          this.next();
          elseBranch = this.parseStatement();
        }
        return { kind: 'IF', cond, thenBranch, elseBranch };
      }

      if (tok.value === 'for') {
        this.next();
        this.expectSymbol('(');
        let init: Stmt | null = null;
        if (!this.matchSymbol(';')) {
          if (this.isTypeStart()) {
            init = this.parseVarDeclStmt(true);
          } else {
            const expr = this.parseExpression();
            this.expectSymbol(';');
            init = { kind: 'EXPR_STMT', expr };
          }
        }
        let cond: Expr | null = null;
        if (!this.matchSymbol(';')) {
          cond = this.parseExpression();
          this.expectSymbol(';');
        }
        let step: Expr | null = null;
        if (!this.matchSymbol(')')) {
          step = this.parseExpression();
          this.expectSymbol(')');
        }
        const body = this.parseStatement();
        return { kind: 'FOR', init, cond, step, body };
      }

      if (tok.value === 'while') {
        this.next();
        this.expectSymbol('(');
        const cond = this.parseExpression();
        this.expectSymbol(')');
        const body = this.parseStatement();
        return { kind: 'WHILE', cond, body };
      }

      if (tok.value === 'return') {
        this.next();
        if (this.matchSymbol(';')) {
          return { kind: 'RETURN', expr: null };
        }
        const expr = this.parseExpression();
        this.expectSymbol(';');
        return { kind: 'RETURN', expr };
      }

      if (tok.value === 'break') {
        this.next();
        this.expectSymbol(';');
        return { kind: 'BREAK' };
      }

      if (tok.value === 'continue') {
        this.next();
        this.expectSymbol(';');
        return { kind: 'CONTINUE' };
      }

      if (this.isTypeStart()) {
        return this.parseVarDeclStmt(true);
      }
    }

    const expr = this.parseExpression();
    this.expectSymbol(';');
    return { kind: 'EXPR_STMT', expr };
  }

  private parseExpression(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const left = this.parseTernary();
    const tok = this.peek();
    if (tok.type === 'SYMBOL' && ['=', '+=', '-=', '*=', '/='].includes(tok.value)) {
      this.next();
      const value = this.parseAssignment();
      return { kind: 'ASSIGN', op: tok.value, target: left, value };
    }
    return left;
  }

  private parseTernary(): Expr {
    let expr = this.parseLogicalOr();
    if (this.matchSymbol('?')) {
      const truthy = this.parseExpression();
      this.expectSymbol(':');
      const falsy = this.parseTernary();
      expr = { kind: 'TERNARY', cond: expr, truthy, falsy };
    }
    return expr;
  }

  private parseLogicalOr(): Expr {
    let left = this.parseLogicalAnd();
    while (this.matchSymbol('||')) {
      const right = this.parseLogicalAnd();
      left = { kind: 'BINARY', op: '||', left, right };
    }
    return left;
  }

  private parseLogicalAnd(): Expr {
    let left = this.parseEquality();
    while (this.matchSymbol('&&')) {
      const right = this.parseEquality();
      left = { kind: 'BINARY', op: '&&', left, right };
    }
    return left;
  }

  private parseEquality(): Expr {
    let left = this.parseRelational();
    while (this.peek().type === 'SYMBOL' && ['==', '!='].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseRelational();
      left = { kind: 'BINARY', op, left, right };
    }
    return left;
  }

  private parseRelational(): Expr {
    let left = this.parseAdditive();
    while (this.peek().type === 'SYMBOL' && ['<', '<=', '>', '>='].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseAdditive();
      left = { kind: 'BINARY', op, left, right };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.peek().type === 'SYMBOL' && ['+', '-', '<<'].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { kind: 'BINARY', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.peek().type === 'SYMBOL' && ['*', '/', '%'].includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: 'BINARY', op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    const tok = this.peek();
    if (tok.type === 'SYMBOL' && ['!', '-', '+', '++', '--'].includes(tok.value)) {
      const op = this.next().value;
      const expr = this.parseUnary();
      return { kind: 'UNARY', op, expr, prefix: true };
    }
    // C-style cast e.g. `(int)x` or `(double)y`
    if (
      tok.type === 'SYMBOL' &&
      tok.value === '(' &&
      this.peek(1).type === 'IDENT' &&
      ['int', 'double', 'float', 'bool'].includes(this.peek(1).value) &&
      this.peek(2).value === ')'
    ) {
      this.next(); // (
      const castType = this.next().value;
      this.next(); // )
      const inner = this.parseUnary();
      return {
        kind: 'CALL',
        callee: { kind: 'VAR', name: `__cast_${castType}` },
        args: [inner],
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    while (true) {
      if (this.matchSymbol('(')) {
        const args: Expr[] = [];
        if (!this.matchSymbol(')')) {
          do {
            args.push(this.parseExpression());
          } while (this.matchSymbol(','));
          this.expectSymbol(')');
        }
        expr = { kind: 'CALL', callee: expr, args };
      } else if (this.matchSymbol('.')) {
        const prop = this.next();
        expr = { kind: 'MEMBER', object: expr, property: prop.value };
      } else if (this.matchSymbol('[')) {
        const index = this.parseExpression();
        this.expectSymbol(']');
        expr = { kind: 'INDEX', object: expr, index };
      } else if (this.peek().type === 'SYMBOL' && ['++', '--'].includes(this.peek().value)) {
        const op = this.next().value;
        expr = { kind: 'UNARY', op, expr, prefix: false };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const tok = this.peek();

    if (tok.type === 'NUMBER') {
      this.next();
      return { kind: 'LITERAL', value: Number(tok.value) };
    }
    if (tok.type === 'STRING') {
      this.next();
      return { kind: 'LITERAL', value: tok.value };
    }
    if (tok.type === 'SYMBOL' && tok.value === '{') {
      this.next();
      const items: Expr[] = [];
      if (!this.matchSymbol('}')) {
        do {
          items.push(this.parseExpression());
        } while (this.matchSymbol(','));
        this.expectSymbol('}');
      }
      return { kind: 'INIT_LIST', items };
    }
    if (tok.type === 'SYMBOL' && tok.value === '(') {
      this.next();
      const expr = this.parseExpression();
      this.expectSymbol(')');
      return expr;
    }
    if (tok.type === 'IDENT') {
      this.next();
      if (tok.value === 'std' && this.matchSymbol('::')) {
        const sub = this.next();
        return { kind: 'VAR', name: sub.value };
      }
      if (tok.value === 'true') return { kind: 'LITERAL', value: true };
      if (tok.value === 'false') return { kind: 'LITERAL', value: false };
      if (tok.value === 'M_PI') return { kind: 'LITERAL', value: Math.PI };
      if (tok.value === 'endl') return { kind: 'LITERAL', value: '' };
      return { kind: 'VAR', name: tok.value };
    }

    throw new Error(`Dòng ${tok.line}: Cú pháp không hợp lệ tại '${tok.value || 'EOF'}'`);
  }
}

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  public value: any;
  constructor(value: any) {
    this.value = value;
  }
}

function defaultForType(typeName: string): any {
  if (typeName.startsWith('pair')) return { first: 0, second: 0 };
  if (typeName.startsWith('vector')) return [];
  if (typeName === 'EnemyInfo') {
    return { id: -1, x: -1, y: -1, hp: 0, angle: -1, dist: 999, status: 0 };
  }
  if (typeName === 'string') return '';
  if (typeName === 'bool') return false;
  return 0;
}

export class CppRuntime {
  private program: ParsedProgram;
  private globals: Record<string, any>;
  private api: CppApiBindings;
  private stepBudget = 0;
  private maxSteps = 4000;

  constructor(program: ParsedProgram, globals: Record<string, any>, api: CppApiBindings) {
    this.program = program;
    this.globals = globals;
    this.api = api;
  }

  public initGlobals(): void {
    this.stepBudget = 0;
    const scopeStack: Array<Record<string, any>> = [this.globals];
    for (const stmt of this.program.globals) {
      this.execStmt(stmt, scopeStack);
    }
  }

  public callFunction(name: string, args: any[] = []): any {
    const fn = this.program.functions[name];
    if (!fn) return undefined;
    this.stepBudget = 0;
    const localScope: Record<string, any> = {};
    for (let i = 0; i < fn.params.length; i++) {
      localScope[fn.params[i].name] = args[i] ?? defaultForType(fn.params[i].typeName);
    }
    try {
      this.execStmt(fn.body, [this.globals, localScope]);
    } catch (sig) {
      if (sig instanceof ReturnSignal) {
        return sig.value;
      }
      throw sig;
    }
    return undefined;
  }

  public executeTopLevel(): void {
    this.stepBudget = 0;
    const scopeStack: Array<Record<string, any>> = [this.globals];
    try {
      for (const stmt of this.program.topLevelStatements) {
        this.execStmt(stmt, scopeStack);
      }
      if (this.program.topLevelStatements.length === 0 && this.program.functions['loop']) {
        this.callFunction('loop');
      }
    } catch (sig) {
      if (sig instanceof ReturnSignal) return;
      throw sig;
    }
  }

  private checkBudget(): void {
    this.stepBudget++;
    if (this.stepBudget > this.maxSteps) {
      throw new Error('Vượt quá giới hạn vòng lặp (Infinite Loop Guard: 4000 bước/tick).');
    }
  }

  private resolveScope(name: string, scopes: Array<Record<string, any>>): Record<string, any> | null {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (name in scopes[i]) return scopes[i];
    }
    return null;
  }

  private coerceType(val: any, typeName?: string): any {
    if (!typeName) return val;
    if (typeName === 'int' && typeof val === 'number') return Math.trunc(val);
    if (typeName === 'bool') return Boolean(val);
    if (typeName.startsWith('pair') && Array.isArray(val)) {
      return { first: val[0] ?? 0, second: val[1] ?? 0 };
    }
    return val;
  }

  private execStmt(stmt: Stmt, scopes: Array<Record<string, any>>): void {
    this.checkBudget();

    switch (stmt.kind) {
      case 'EMPTY':
        return;

      case 'BLOCK': {
        const blockScope: Record<string, any> = {};
        scopes.push(blockScope);
        try {
          for (const s of stmt.stmts) {
            this.execStmt(s, scopes);
          }
        } finally {
          scopes.pop();
        }
        return;
      }

      case 'VAR_DECL': {
        const current = scopes[scopes.length - 1];
        const raw = stmt.init ? this.evalExpr(stmt.init, scopes) : defaultForType(stmt.typeName);
        current[stmt.name] = this.coerceType(raw, stmt.typeName);
        return;
      }

      case 'MULTI_VAR_DECL': {
        const current = scopes[scopes.length - 1];
        for (const d of stmt.decls) {
          const raw = d.init ? this.evalExpr(d.init, scopes) : defaultForType(d.typeName);
          current[d.name] = this.coerceType(raw, d.typeName);
        }
        return;
      }

      case 'IF': {
        const cond = this.evalExpr(stmt.cond, scopes);
        if (cond) {
          this.execStmt(stmt.thenBranch, scopes);
        } else if (stmt.elseBranch) {
          this.execStmt(stmt.elseBranch, scopes);
        }
        return;
      }

      case 'FOR': {
        const forScope: Record<string, any> = {};
        scopes.push(forScope);
        try {
          if (stmt.init) this.execStmt(stmt.init, scopes);
          while (true) {
            this.checkBudget();
            if (stmt.cond) {
              const c = this.evalExpr(stmt.cond, scopes);
              if (!c) break;
            }
            try {
              this.execStmt(stmt.body, scopes);
            } catch (sig) {
              if (sig instanceof BreakSignal) break;
              if (sig instanceof ContinueSignal) {
                // continue to step
              } else {
                throw sig;
              }
            }
            if (stmt.step) {
              this.evalExpr(stmt.step, scopes);
            }
          }
        } finally {
          scopes.pop();
        }
        return;
      }

      case 'WHILE': {
        while (true) {
          this.checkBudget();
          const c = this.evalExpr(stmt.cond, scopes);
          if (!c) break;
          try {
            this.execStmt(stmt.body, scopes);
          } catch (sig) {
            if (sig instanceof BreakSignal) break;
            if (sig instanceof ContinueSignal) continue;
            throw sig;
          }
        }
        return;
      }

      case 'RETURN': {
        const val = stmt.expr ? this.evalExpr(stmt.expr, scopes) : undefined;
        throw new ReturnSignal(val);
      }

      case 'BREAK':
        throw new BreakSignal();

      case 'CONTINUE':
        throw new ContinueSignal();

      case 'EXPR_STMT':
        this.evalExpr(stmt.expr, scopes);
        return;
    }
  }

  private evalExpr(expr: Expr, scopes: Array<Record<string, any>>): any {
    this.checkBudget();

    switch (expr.kind) {
      case 'LITERAL':
        return expr.value;

      case 'INIT_LIST': {
        const vals = expr.items.map((it) => this.evalExpr(it, scopes));
        if (vals.length === 2 && typeof vals[0] === 'number' && typeof vals[1] === 'number') {
          return { first: vals[0], second: vals[1] };
        }
        return vals;
      }

      case 'VAR': {
        if (expr.name === 'cout') return '__COUT__';
        const scope = this.resolveScope(expr.name, scopes);
        if (scope) return scope[expr.name];
        return 0;
      }

      case 'TERNARY': {
        const c = this.evalExpr(expr.cond, scopes);
        return c ? this.evalExpr(expr.truthy, scopes) : this.evalExpr(expr.falsy, scopes);
      }

      case 'UNARY': {
        if (expr.op === '!') return !this.evalExpr(expr.expr, scopes);
        if (expr.op === '-') return -Number(this.evalExpr(expr.expr, scopes));
        if (expr.op === '+') return +Number(this.evalExpr(expr.expr, scopes));
        if (expr.op === '++' || expr.op === '--') {
          const delta = expr.op === '++' ? 1 : -1;
          if (expr.expr.kind === 'VAR') {
            const sc = this.resolveScope(expr.expr.name, scopes) ?? scopes[scopes.length - 1];
            const old = Number(sc[expr.expr.name] ?? 0);
            sc[expr.expr.name] = old + delta;
            return expr.prefix ? old + delta : old;
          }
          if (expr.expr.kind === 'MEMBER') {
            const obj = this.evalExpr(expr.expr.object, scopes);
            const old = Number(obj[expr.expr.property] ?? 0);
            obj[expr.expr.property] = old + delta;
            return expr.prefix ? old + delta : old;
          }
        }
        return 0;
      }

      case 'ASSIGN': {
        const rightVal = this.evalExpr(expr.value, scopes);
        const applyOp = (oldVal: any, rVal: any) => {
          if (expr.op === '=') return rVal;
          if (expr.op === '+=') return oldVal + rVal;
          if (expr.op === '-=') return oldVal - rVal;
          if (expr.op === '*=') return oldVal * rVal;
          if (expr.op === '/=') return rVal !== 0 ? oldVal / rVal : 0;
          return rVal;
        };

        if (expr.target.kind === 'VAR') {
          const sc = this.resolveScope(expr.target.name, scopes) ?? scopes[scopes.length - 1];
          const updated = applyOp(sc[expr.target.name], rightVal);
          sc[expr.target.name] = updated;
          return updated;
        }
        if (expr.target.kind === 'MEMBER') {
          const obj = this.evalExpr(expr.target.object, scopes);
          if (obj && typeof obj === 'object') {
            const updated = applyOp(obj[expr.target.property], rightVal);
            obj[expr.target.property] = updated;
            return updated;
          }
        }
        if (expr.target.kind === 'INDEX') {
          const arr = this.evalExpr(expr.target.object, scopes);
          const idx = Math.trunc(Number(this.evalExpr(expr.target.index, scopes)));
          if (Array.isArray(arr) && idx >= 0 && idx < arr.length) {
            const updated = applyOp(arr[idx], rightVal);
            arr[idx] = updated;
            return updated;
          }
        }
        return rightVal;
      }

      case 'BINARY': {
        if (expr.op === '&&') {
          return Boolean(this.evalExpr(expr.left, scopes)) && Boolean(this.evalExpr(expr.right, scopes));
        }
        if (expr.op === '||') {
          return Boolean(this.evalExpr(expr.left, scopes)) || Boolean(this.evalExpr(expr.right, scopes));
        }
        const l = this.evalExpr(expr.left, scopes);
        const r = this.evalExpr(expr.right, scopes);
        if (expr.op === '<<') {
          if (l === '__COUT__' || typeof l === 'string') {
            const msg = l === '__COUT__' ? String(r) : `${l}${r}`;
            if (r === '') {
              this.api.log?.(msg);
            }
            return msg;
          }
          return Number(l) << Number(r);
        }
        switch (expr.op) {
          case '+': return (l as any) + (r as any);
          case '-': return Number(l) - Number(r);
          case '*': return Number(l) * Number(r);
          case '/': return Number(r) !== 0 ? Number(l) / Number(r) : 0;
          case '%': return Number(r) !== 0 ? Math.trunc(Number(l)) % Math.trunc(Number(r)) : 0;
          case '==': return l === r;
          case '!=': return l !== r;
          case '<': return l < r;
          case '<=': return l <= r;
          case '>': return l > r;
          case '>=': return l >= r;
        }
        return 0;
      }

      case 'MEMBER': {
        const obj = this.evalExpr(expr.object, scopes);
        if (obj == null) return 0;
        if (Array.isArray(obj)) {
          if (expr.property === 'size' || expr.property === 'length') return () => obj.length;
          if (expr.property === 'empty') return () => obj.length === 0;
          if (expr.property === 'push_back') return (item: any) => obj.push(item);
          if (expr.property === 'clear') return () => { obj.length = 0; };
        }
        if (typeof obj === 'string') {
          if (expr.property === 'size' || expr.property === 'length') return () => obj.length;
          if (expr.property === 'empty') return () => obj.length === 0;
        }
        return obj[expr.property];
      }

      case 'INDEX': {
        const arr = this.evalExpr(expr.object, scopes);
        const idx = Math.trunc(Number(this.evalExpr(expr.index, scopes)));
        if (Array.isArray(arr)) {
          return arr[idx] ?? { id: -1, x: -1, y: -1, hp: 0, angle: -1, dist: 999, status: 0 };
        }
        return 0;
      }

      case 'CALL': {
        const args = expr.args.map((a) => this.evalExpr(a, scopes));

        // Method call on object (e.g. vec.size(), vec.empty(), vec.push_back(x))
        if (expr.callee.kind === 'MEMBER') {
          const fnOrVal = this.evalExpr(expr.callee, scopes);
          if (typeof fnOrVal === 'function') {
            return fnOrVal(...args);
          }
          return fnOrVal;
        }

        if (expr.callee.kind === 'VAR') {
          const fnName = expr.callee.name;

          // Cast helpers
          if (fnName === '__cast_int') return Math.trunc(Number(args[0] ?? 0));
          if (fnName === '__cast_double' || fnName === '__cast_float') return Number(args[0] ?? 0);
          if (fnName === '__cast_bool') return Boolean(args[0]);

          // Standard C++ Math & Utility functions
          if (fnName === 'abs' || fnName === 'fabs') return Math.abs(Number(args[0] ?? 0));
          if (fnName === 'min') return Math.min(Number(args[0] ?? 0), Number(args[1] ?? 0));
          if (fnName === 'max') return Math.max(Number(args[0] ?? 0), Number(args[1] ?? 0));
          if (fnName === 'floor') return Math.floor(Number(args[0] ?? 0));
          if (fnName === 'ceil') return Math.ceil(Number(args[0] ?? 0));
          if (fnName === 'round') return Math.round(Number(args[0] ?? 0));
          if (fnName === 'sqrt') return Math.sqrt(Math.max(0, Number(args[0] ?? 0)));
          if (fnName === 'hypot') return Math.hypot(Number(args[0] ?? 0), Number(args[1] ?? 0));
          if (fnName === 'sin') return Math.sin(Number(args[0] ?? 0));
          if (fnName === 'cos') return Math.cos(Number(args[0] ?? 0));
          if (fnName === 'atan2') return Math.atan2(Number(args[0] ?? 0), Number(args[1] ?? 0));
          if (fnName === 'make_pair') return { first: args[0] ?? 0, second: args[1] ?? 0 };
          if (fnName === 'print' || fnName === 'log') {
            this.api.log?.(args.map((x) => String(x)).join(' '));
            return;
          }

          // Mandatory Tank C++ API
          switch (fnName) {
            case 'moveDir':
              return this.api.moveDir(args[0] ?? 0, Math.max(1, Math.trunc(Number(args[1] ?? 1))));
            case 'moveTo':
              return this.api.moveTo(
                Math.trunc(Number(args[0] ?? 0)),
                Math.trunc(Number(args[1] ?? 0)),
                Boolean(args[2] ?? false),
                String(args[3] ?? 'SHORTEST')
              );
            case 'dash':
              return this.api.dash(args[0] ?? 0);
            case 'shoot':
              return this.api.shoot(Math.round(Number(args[0] ?? 0)));
            case 'autoFire':
              return this.api.autoFire(
                Math.max(1, Math.trunc(Number(args[0] ?? 1))),
                String(args[1] ?? 'DIRECT')
              );
            case 'reload':
              return this.api.reload();
            case 'useSkill':
              if (args.length >= 2) {
                return this.api.useSkill(Math.trunc(Number(args[0])), Math.trunc(Number(args[1])));
              }
              return this.api.useSkill();
            case 'getNearestEnemyAngleStatus':
              return this.api.getNearestEnemyAngleStatus();
            case 'getNearestEnemyInfo':
              return this.api.getNearestEnemyInfo();
            case 'getAllVisibleEnemies':
              return this.api.getAllVisibleEnemies();
            case 'getNearestItemPos':
              return this.api.getNearestItemPos(String(args[0] ?? 'ANY'));
            case 'getX':
              return this.api.getX();
            case 'getY':
              return this.api.getY();
            case 'getHP':
              return this.api.getHP();
            case 'getAmmo':
              return this.api.getAmmo();
            case 'isSkillReady':
              return this.api.isSkillReady();
            case 'isDashReady':
              return this.api.isDashReady();
            case 'getGridType':
              return this.api.getGridType(
                Math.trunc(Number(args[0] ?? 0)),
                Math.trunc(Number(args[1] ?? 0))
              );
          }

          // User-defined function
          if (this.program.functions[fnName]) {
            return this.callFunction(fnName, args);
          }

          throw new Error(`Hàm không xác định: '${fnName}()'`);
        }
        return undefined;
      }
    }
  }
}

export function compileCppSource(source: string): ParsedProgram {
  const tokens = tokenizeCpp(source);
  const parser = new CppParser(tokens);
  return parser.parseProgram();
}
