import type { WorkflowGraphJob, WorkflowJob } from '../../../shared/issues';

export type JobTone = 'passed' | 'failed' | 'running' | 'queued' | 'stopped';

/** How long a job has run or took: `m:ss`, or `h:mm:ss` past an hour. */
export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** A job's visual state, from its status and, once finished, its conclusion. */
export function jobTone(job: Pick<WorkflowJob, 'status' | 'conclusion'>): JobTone {
  if (job.status === 'in_progress') return 'running';
  if (job.status !== 'completed') return 'queued';
  if (job.conclusion === 'success') return 'passed';
  if (job.conclusion === 'failure' || job.conclusion === 'timed_out') return 'failed';
  return 'stopped';
}

/** Matrix jobs share a name before the parenthesis: "build (windows-latest)" groups under "build". */
export function groupName(name: string): string {
  const match = /^(.+?) \(.+\)$/.exec(name);
  return match ? (match[1] ?? name) : name;
}

export const TONE_LABEL: Record<JobTone, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  queued: 'Queued',
  stopped: 'Cancelled or skipped'
};

/** A job, or a matrix of jobs, as one node of the workflow graph. */
export interface GraphNode {
  id: string;
  label: string;
  members: WorkflowJob[];
  /** Ids of the nodes this one needs. */
  needs: string[];
  column: number;
}

/**
 * Groups jobs into graph nodes and places each node in a column by its dependencies. Without the workflow file,
 * jobs keep the run's order, one column each, so the graph still reads left to right.
 */
export function buildGraph(jobs: WorkflowJob[], declared: WorkflowGraphJob[]): GraphNode[] {
  const byLabel = new Map<string, WorkflowJob[]>();
  for (const job of jobs) {
    const label = groupName(job.name);
    byLabel.set(label, [...(byLabel.get(label) ?? []), job]);
  }
  const byKey = new Map(declared.map((entry) => [entry.key, entry]));
  const byName = new Map(declared.map((entry) => [entry.name, entry]));
  const nodes: GraphNode[] = [...byLabel].map(([label, members]) => ({
    id: label,
    label,
    members,
    needs: [],
    column: 0
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const entry = byName.get(node.id) ?? byKey.get(node.id);
    const needKeys = entry?.needs ?? [];
    node.needs = needKeys
      .map((key) => byKey.get(key)?.name ?? key)
      .filter((id) => nodeIds.has(id) && id !== node.id);
  }
  if (declared.length === 0) {
    nodes.forEach((node, index) => {
      node.column = index;
    });
    return nodes;
  }
  const depth = new Map<string, number>();
  const depthOf = (id: string, visiting: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = nodes.find((candidate) => candidate.id === id);
    const value =
      node && node.needs.length > 0 ? 1 + Math.max(...node.needs.map((need) => depthOf(need, visiting))) : 0;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  for (const node of nodes) node.column = depthOf(node.id, new Set());
  return nodes;
}

/** Sized so two dependency columns fit the details panel without a horizontal scroll. */
export const NODE_WIDTH = 196;
const COLUMN_GAP = 48;
const ROW_GAP = 22;
const PADDING = 10;

/** Height of one node: a single job is short; a matrix is taller, more so when its jobs are listed. */
export function nodeHeight(node: GraphNode, expanded: boolean): number {
  if (node.members.length === 1) return 72;
  return expanded ? 110 + node.members.length * 34 : 104;
}

export interface GraphLayout {
  positions: Map<string, { x: number; y: number; height: number }>;
  width: number;
  height: number;
}

/** Places each column of nodes top to bottom, and the columns left to right. */
export function layoutGraph(nodes: GraphNode[], expanded: Set<string>): GraphLayout {
  const positions = new Map<string, { x: number; y: number; height: number }>();
  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) columns.set(node.column, [...(columns.get(node.column) ?? []), node]);
  let height = 0;
  let width = 0;
  for (const [column, members] of [...columns].sort((a, b) => a[0] - b[0])) {
    const x = PADDING + column * (NODE_WIDTH + COLUMN_GAP);
    let y = PADDING;
    for (const node of members) {
      const h = nodeHeight(node, expanded.has(node.id));
      positions.set(node.id, { x, y, height: h });
      y += h + ROW_GAP;
    }
    height = Math.max(height, y - ROW_GAP + PADDING);
    width = Math.max(width, x + NODE_WIDTH + PADDING);
  }
  return { positions, width: Math.max(width, PADDING * 2), height: Math.max(height, PADDING * 2) };
}

export interface LogLine {
  kind: 'group' | 'line' | 'warning' | 'error';
  text: string;
}

/** A job's log with the runner's markers turned into titles and annotated lines. */
export function parseLogLines(text: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of text.split('\n')) {
    const marker = /##\[(endgroup|group|warning|error)\]/.exec(raw);
    if (!marker) {
      lines.push({ kind: 'line', text: raw });
      continue;
    }
    const prefix = raw.slice(0, marker.index);
    const message = raw.slice(marker.index + marker[0].length);
    if (marker[1] === 'endgroup') continue;
    if (marker[1] === 'group') lines.push({ kind: 'group', text: prefix + message });
    else lines.push({ kind: marker[1] === 'warning' ? 'warning' : 'error', text: prefix + message });
  }
  return lines;
}
