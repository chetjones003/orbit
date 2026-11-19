import { useEffect, useMemo, useState } from 'react';
import type { WorkflowGraphJob, WorkflowJob } from '../../../shared/issues';
import { Icon } from '../icons';
import { subscribeItemsRefresh } from '../shell/list-events';
import {
  buildGraph,
  formatDuration,
  jobTone,
  layoutGraph,
  NODE_WIDTH,
  nodeHeight,
  parseLogLines,
  TONE_LABEL,
  type GraphNode,
  type JobTone
} from './ci-model';

export interface WorkflowGraphProps {
  repoFullName: string;
  jobs: WorkflowJob[];
  /** The workflow file's jobs and their needs. Empty when the file could not be read. */
  declared: WorkflowGraphJob[];
  now: number;
}

/** Status glyph for a job or a node: a coloured disc, a spinner while running, or a hollow ring when queued. */
export function StatusGlyph({ tone }: { tone: JobTone }) {
  if (tone === 'running') return <span className="wf-spinner" aria-hidden="true" />;
  const name =
    tone === 'passed' ? 'check' : tone === 'failed' ? 'close' : tone === 'queued' ? 'issue' : 'alert';
  return (
    <span className={`wf-glyph wf-${tone}`} aria-hidden="true">
      <Icon name={name} size={12} />
    </span>
  );
}

function durationOf(job: WorkflowJob, now: number): string {
  const tone = jobTone(job);
  if (tone === 'queued') return 'queued';
  if (job.startedAt === null) return '';
  const end = tone === 'running' ? now : Date.parse(job.completedAt ?? job.startedAt);
  return formatDuration(end - Date.parse(job.startedAt));
}

/** A node's tone: failed beats running, running beats queued, and passed only when every job passed. */
function nodeTone(members: WorkflowJob[]): JobTone {
  const tones = members.map(jobTone);
  if (tones.includes('failed')) return 'failed';
  if (tones.includes('running')) return 'running';
  if (tones.includes('queued')) return 'queued';
  if (tones.every((tone) => tone === 'passed')) return 'passed';
  return 'stopped';
}

/**
 * The workflow graph of one run, laid out like GitHub's: jobs as nodes, dependencies as curved edges, and a
 * matrix as one node that lists its jobs on demand. Pick a job to read its log below the graph.
 */
export function WorkflowGraph({ repoFullName, jobs, declared, now }: WorkflowGraphProps) {
  const nodes = useMemo(() => buildGraph(jobs, declared), [jobs, declared]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<WorkflowJob | null>(null);
  const layout = useMemo(() => layoutGraph(nodes, expanded), [nodes, expanded]);

  const toggle = (id: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const edges: Array<{ from: string; to: string; d: string }> = [];
  for (const node of nodes) {
    const to = layout.positions.get(node.id);
    if (!to) continue;
    for (const need of node.needs) {
      const from = layout.positions.get(need);
      if (!from) continue;
      const fromHeight = from.height;
      const x1 = from.x + NODE_WIDTH;
      const y1 = from.y + fromHeight / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const curve = Math.max(40, (x2 - x1) / 2);
      edges.push({
        from: need,
        to: node.id,
        d: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`
      });
    }
  }

  return (
    <div className="wf" aria-label="Workflow graph">
      <div className="wf-scroll">
        <div className="wf-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg className="wf-edges" width={layout.width} height={layout.height} aria-hidden="true">
            {edges.map((edge) => (
              <path key={`${edge.from}->${edge.to}`} d={edge.d} />
            ))}
          </svg>
          {nodes.map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            return (
              <NodeCard
                key={node.id}
                node={node}
                left={position.x}
                top={position.y}
                height={nodeHeight(node, expanded.has(node.id))}
                expanded={expanded.has(node.id)}
                now={now}
                selectedId={selected?.id ?? null}
                onToggle={() => toggle(node.id)}
                onSelect={setSelected}
              />
            );
          })}
        </div>
      </div>
      {selected && (
        <JobLog
          key={selected.id}
          repoFullName={repoFullName}
          job={selected}
          now={now}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface NodeCardProps {
  node: GraphNode;
  left: number;
  top: number;
  height: number;
  expanded: boolean;
  now: number;
  selectedId: number | null;
  onToggle: () => void;
  onSelect: (job: WorkflowJob) => void;
}

function NodeCard({ node, left, top, height, expanded, now, selectedId, onToggle, onSelect }: NodeCardProps) {
  const style = { left, top, height, width: NODE_WIDTH };
  if (node.members.length === 1) {
    const job = node.members[0]!;
    const tone = jobTone(job);
    const duration = durationOf(job, now);
    return (
      <div className={`wf-node wf-node-${tone} ${selectedId === job.id ? 'selected' : ''}`} style={style}>
        <button
          type="button"
          className="wf-node-main"
          aria-label={`${job.name}, ${TONE_LABEL[tone]}${duration ? `, ${duration}` : ''}. Show log`}
          onClick={() => onSelect(job)}
        >
          <span className="wf-node-title">
            <StatusGlyph tone={tone} />
            <span className="wf-node-name">{job.name}</span>
          </span>
          <span className="wf-node-meta">
            {tone === 'queued' ? 'Queued' : TONE_LABEL[tone]}
            {duration && <span className="wf-node-time">{duration}</span>}
          </span>
        </button>
      </div>
    );
  }

  const tone = nodeTone(node.members);
  const done = node.members.filter((job) => jobTone(job) === 'passed').length;
  const running = node.members.filter((job) => jobTone(job) === 'running').length;
  return (
    <div className="wf-matrix" style={{ left, top, width: NODE_WIDTH, height }}>
      <span className="wf-matrix-tab">Matrix: {node.label}</span>
      <div className={`wf-node wf-node-${tone}`} style={{ height: height - 14 }}>
        <div className="wf-node-title">
          <StatusGlyph tone={tone} />
          <span className="wf-node-name">
            {running > 0 ? `${running} running` : `${done} of ${node.members.length} jobs completed`}
          </span>
        </div>
        <button type="button" className="wf-matrix-toggle" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? 'Hide jobs' : 'Show all jobs'}
        </button>
        {expanded && (
          <ul className="wf-matrix-jobs">
            {node.members.map((job) => {
              const memberTone = jobTone(job);
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    className={selectedId === job.id ? 'selected' : ''}
                    aria-label={`${job.name}, ${TONE_LABEL[memberTone]}. Show log`}
                    onClick={() => onSelect(job)}
                  >
                    <StatusGlyph tone={memberTone} />
                    <span className="wf-matrix-job-name">{job.name}</span>
                    <span className="wf-node-time">{durationOf(job, now)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A job's log, read on demand and again every 10 seconds while the job runs. */
function JobLog({
  repoFullName,
  job,
  now,
  onClose
}: {
  repoFullName: string;
  job: WorkflowJob;
  now: number;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeItemsRefresh(() => setVersion((value) => value + 1)), []);
  const tone = jobTone(job);
  const running = tone === 'running';

  useEffect(() => {
    let cancelled = false;
    void window.orbit.actions.jobLogs(repoFullName, job.id).then(
      (next) => {
        if (!cancelled) setText(next);
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'The log could not be loaded.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, job.id, version]);

  useEffect(() => {
    if (!running) return;
    const refresh = setInterval(() => setVersion((value) => value + 1), 10000);
    return () => clearInterval(refresh);
  }, [running]);

  return (
    <section className="wf-log" aria-label={`Log for ${job.name}`}>
      <header className="wf-log-head">
        <StatusGlyph tone={tone} />
        <span className="wf-log-title">{job.name}</span>
        <span className="wf-node-time">{durationOf(job, now)}</span>
        <button
          type="button"
          className="text-action"
          onClick={() => void window.orbit.app.openExternal(job.htmlUrl)}
        >
          Open on GitHub
        </button>
        <button type="button" className="icon-button" aria-label="Close log" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </header>
      {error && (
        <p role="alert" className="session-notice">
          {error}
        </p>
      )}
      {text === null && !error && <p className="detail-muted">Loading log…</p>}
      {text !== null && (
        <div className="wf-log-body">
          {parseLogLines(text).map((line, index) => (
            <div key={index} className={`wf-log-${line.kind}`}>
              {line.text || ' '}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
