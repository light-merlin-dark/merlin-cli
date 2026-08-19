import { test, expect, describe } from 'bun:test';
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './harness.ts';

/**
 * The rule that keeps `CONTRACT.md` from becoming decoration.
 *
 * A promise nothing checks is a comment. This parses the contract, finds every
 * clause that says MUST, and fails the build if one of them has no test in this
 * directory. Adding a clause therefore forces adding a test, in the same commit,
 * or the suite goes red.
 */

const CONTRACT = readFileSync(join(REPO_ROOT, 'CONTRACT.md'), 'utf8');
const HERE = join(REPO_ROOT, 'tests/conformance');

interface Clause {
  id: string;
  normative: boolean;
  process: boolean;
  text: string;
}

function parseClauses(): Clause[] {
  const clauses: Clause[] = [];
  // e.g. `**TRUTH-1.**`, `**GRAM-4 ⊳.**`, `**COMPAT-1 (process).**`
  const pattern = /\*\*([A-Z]+-\d+)([^*]*)\.\*\*/g;
  const positions: Array<{ id: string; qualifier: string; at: number }> = [];

  for (const match of CONTRACT.matchAll(pattern)) {
    positions.push({ id: match[1], qualifier: match[2], at: match.index! });
  }

  positions.forEach((entry, index) => {
    const body = CONTRACT.slice(entry.at, positions[index + 1]?.at ?? CONTRACT.length);
    clauses.push({
      id: entry.id,
      normative: /\bMUST\b/.test(body),
      process: entry.qualifier.includes('(process)'),
      text: body.split('\n')[0]
    });
  });

  return clauses;
}

function testedClauses(): Map<string, string[]> {
  const covered = new Map<string, string[]>();

  for (const file of readdirSync(HERE)) {
    if (!file.endsWith('.conformance.test.ts')) continue;

    const source = readFileSync(join(HERE, file), 'utf8');
    for (const match of source.matchAll(/\bT\(\s*'([A-Z]+-\d+)'\s*,\s*'([^']*)'/g)) {
      const [, clause, description] = match;
      covered.set(clause, [...(covered.get(clause) ?? []), `${file}: ${description}`]);
    }
  }

  return covered;
}

describe('the contract is enforced, not described', () => {
  const clauses = parseClauses();
  const covered = testedClauses();

  test('CONTRACT.md parses into the clause families it claims', () => {
    const families = new Set(clauses.map(clause => clause.id.split('-')[0]));

    expect(families).toEqual(
      new Set(['TRUTH', 'STREAM', 'MODE', 'DESC', 'GRAM', 'EXIT', 'ENV', 'HANG', 'CANCEL', 'DET', 'PERF', 'COMPAT'])
    );
    expect(clauses.length).toBeGreaterThan(40);
  });

  test('every normative clause has at least one conformance test', () => {
    const runtime = clauses.filter(clause => clause.normative && !clause.process);
    const uncovered = runtime.filter(clause => !covered.has(clause.id));

    expect({ uncovered: uncovered.map(clause => clause.id) }).toEqual({ uncovered: [] });
  });

  test('no test claims a clause the contract does not define', () => {
    const defined = new Set(clauses.map(clause => clause.id));
    const orphans = [...covered.keys()].filter(id => !defined.has(id));

    expect(orphans).toEqual([]);
  });

  test('the numbers the README quotes are the numbers the suite produces', () => {
    // The README claims a clause count, a test count and an artifact size.
    // Numbers in prose rot silently; these are the same numbers the suite and
    // the build actually produce, so they cannot.
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

    const runtime = clauses.filter(clause => clause.normative && !clause.process);
    const tests = [...covered.values()].reduce((total, list) => total + list.length, 0);

    const quoted = readme.match(/\*\*(\d+) normative clauses\. (\d+) tests\./);
    expect(quoted).not.toBeNull();
    expect(Number(quoted![1])).toBe(runtime.length);
    expect(Number(quoted![2])).toBe(tests);

    // …and the three clause ids it names as examples must exist.
    const named = readme.match(/`([A-Z]+-\d+)`, `([A-Z]+-\d+)`, `([A-Z]+-\d+)`/);
    expect(named).not.toBeNull();
    const defined = new Set(clauses.map(clause => clause.id));
    for (const id of named!.slice(1)) expect(defined.has(id)).toBe(true);

    // "and 43 others" — the remainder after the three it named.
    const remainder = readme.match(/and (\d+)\s*\n?others/);
    expect(remainder).not.toBeNull();
    expect(Number(remainder![1])).toBe(runtime.length - 3);

    // The stated artifact size, in whole KB, rounded down.
    const size = statSync(join(REPO_ROOT, 'dist/index.js')).size;
    const statedKb = readme.match(/(\d+) KB, unminified/);
    expect(statedKb).not.toBeNull();
    expect(Math.floor(size / 1024)).toBe(Number(statedKb![1]));
  });

  test('the conformance report is written for review', () => {
    const report = {
      contract: '2.0',
      clauses: clauses.map(clause => ({
        id: clause.id,
        normative: clause.normative,
        kind: clause.process ? 'process' : 'runtime',
        tests: covered.get(clause.id) ?? []
      }))
    };

    writeFileSync(join(HERE, 'conformance-report.json'), JSON.stringify(report, null, 2) + '\n');

    const runtimeClauses = report.clauses.filter(c => c.kind === 'runtime' && c.normative);
    expect(runtimeClauses.every(c => c.tests.length > 0)).toBe(true);
  });
});
