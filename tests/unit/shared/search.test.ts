import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  parseSearchText,
  removeSearchFilter,
  resolveSearch,
  type RepoRef
} from '../../../src/shared/search';

const REPOS: RepoRef[] = [
  { name: 'atlas-cad', fullName: 'orbit-owner/atlas-cad' },
  { name: 'site', fullName: 'orbit-owner/site' }
];
const NO_CHIPS = { kind: 'all' as const, state: 'open' as const, repoFullName: null };

describe('parseSearchText reads plain words as filters', () => {
  it('reads kind, status, and repository from everyday phrases', () => {
    expect(parseSearchText('open pull requests in atlas-cad', REPOS)).toMatchObject({
      terms: '',
      kind: 'pull',
      state: 'open',
      repoFullName: 'orbit-owner/atlas-cad'
    });
  });

  it('reads issue, closed, and PR spellings', () => {
    expect(parseSearchText('closed issues', REPOS)).toMatchObject({ kind: 'issue', state: 'closed' });
    expect(parseSearchText('prs', REPOS)).toMatchObject({ kind: 'pull' });
  });

  it('reads labels and authors', () => {
    expect(parseSearchText('issues labeled bug @octo', REPOS)).toMatchObject({
      terms: '',
      kind: 'issue',
      labels: ['bug'],
      author: 'octo'
    });
    expect(parseSearchText('label "good first issue"', REPOS).labels).toEqual(['good first issue']);
  });

  it('keeps the words that are left, without the filler', () => {
    expect(parseSearchText('crash on start', REPOS).terms).toBe('crash start');
    expect(parseSearchText('the', REPOS).terms).toBe('the');
  });

  it('only treats "in" as a repository when it names one of the owner’s repos', () => {
    expect(parseSearchText('bug in parser', REPOS)).toMatchObject({
      repoFullName: null,
      terms: 'bug parser'
    });
  });

  it('gives no filter when two different values are named', () => {
    expect(parseSearchText('issues and pull requests', REPOS).kind).toBeNull();
  });

  it('still reads the coded form for anyone who uses it', () => {
    expect(
      parseSearchText('is:pr repo:atlas-cad label:"good first issue" author:octo crash', REPOS)
    ).toMatchObject({
      terms: 'crash',
      kind: 'pull',
      repoFullName: 'orbit-owner/atlas-cad',
      labels: ['good first issue'],
      author: 'octo'
    });
  });
});

describe('resolveSearch and activeFilters', () => {
  it('lets the text win over the controls, and the controls fill in what the text leaves out', () => {
    const resolved = resolveSearch(parseSearchText('closed bugs', REPOS), {
      kind: 'pull',
      state: 'open',
      repoFullName: null
    });
    expect(resolved).toMatchObject({ terms: 'bugs', kind: 'pull', state: 'closed' });
  });

  it('lists the filters in effect, leaving out the default status', () => {
    const resolved = resolveSearch(parseSearchText('pull requests labeled bug', REPOS), NO_CHIPS);
    expect(activeFilters(resolved).map((filter) => filter.label)).toEqual(['Pull requests', 'Label: bug']);
  });
});

describe('removeSearchFilter takes one filter out of the text', () => {
  it('removes the words for that filter and keeps the rest', () => {
    const text = 'open pull requests crash';
    const next = removeSearchFilter(text, { key: 'kind', value: 'pull', label: '' }, REPOS);
    const parsed = parseSearchText(next, REPOS);
    expect(parsed).toMatchObject({ kind: null, state: 'open', terms: 'crash' });
  });

  it('keeps the other words in their places', () => {
    const next = removeSearchFilter(
      'in atlas-cad open pull requests crash',
      { key: 'kind', value: 'pull', label: '' },
      REPOS
    );
    expect(next).toBe('in atlas-cad open crash');
  });

  it('removes only the label it names', () => {
    const next = removeSearchFilter(
      'issues labeled bug labeled docs',
      { key: 'label', value: 'bug', label: '' },
      REPOS
    );
    expect(parseSearchText(next, REPOS).labels).toEqual(['docs']);
  });

  it('leaves the text exactly as typed when the filter is not in it', () => {
    expect(removeSearchFilter('crash open', { key: 'kind', value: 'pull', label: '' }, REPOS)).toBe(
      'crash open'
    );
  });
});

describe('numbers the owner types', () => {
  it('reads a bare number or #number as the issue or pull request number, and keeps it as a word', () => {
    expect(parseSearchText('1236', REPOS)).toMatchObject({ number: 1236, terms: '1236' });
    expect(parseSearchText('#14 open', REPOS)).toMatchObject({ number: 14, state: 'open' });
  });

  it('does not read a number that belongs to a label, or one too long to be an issue number', () => {
    expect(parseSearchText('label 2', REPOS).number).toBeNull();
    expect(parseSearchText('1234567890', REPOS).number).toBeNull();
  });

  it('passes the number through resolveSearch', () => {
    expect(resolveSearch(parseSearchText('1236', REPOS), NO_CHIPS).number).toBe(1236);
  });
});
