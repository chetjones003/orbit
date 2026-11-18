import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { IssueLabelChip } from '../issues/IssueLabelChip';
import { ProjectValueLabel } from '../projects/ProjectValueLabel';
import type { HoverCardSpeed } from '../../../shared/ipc';
import {
  hoverTargetOf,
  loadHovercard,
  type HoverCardData,
  type HoverState,
  type HoverTarget,
  type ReviewSummary
} from './hovercard-model';

/** How long the pointer rests on a link before its card opens, for each speed, and how long the card waits after it leaves. */
export const HOVERCARD_OPEN_MS: Record<Exclude<HoverCardSpeed, 'off'>, number> = {
  quick: 200,
  normal: 450,
  slow: 900
};
export const HOVERCARD_CLOSE_MS = 180;

const CARD_WIDTH = 380;
const GAP = 8;

interface Shown {
  anchor: Element;
  target: HoverTarget;
  data: HoverCardData | null;
}

/**
 * One hover card for the whole window. Any issue or pull request link, row or card opens it after a short
 * rest of the pointer (or keyboard focus): the item's state, title, labels, project fields, a taste of its
 * body, and sub-issue progress or CI. The card stays while the pointer moves onto it.
 */
export interface HoverCardLayerProps {
  /** How soon a card opens. Off shows none. */
  speed?: HoverCardSpeed;
  /** Opens the item, from the card's title. */
  onOpen?: (repoFullName: string, number: number, kind: 'issue' | 'pull') => void;
}

export function HoverCardLayer({ speed = 'normal', onOpen }: HoverCardLayerProps) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const pendingAnchor = useRef<Element | null>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;

  useEffect(() => {
    if (speed === 'off') {
      setShown(null);
      return undefined;
    }
    const openDelay = HOVERCARD_OPEN_MS[speed];
    const clearOpen = () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current);
      openTimer.current = null;
      pendingAnchor.current = null;
    };
    const clearClose = () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    };
    const hide = () => {
      clearOpen();
      clearClose();
      setShown(null);
    };
    const scheduleClose = () => {
      clearClose();
      closeTimer.current = window.setTimeout(() => setShown(null), HOVERCARD_CLOSE_MS);
    };

    const enter = (element: Element, buttons: number) => {
      if (cardRef.current?.contains(element)) {
        clearClose();
        return;
      }
      const found = hoverTargetOf(element);
      if (!found || buttons !== 0) {
        clearOpen();
        if (shownRef.current) scheduleClose();
        return;
      }
      if (shownRef.current?.anchor === found.anchor) {
        clearClose();
        return;
      }
      if (pendingAnchor.current === found.anchor) return;
      clearOpen();
      pendingAnchor.current = found.anchor;
      // Loading starts with the wait, so the card usually opens already filled.
      const loading = loadHovercard(found.target);
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        if (!found.anchor.isConnected) return;
        clearClose();
        setShown({ anchor: found.anchor, target: found.target, data: null });
        void loading.then((data) => {
          setShown((current) => {
            if (current?.anchor !== found.anchor) return current;
            // Nothing could be read for this item, so there is no card to show.
            return data ? { ...current, data } : null;
          });
        });
      }, openDelay);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      // Some environments send pointer events without the buttons field; no field means no button is down.
      enter(event.target as Element, typeof event.buttons === 'number' ? event.buttons : 0);
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) enter(event.target, 0);
    };
    const onBlur = () => {
      clearOpen();
      if (shownRef.current) scheduleClose();
    };
    // A press inside the card (its title opens the item) keeps it until the click lands.
    const onPress = (event: PointerEvent) => {
      if (cardRef.current?.contains(event.target as Node)) return;
      hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && shownRef.current) hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('dragstart', hide, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      clearOpen();
      clearClose();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('dragstart', hide, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [speed]);

  // Below the link when there is room, above it otherwise, and always inside the window.
  useLayoutEffect(() => {
    if (!shown || !cardRef.current) {
      setPosition(null);
      return;
    }
    const rect = shown.anchor.getBoundingClientRect();
    const height = cardRef.current.offsetHeight;
    const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const roomBelow = window.innerHeight - rect.bottom - GAP - 8;
    const above = roomBelow < height && rect.top - GAP - 8 > roomBelow;
    const top = above
      ? Math.max(8, rect.top - GAP - height)
      : Math.min(rect.bottom + GAP, window.innerHeight - height - 8);
    setPosition({ left, top, above });
  }, [shown]);

  // While its card is open, the link is described by it.
  useEffect(() => {
    if (!shown) return undefined;
    const anchor = shown.anchor;
    anchor.setAttribute('aria-describedby', 'orbit-hovercard');
    return () => anchor.removeAttribute('aria-describedby');
  }, [shown]);

  if (!shown) return null;
  const style: CSSProperties = position
    ? { left: position.left, top: position.top }
    : { left: -9999, top: -9999, visibility: 'hidden' };

  return createPortal(
    <div
      ref={cardRef}
      id="orbit-hovercard"
      role="dialog"
      aria-label={
        shown.data
          ? `${shown.data.kind === 'pull' ? 'Pull request' : 'Issue'} #${shown.data.number}`
          : 'Loading'
      }
      className={`hovercard ${position?.above ? 'above' : 'below'}`}
      style={style}
      onPointerEnter={() => {
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }}
      onPointerLeave={() => {
        closeTimer.current = window.setTimeout(() => setShown(null), HOVERCARD_CLOSE_MS);
      }}
    >
      {shown.data ? (
        <CardBody
          data={shown.data}
          onOpen={
            onOpen
              ? () => {
                  const data = shown.data as HoverCardData;
                  setShown(null);
                  onOpen(data.repoFullName, data.number, data.kind);
                }
              : undefined
          }
        />
      ) : (
        <CardLoading target={shown.target} />
      )}
    </div>,
    document.body
  );
}

const STATE_TEXT: Record<HoverState, string> = {
  open: 'Open',
  closed: 'Closed',
  completed: 'Closed',
  'not-planned': 'Not planned',
  merged: 'Merged',
  draft: 'Draft'
};

function stateIcon(data: Pick<HoverCardData, 'kind' | 'state'>): Parameters<typeof Icon>[0]['name'] {
  if (data.kind === 'pull') return data.state === 'merged' ? 'merge' : 'pull';
  if (data.state === 'completed') return 'check';
  if (data.state === 'not-planned') return 'close';
  return 'issue';
}

function CardBody({ data, onOpen }: { data: HoverCardData; onOpen?: () => void }) {
  const projects = data.projects.filter((project) => project.fields.length > 0);
  return (
    <>
      <div className="hovercard-meta">
        <span className={`hovercard-state-icon ${data.kind} ${data.state}`} aria-hidden="true">
          <Icon name={stateIcon(data)} size={14} />
        </span>
        <span className="hovercard-repo">{data.repoFullName}</span>
        <span className="hovercard-dot" aria-hidden="true">
          ·
        </span>
        <span>{relativeTime(data.updatedAt)}</span>
      </div>
      {onOpen ? (
        <button type="button" className="hovercard-title" onClick={onOpen} title="Open in Orbit">
          {data.title} <span className="hovercard-number">#{data.number}</span>
        </button>
      ) : (
        <p className="hovercard-title">
          {data.title} <span className="hovercard-number">#{data.number}</span>
        </p>
      )}

      <div className="hovercard-status">
        <span className={`hovercard-pill ${data.kind} ${data.state}`}>
          <Icon name={stateIcon(data)} size={12} />
          {STATE_TEXT[data.state]}
        </span>
        {data.checks && <ChecksBadge checks={data.checks} />}
        {data.review && <ReviewBadge review={data.review} />}
        {data.subIssues && <SubIssueProgress {...data.subIssues} />}
        {data.commentCount > 0 && (
          <span className="hovercard-quiet">
            <Icon name="comment" size={12} />
            {data.commentCount}
          </span>
        )}
      </div>

      {data.branches && (
        <p className="hovercard-branches">
          <code>{data.branches.head}</code>
          <Icon name="chevronRight" size={11} />
          <code>{data.branches.base}</code>
        </p>
      )}

      {data.excerpt ? (
        <p className="hovercard-excerpt">{data.excerpt}</p>
      ) : (
        <p className="hovercard-excerpt empty">No description.</p>
      )}

      {data.labels.length > 0 && (
        <div className="hovercard-labels issue-labels">
          {data.labels.slice(0, 6).map((label) => (
            <IssueLabelChip key={label.name} label={label} />
          ))}
          {data.labels.length > 6 && <span className="hovercard-quiet">+{data.labels.length - 6}</span>}
        </div>
      )}

      {projects.length > 0 && (
        <div className="hovercard-projects">
          {projects.slice(0, 2).map((project) => (
            <div key={project.title} className="hovercard-project">
              <span className="hovercard-project-name">
                <Icon name="projects" size={12} />
                {project.title}
              </span>
              <dl className="hovercard-fields">
                {project.fields.slice(0, 6).map(({ field, value }) => (
                  <div key={field.id}>
                    <dt>{field.name}</dt>
                    <dd>
                      {value.kind === 'date' ? (
                        shortDate(value.date)
                      ) : (
                        <ProjectValueLabel field={field} value={value} />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
      <p className="hovercard-author">
        <span>Opened by @{data.authorLogin}</span>
        {data.assignees.length > 0 && (
          <span className="hovercard-assignees" title={data.assignees.map((login) => `@${login}`).join(', ')}>
            <Icon name="user" size={12} />
            {data.assignees.length <= 2
              ? data.assignees.map((login) => `@${login}`).join(', ')
              : `@${data.assignees[0]} and ${data.assignees.length - 1} more`}
          </span>
        )}
      </p>
    </>
  );
}

function ChecksBadge({ checks }: { checks: NonNullable<HoverCardData['checks']> }) {
  const tone = checks.failed > 0 ? 'failed' : checks.pending > 0 ? 'pending' : 'passed';
  const text =
    tone === 'failed'
      ? `${checks.failed} failing`
      : tone === 'pending'
        ? `${checks.pending} running`
        : 'Checks passed';
  return (
    <span
      className={`hovercard-checks ${tone}`}
      title={`${checks.passed} passed, ${checks.failed} failed, ${checks.pending} pending`}
    >
      <Icon name={tone === 'failed' ? 'close' : tone === 'pending' ? 'refresh' : 'check'} size={12} />
      {text}
      <span className="hovercard-quiet">
        {checks.passed}/{checks.total}
      </span>
    </span>
  );
}

const REVIEW_TEXT: Record<ReviewSummary['state'], string> = {
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  commented: 'Reviewed',
  none: 'No reviews yet'
};

function ReviewBadge({ review }: { review: ReviewSummary }) {
  const count =
    review.state === 'approved' && review.approvals > 1
      ? ` (${review.approvals})`
      : review.state === 'changes-requested' && review.changesRequested > 1
        ? ` (${review.changesRequested})`
        : '';
  return (
    <span
      className={`hovercard-review ${review.state}`}
      title={
        review.reviewers.length
          ? `Reviewed by ${review.reviewers.map((login) => `@${login}`).join(', ')}`
          : undefined
      }
    >
      <Icon
        name={
          review.state === 'approved' ? 'check' : review.state === 'changes-requested' ? 'alert' : 'comment'
        }
        size={12}
      />
      {REVIEW_TEXT[review.state]}
      {count}
    </span>
  );
}

function SubIssueProgress({ total, completed }: { total: number; completed: number }) {
  const share = total === 0 ? 0 : completed / total;
  return (
    <span className="hovercard-subissues" title={`${completed} of ${total} sub-issues closed`}>
      <span
        className="hovercard-ring"
        style={{ '--share': `${share * 360}deg` } as CSSProperties}
        aria-hidden="true"
      />
      {completed}/{total} sub-issues
    </span>
  );
}

function CardLoading({ target }: { target: HoverTarget }) {
  return (
    <div className="hovercard-loading" aria-busy="true">
      <div className="hovercard-meta">
        <span className="hovercard-repo">
          {target.repoFullName} #{target.number}
        </span>
      </div>
      <span className="hovercard-skeleton wide" />
      <span className="hovercard-skeleton" />
      <span className="hovercard-skeleton short" />
    </div>
  );
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: day.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric',
    timeZone: 'UTC'
  });
}

/** For example "Updated 3 days ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Updated ${days} ${days === 1 ? 'day' : 'days'} ago`;
  return `Updated ${new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
