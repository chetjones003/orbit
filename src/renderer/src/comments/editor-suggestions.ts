import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete';

/**
 * Suggestions while writing Markdown, as GitHub offers them: `#` for issues and pull requests in the repository,
 * `@` for people, and `/` at the start of a line for Markdown snippets.
 */
export interface SuggestionContext {
  /** The repository whose issues and people are suggested. Without it only `/` works. */
  repoFullName?: string;
  /** People already in the conversation, suggested before anyone else. */
  people?: string[];
}

/** One issue or pull request a `#` suggests. */
export interface ItemSuggestion {
  number: number;
  title: string;
  kind: 'issue' | 'pull';
  state: 'open' | 'closed' | 'merged' | 'draft';
  updatedAt: string;
}

const CACHE_MS = 60_000;
const MAX_ITEMS = 8;

interface Cached<T> {
  at: number;
  value: Promise<T>;
}
const itemCache = new Map<string, Cached<ItemSuggestion[]>>();
const peopleCache = new Map<string, Cached<string[]>>();

function cached<T>(cache: Map<string, Cached<T>>, key: string, load: () => Promise<T>, empty: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = load().catch(() => {
    cache.delete(key);
    return empty;
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The repository's most recently updated issues and pull requests, newest first, read once a minute at most. */
export function loadItems(repoFullName: string): Promise<ItemSuggestion[]> {
  return cached(
    itemCache,
    repoFullName.toLowerCase(),
    async () => {
      const [issues, pulls] = await Promise.all([
        window.orbit.issues.list({ repoFullName, state: 'all', page: 1 }).catch(() => null),
        window.orbit.pulls.list({ repoFullName, state: 'all', page: 1 }).catch(() => null)
      ]);
      const items: ItemSuggestion[] = [
        ...(issues?.items ?? []).map((issue) => ({
          number: issue.number,
          title: issue.title,
          kind: 'issue' as const,
          state: issue.state,
          updatedAt: issue.updatedAt
        })),
        ...(pulls?.items ?? []).map((pull) => ({
          number: pull.number,
          title: pull.title,
          kind: 'pull' as const,
          state: pull.merged
            ? ('merged' as const)
            : pull.state === 'closed'
              ? ('closed' as const)
              : pull.draft
                ? ('draft' as const)
                : ('open' as const),
          updatedAt: pull.updatedAt
        }))
      ];
      // The issues list can include pull requests too; each number is kept once, as its own kind.
      const byNumber = new Map<number, ItemSuggestion>();
      for (const item of items) {
        const known = byNumber.get(item.number);
        if (!known || item.kind === 'pull') byNumber.set(item.number, item);
      }
      return [...byNumber.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    []
  );
}

/** People who can be mentioned: those in the conversation first, then the repository's assignable users. */
export function loadPeople(repoFullName: string): Promise<string[]> {
  return cached(
    peopleCache,
    repoFullName.toLowerCase(),
    async () => (await window.orbit.issues.repoOptions(repoFullName)).assignees,
    []
  );
}

/** Items matching what follows the `#`: a number matches by its start, words match anywhere in the title. */
export function matchItems(items: ItemSuggestion[], query: string): ItemSuggestion[] {
  const text = query.trim().toLowerCase();
  if (text === '') return items.slice(0, MAX_ITEMS);
  if (/^\d+$/.test(text))
    return items.filter((item) => String(item.number).startsWith(text)).slice(0, MAX_ITEMS);
  const words = text.split(/\s+/);
  return items
    .filter((item) => words.every((word) => item.title.toLowerCase().includes(word)))
    .slice(0, MAX_ITEMS);
}

/** People whose login starts with what follows the `@`, then those whose login contains it. */
export function matchPeople(people: string[], query: string): string[] {
  const text = query.toLowerCase();
  const unique = [...new Set(people.filter(Boolean))];
  const starts = unique.filter((login) => login.toLowerCase().startsWith(text));
  const contains = unique.filter((login) => !starts.includes(login) && login.toLowerCase().includes(text));
  return [...starts, ...contains].slice(0, MAX_ITEMS);
}

export interface SlashCommand {
  label: string;
  description: string;
  section: string;
  /** CodeMirror snippet text: `${}` marks where the cursor lands, `${name}` a field to fill. */
  template: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    section: 'Alerts',
    label: 'Note',
    description: 'Useful information readers should know',
    template: '> [!NOTE]\n> ${}'
  },
  {
    section: 'Alerts',
    label: 'Tip',
    description: 'Helpful advice for doing things better',
    template: '> [!TIP]\n> ${}'
  },
  {
    section: 'Alerts',
    label: 'Important',
    description: 'Key information readers need',
    template: '> [!IMPORTANT]\n> ${}'
  },
  {
    section: 'Alerts',
    label: 'Warning',
    description: 'Urgent information that needs attention',
    template: '> [!WARNING]\n> ${}'
  },
  {
    section: 'Alerts',
    label: 'Caution',
    description: 'Advises about risks or negative outcomes',
    template: '> [!CAUTION]\n> ${}'
  },
  {
    section: 'Markdown',
    label: 'Code block',
    description: 'A code block formatted for a chosen language',
    template: '```${language}\n${}\n```'
  },
  {
    section: 'Markdown',
    label: 'Details',
    description: 'Hide content behind a visible heading',
    template: '<details>\n<summary>${Summary}</summary>\n\n${}\n\n</details>'
  },
  {
    section: 'Markdown',
    label: 'Table',
    description: 'A table with two columns',
    template: '| ${Column} | Column |\n| --- | --- |\n| ${} |  |'
  },
  {
    section: 'Markdown',
    label: 'Task list',
    description: 'A checklist of things to do',
    template: '- [ ] ${}'
  },
  {
    section: 'Markdown',
    label: 'Mermaid diagram',
    description: 'A diagram drawn from text',
    template: '```mermaid\nflowchart LR\n  ${A} --> B\n```'
  },
  {
    section: 'Markdown',
    label: 'Horizontal rule',
    description: 'A line to separate sections',
    template: '\n---\n${}'
  }
];

/** The text typed after a trigger character at the cursor, when the trigger starts a word. */
function triggered(
  context: CompletionContext,
  trigger: string,
  pattern: RegExp
): { from: number; query: string } | null {
  const match = context.matchBefore(pattern);
  if (!match) return null;
  // The trigger must start a word, so "a#1" or an email address does not open suggestions.
  const before = match.from > 0 ? context.state.sliceDoc(match.from - 1, match.from) : '';
  if (before !== '' && !/[\s([{>]/.test(before)) return null;
  if (!match.text.startsWith(trigger)) return null;
  return { from: match.from, query: match.text.slice(trigger.length) };
}

/** The completion source for one editor. It reads its context each time, so the latest repository is used. */
export function suggestionSource(read: () => SuggestionContext) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const { repoFullName, people = [] } = read();

    const hash = triggered(context, '#', /#[\w-]{0,40}$/);
    if (hash && repoFullName) {
      const items = matchItems(await loadItems(repoFullName), hash.query);
      if (items.length === 0) return null;
      return {
        from: hash.from,
        filter: false,
        options: items.map((item): Completion => ({
          label: `#${item.number}`,
          displayLabel: item.title,
          detail: `#${item.number}`,
          type: `ref ref-${item.kind} ref-${item.state}`,
          apply: `#${item.number} `
        }))
      };
    }

    const at = triggered(context, '@', /@[\w-]*$/);
    if (at && (repoFullName || people.length > 0)) {
      const everyone = [...people, ...(repoFullName ? await loadPeople(repoFullName) : [])];
      const matches = matchPeople(everyone, at.query);
      if (matches.length === 0) return null;
      return {
        from: at.from,
        filter: false,
        options: matches.map((login) => ({
          label: `@${login}`,
          displayLabel: login,
          type: 'person',
          apply: `@${login} `
        }))
      };
    }

    const slash = context.matchBefore(/^\s*\/[\w ]*$/);
    if (slash) {
      const start = slash.from + slash.text.indexOf('/');
      const query = slash.text.slice(slash.text.indexOf('/') + 1).toLowerCase();
      const commands = SLASH_COMMANDS.filter(
        (command) =>
          command.label.toLowerCase().includes(query) || command.section.toLowerCase().includes(query)
      );
      if (commands.length === 0) return null;
      return {
        from: start,
        filter: false,
        options: commands.map((command) => ({
          label: `/${command.label}`,
          displayLabel: command.label,
          detail: command.description,
          section: command.section,
          type: 'command',
          apply: snippet(command.template)
        }))
      };
    }
    return null;
  };
}
