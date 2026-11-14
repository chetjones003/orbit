// THROWAWAY: three review layouts inside Orbit's approved shell, ?variant=A|B|C.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Diff, Hunk, Decoration, parseDiff, getChangeKey, tokenize } from 'react-diff-view';
import refractor from 'refractor/core.js';
import javascript from 'refractor/lang/javascript.js';
refractor.register(javascript);

const variants = { A: 'File navigator', B: 'Continuous diff', C: 'Thread queue' };
const patch = `diff --git a/src/navigation.js b/src/navigation.js
index 1234567..7654321 100644
--- a/src/navigation.js
+++ b/src/navigation.js
@@ -1,4 +1,5 @@
 export function chooseRoute(item) {
-  const route = '/issues/' + item.number;
+  const type = item.isPullRequest ? 'pulls' : 'issues';
+  const route = '/' + type + '/' + item.number;
   return route;
 }
`;
const removedPatch = `diff --git a/src/legacy.js b/src/legacy.js
deleted file mode 100644
index 1234567..0000000
--- a/src/legacy.js
+++ /dev/null
@@ -1,3 +0,0 @@
-export function oldRoute(number) {
-  return '/issues/' + number;
-}
`;
const data = [
  { id: 'navigation', name: 'navigation.js', path: 'src/navigation.js', kind: 'modified', diff: parseDiff(patch)[0], count: '+2 −1' },
  { id: 'rename', name: 'routes.js', path: 'src/routes.js', old: 'src/paths.js', kind: 'renamed', count: '100% same' },
  { id: 'delete', name: 'legacy.js', path: 'src/legacy.js', kind: 'deleted', diff: parseDiff(removedPatch)[0], count: '−3' },
  { id: 'binary', name: 'orbit.png', path: 'assets/orbit.png', kind: 'binary', count: 'Binary' },
  { id: 'large', name: 'generated.js', path: 'src/generated.js', kind: 'large', diff: parseDiff(patch)[0], count: '+2,400 −80' },
];
const initialThreads = [{ id: 'thread-1', file: 'navigation', key: 'I3', line: 3, side: 'RIGHT', commit: 'c0ffee1', author: 'sample-contributor', text: 'Can we preserve the selected item when this route changes?', resolved: false, replies: [] }];
function Logo() { return <svg className="logo" viewBox="0 0 40 40" fill="none" aria-label="Orbit"><path d="M23 4C12 2 3 12 5 23s14 17 24 12 12-17 5-24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><circle cx="31" cy="8" r="4" stroke="currentColor" strokeWidth="2.5"/><circle cx="10" cy="31" r="4" stroke="currentColor" strokeWidth="2.5"/><circle cx="20" cy="20" r="5" stroke="currentColor" strokeWidth="2.5"/></svg>; }

function App() {
  const params = new URLSearchParams(location.search);
  const [variant, setVariant] = useState(globalThis.REVIEW_VARIANT || (params.get('variant') in variants ? params.get('variant') : 'A'));
  const [expanded, setExpanded] = useState(globalThis.REVIEW_COMPACT !== true);
  const [theme, setTheme] = useState(globalThis.REVIEW_LIGHT ? 'light' : 'dark');
  const [split, setSplit] = useState(globalThis.REVIEW_SPLIT || false);
  const [fileId, setFileId] = useState('navigation');
  const [fileFilter, setFileFilter] = useState('');
  const [viewed, setViewed] = useState([]);
  const [threads, setThreads] = useState(initialThreads);
  const [drafts, setDrafts] = useState([]);
  const [composer, setComposer] = useState(null);
  const [text, setText] = useState('');
  const [replies, setReplies] = useState({});
  const [ownPR, setOwnPR] = useState(false);
  const [modal, setModal] = useState(null);
  const [summary, setSummary] = useState('');
  const [verdict, setVerdict] = useState('COMMENT');
  const [failNext, setFailNext] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [largeLoaded, setLargeLoaded] = useState(false);
  const [lastSubmission, setLastSubmission] = useState(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [failSave, setFailSave] = useState(false);
  const [remoteHead, setRemoteHead] = useState(globalThis.REVIEW_NEW_HEAD ? 'badd002' : 'c0ffee1');
  const [reviewedHead, setReviewedHead] = useState('c0ffee1');
  const [mustAcknowledge, setMustAcknowledge] = useState(false);
  const canSubmit = remoteHead === reviewedHead && !mustAcknowledge;
  const updatedPatch = patch.replace('@@ -1,4 +1,5 @@', '@@ -1,4 +1,6 @@').replace("+  const type =", "+  const prefix = '/';\n+  const type =").replace("+  const route = '/' + type", "+  const route = prefix + type");
  const files = data.map(f => f.id === 'navigation' && reviewedHead !== 'c0ffee1' ? { ...f, diff: parseDiff(updatedPatch)[0], count: '+3 −1' } : f);
  const file = files.find(f => f.id === fileId);
  const unresolved = threads.filter(t => !t.resolved).length;
  const list = files.filter(f => f.path.toLowerCase().includes(fileFilter.toLowerCase()));
  function cycle(value) { setVariant(value); try { const u = new URL(location.href); u.searchParams.set('variant', value); history.replaceState(null, '', u); } catch {} }
  useEffect(() => { function key(e) { if (e.target.closest('input,textarea,select,[contenteditable]')) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const ks = Object.keys(variants); cycle(ks[(ks.indexOf(variant) + (e.key === 'ArrowLeft' ? 2 : 1)) % 3]); } } addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, [variant]);
  function beginComment(f, change, side) {
    if (savingDraft) { setToast('Wait for the current draft save before adding another comment.'); return; }
    if (composer && text.trim()) { setToast('Finish or cancel your current line comment before opening another.'); return; }
    const anchorSide = change.type === 'delete' || side === 'old' ? 'LEFT' : 'RIGHT';
    setComposer({ file: f.id, key: getChangeKey(change), line: change.lineNumber || (anchorSide === 'LEFT' ? change.oldLineNumber : change.newLineNumber), side: anchorSide, commit: reviewedHead }); setText('');
  }
  function savePending(payload, clearEditor) {
    if (savingDraft) return;
    setSavingDraft(true);
    setTimeout(() => {
      setSavingDraft(false);
      if (failSave) { setFailSave(false); setToast('Sample save failed. Your text is still in the editor; it has not been added to the pending review.'); return; }
      setDrafts(ds => payload.id ? ds.map(d => d.id === payload.id ? payload : d) : [...ds, { ...payload, id: 'draft-' + Date.now() }]);
      clearEditor(); setToast('Saved to the sample pending review. Production Orbit will save this on GitHub; this demo stays in memory.');
    }, 400);
  }
  function addDraft() { if (!text.trim()) return; savePending({ ...composer, text }, () => { setComposer(null); setText(''); }); }
  function renderThread(t) {
    const replyText = replies[t.id] || '';
    return <div className={'thread ' + (t.resolved ? 'resolved' : '')} key={t.id}>
      <div className="thread-head"><span className="avatar">{t.author === 'chetjones003' ? 'CJ' : 'SC'}</span><strong>{t.author}</strong><button className="btn btn-xs btn-ghost" onClick={() => setThreads(ts => ts.map(x => x.id === t.id ? { ...x, resolved: !x.resolved } : x))}>{t.resolved ? 'Reopen thread' : 'Resolve thread'}</button></div>
      {t.commit !== reviewedHead && <span className="badge badge-outline">Outdated · {t.commit}:{t.line}</span>}<p>{t.text}</p>
      {t.replies.map((r, n) => <p className="reply" key={n}><strong>You:</strong> {r}</p>)}
      {!t.resolved && <><textarea className="textarea textarea-bordered" disabled={savingDraft} aria-label="Reply to review thread" placeholder="Reply to this thread…" value={replyText} onChange={e => setReplies(r => ({ ...r, [t.id]: e.target.value }))}/>
      <footer><button className="btn btn-xs btn-ghost" disabled={!replyText.trim() || savingDraft} onClick={() => { setThreads(ts => ts.map(x => x.id === t.id ? { ...x, replies: [...x.replies, replyText] } : x)); setReplies(r => ({ ...r, [t.id]: '' })); setToast('Sample reply sent immediately. Nothing was posted to GitHub.'); }}>Send now</button>
      <button className="btn btn-xs btn-primary" disabled={!replyText.trim() || savingDraft} onClick={() => savePending({ thread: t.id, file: t.file, key: t.key, line: t.line, side: t.side, commit: t.commit, text: replyText }, () => setReplies(r => ({ ...r, [t.id]: '' })))}>{savingDraft ? 'Saving…' : 'Add to review'}</button></footer></>}
    </div>;
  }
  function renderDraft(d) { return <div className="thread draft" key={d.id}><div className="thread-head"><strong>You</strong><span className="draft-label">Saved pending · sample</span><button className="btn btn-ghost btn-xs" onClick={() => { if (composer && text.trim()) { setToast('Finish your current line comment first.'); return; } setComposer(d); setText(d.text); }}>Edit</button><button className="btn btn-ghost btn-xs" onClick={() => setDrafts(ds => ds.filter(x => x.id !== d.id))}>Remove</button></div><p>{d.text}</p><small className="muted">{d.thread ? 'Reply · ' : ''}{d.commit !== reviewedHead ? 'Outdated · ' : ''}{d.commit} · {d.side === 'LEFT' ? 'Old' : 'New'} line {d.line}</small></div>; }
  function renderComposer(f, key) { return composer?.file === f.id && composer.key === key && <div className="thread draft"><div className="thread-head"><strong>{composer.id ? 'Edit pending comment' : 'Add line comment'}</strong><span className="muted">{composer.side} · line {composer.line}</span></div><textarea className="textarea textarea-bordered" disabled={savingDraft} aria-label="New line comment" placeholder="Write a review comment…" value={text} onChange={e => setText(e.target.value)}/><label className="flex gap-2 items-center" style={{fontSize:10,marginTop:8}}><input type="checkbox" className="checkbox checkbox-xs" checked={failSave} onChange={e => setFailSave(e.target.checked)}/>Simulate failed draft save</label><footer><button disabled={savingDraft} className="btn btn-xs btn-ghost" onClick={() => { if (text.trim()) setModal('cancel-comment'); else setComposer(null); }}>Cancel</button><button className="btn btn-xs btn-primary" disabled={!text.trim() || savingDraft} onClick={addDraft}>{savingDraft ? 'Saving…' : 'Add to review'}</button></footer></div>; }
  function renderDiff(f) {
    if (f.kind === 'renamed') return <div className="special"><h3>File renamed · contents unchanged</h3><p>{f.old} → {f.path}</p><span className="badge badge-outline">No changed lines to comment on</span></div>;
    if (f.kind === 'binary') return <div className="special"><Logo/><h3 style={{ marginTop: 15 }}>Binary file changed</h3><p>assets/orbit.png · Text diff unavailable. The app will not invent line anchors for this file.</p><button className="btn btn-xs" onClick={() => setToast('A real client would open this file’s GitHub page. Prototype stays offline.')}>View on GitHub ↗</button></div>;
    if (f.kind === 'large' && !largeLoaded) return <div className="special"><h3>Large diff · load on demand</h3><p>+2,400 −80 lines. Load this file when you’re ready. Incomplete server patches must remain labeled incomplete.</p><button className="btn btn-sm" onClick={() => setLargeLoaded(true)}>Load sample excerpt</button></div>;
    const hunks = f.diff.hunks;
    const outdatedThreads = threads.filter(t => t.file === f.id && t.commit !== reviewedHead);
    const outdatedDrafts = drafts.filter(d => d.file === f.id && d.commit !== reviewedHead);
    const widgets = {};
    for (const h of hunks) for (const c of h.changes) { const key = getChangeKey(c); const ts = threads.filter(t => t.file === f.id && t.key === key && t.commit === reviewedHead); const ds = drafts.filter(d => d.file === f.id && d.key === key && d.commit === reviewedHead); if (ts.length || ds.length || (composer?.file === f.id && composer.key === key)) widgets[key] = <>{ts.map(renderThread)}{ds.map(renderDraft)}{renderComposer(f, key)}</>; }
    return <>{f.kind === 'large' && <div className="narrow-hint">Representative excerpt only · the full file is not loaded in this demo.</div>}<div className="diff-scroll"><Diff viewType={expanded && split ? 'split' : 'unified'} diffType={f.diff.type} hunks={hunks} widgets={widgets} tokens={tokenize(hunks, { highlight: true, refractor, language: 'javascript' })} renderGutter={({ change, side, renderDefault }) => <button className="line-comment" aria-label={`Comment on ${side || (change.type === 'delete' ? 'old' : 'new')} line ${change.lineNumber || (side === 'old' ? change.oldLineNumber : change.newLineNumber)}`} title="Add a line comment" onClick={() => beginComment(f, change, side)}>{renderDefault()} +</button>}>{hs => hs.map(h => <React.Fragment key={h.content}><Decoration><span>{h.content}</span></Decoration><Hunk hunk={h}/></React.Fragment>)}</Diff></div>{(outdatedThreads.length > 0 || outdatedDrafts.length > 0) && <section className="older-comments"><h3>Comments on earlier commits</h3><p>Original anchors are preserved. These comments have not moved onto the new diff.</p>{outdatedThreads.map(renderThread)}{outdatedDrafts.map(renderDraft)}{composer?.file === f.id && composer.commit !== reviewedHead && renderComposer(f, composer.key)}</section>}</>;
  }
  function fileHeading(f) { return <div className="file-heading"><strong>{f.path}</strong><span className="count">{f.count}</span><label className="flex gap-1 items-center"><input aria-label={'Mark ' + f.path + ' viewed'} type="checkbox" className="checkbox checkbox-xs" checked={viewed.includes(f.id)} onChange={() => setViewed(v => v.includes(f.id) ? v.filter(x => x !== f.id) : [...v, f.id])}/>Viewed</label></div>; }
  function fileNav() { return <aside className="file-nav"><div className="eyebrow">Changed files · 5</div>{list.map(f => <button className={'file-button ' + (file.id === f.id ? 'active' : '')} key={f.id} onClick={() => setFileId(f.id)}>{viewed.includes(f.id) ? '✓' : f.kind === 'deleted' ? '−' : '◇'} {f.name}<small>{f.kind} · {f.count}</small></button>)}</aside>; }
  function VariantA() { return <div className="review-layout navigator">{fileNav()}<main className="file-diff">{fileHeading(file)}{renderDiff(file)}</main></div>; }
  function VariantB() { return <main className="review-layout continuous">{list.map(f => <section key={f.id} className="file-section" id={'file-' + f.id}>{fileHeading(f)}{renderDiff(f)}</section>)}</main>; }
  function VariantC() { return <div className="review-layout thread-first"><aside className="thread-queue"><h2>Review queue <span className="muted">{unresolved + drafts.length}</span></h2>{threads.map(t => <button className="queue-card" key={t.id} onClick={() => setFileId(t.file)}><span className={t.resolved ? 'text-success' : 'text-primary'}>{t.resolved ? '✓ Resolved' : '○ Open thread'}</span><div style={{ marginTop: 6 }}>{t.text}</div><small>{files.find(f => f.id === t.file).name}:{t.line}</small></button>)}{drafts.map(d => <button className="queue-card" key={d.id} onClick={() => setFileId(d.file)}><span className="draft-label">Pending comment</span><div style={{ marginTop: 6 }}>{d.text}</div><small>{files.find(f => f.id === d.file).name}:{d.line}</small></button>)}<div className="eyebrow">Browse files</div>{fileNav()}</aside><main className="file-diff">{fileHeading(file)}{renderDiff(file)}</main></div>; }
  function submitReview() {
    if (!canSubmit) { setToast('Refresh and acknowledge the new commits before submitting.'); return; }
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      if (failNext) { setFailNext(false); setToast('Sample submit failed. Pending comments and summary are still here; retry when ready.'); return; }
      setThreads(ts => [...ts.map(t => ({ ...t, replies: [...t.replies, ...drafts.filter(d => d.thread === t.id).map(d => d.text)] })), ...drafts.filter(d => !d.thread).map(d => ({ ...d, author: 'chetjones003', resolved: false, replies: [] }))]);
      setLastSubmission({ verdict: ownPR ? 'COMMENT' : verdict, count: drafts.length }); setDrafts([]); setSummary(''); setModal(null); setToast('Sample review submitted successfully. Nothing was sent to GitHub.');
    }, 550);
  }
  function reviewModal() { return <div className="review-modal-backdrop"><section className="review-modal" role="dialog" aria-modal="true" aria-label={modal === 'submit' ? 'Finish review' : 'Review confirmation'}>{modal === 'restart' ? <><h2>Simulate restarting Orbit?</h2><p>Saved pending comments and replies will be restored from the simulated GitHub draft. Unadded line text, unsent replies, and the unsaved summary will be lost. This demo uses memory only; refreshing the actual page clears it.</p><footer><button className="btn btn-sm" onClick={() => setModal(null)}>Keep editing</button><button className="btn btn-sm btn-primary" onClick={() => { setComposer(null); setText(''); setReplies({}); setSummary(''); setViewed([]); setModal(null); setToast('Simulated restart complete: saved pending review restored; unadded buffers cleared.'); }}>Restart sample session</button></footer></> : modal === 'submit' ? <><h2>Finish your review</h2><p>{drafts.length} pending comment/reply{drafts.length === 1 ? '' : 's'}. Review submission waits for GitHub confirmation.</p>{drafts.length > 0 && <div style={{ maxHeight: 120, overflow: 'auto', marginBottom: 12 }}>{drafts.map(d => <div key={d.id} style={{ fontSize: 10, marginBottom: 6 }}><strong>{files.find(f => f.id === d.file).name}:{d.line}</strong> · {d.text}</div>)}</div>}<textarea aria-label="Review summary" className="textarea textarea-bordered" placeholder="Summarize your review…" value={summary} onChange={e => setSummary(e.target.value)}/>{['COMMENT', ...(ownPR ? [] : ['APPROVE', 'REQUEST_CHANGES'])].map(v => <label key={v}><input className="radio radio-xs radio-primary" type="radio" name="verdict" checked={(ownPR ? 'COMMENT' : verdict) === v} onChange={() => setVerdict(v)}/><span>{v === 'COMMENT' ? 'Comment' : v === 'APPROVE' ? 'Approve' : 'Request changes'}</span></label>)}{ownPR && <p>You authored this PR. GitHub does not allow approving it or requesting changes.</p>}<label><input type="checkbox" className="checkbox checkbox-xs" checked={failNext} onChange={e => setFailNext(e.target.checked)}/>Simulate a failed submission</label><footer><button className="btn btn-sm" disabled={saving} onClick={() => setModal(null)}>Keep reviewing</button><button className="btn btn-sm btn-primary" disabled={saving || !canSubmit || ((ownPR || verdict === 'COMMENT') && !summary.trim() && !drafts.length) || (!ownPR && verdict === 'REQUEST_CHANGES' && !summary.trim())} onClick={submitReview}>{saving ? 'Submitting…' : 'Submit sample review'}</button></footer></> : <><h2>{modal === 'cancel-comment' ? 'Discard unsaved line text?' : 'Discard pending review?'}</h2><p>{modal === 'cancel-comment' ? 'This text has not been added to your pending review.' : `Remove ${drafts.length} pending comments and the review summary from this sample? Published threads stay unchanged.`}</p><footer><button className="btn btn-sm" onClick={() => setModal(null)}>Keep editing</button><button className="btn btn-sm btn-error" onClick={() => { if (modal === 'cancel-comment') { setComposer(null); setText(''); } else { setDrafts([]); setSummary(''); } setModal(null); }}>Discard</button></footer></>}</section></div>; }
  return <div className="prototype review" data-theme={'orbit-' + theme}><div className="guide"><strong>PR REVIEW STUDY · {variant} / {variants[variant]}</strong><span>Sample data · no GitHub writes</span><button className="btn btn-xs" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ Light' : '☾ Dark'}</button></div><div className="app"><div className="titlebar">◉ Orbit / Pull requests<span className="window">− □ ×</span></div><div className="review-rail"><nav className="rail"><Logo/><button title="Inbox">▣</button><button title="Issues">◉</button><button className="active" title="Pull requests">⑂</button><button title="Projects">▦</button><span className="avatar" style={{ marginTop: 'auto' }}>CJ</span></nav><main className="review-main"><header className="review-top"><div><div className="eyebrow">chetjones003 / orbit · #{35}</div><h1>Restore the right item when navigating</h1><span className="muted" style={{ fontSize: 10 }}>{ownPR ? 'chetjones003' : 'sample-contributor'} wants to merge 2 commits · 5 files</span></div><button className="btn btn-xs" onClick={() => setExpanded(e => !e)}>{expanded ? '↙ Panel' : '↗ Expand'}</button></header><div className={'review-frame ' + (!expanded ? 'compact' : '')}><aside className="review-context"><div className="eyebrow" style={{ marginTop: 0 }}>Pull requests</div><div className="issue-card selected"><strong>Restore the right item when navigating</strong><div className="row-meta">#35 · selected</div></div><div className="issue-card"><strong>Remember the selected theme</strong><div className="row-meta">#27 · sample context</div></div></aside><section className="review-surface"><div className="review-scenarios"><span>Reviewing <code>{reviewedHead}</code></span><button className="btn btn-xs" disabled={remoteHead !== 'c0ffee1' || saving || savingDraft} onClick={() => setRemoteHead('badd002')}>Simulate new commit</button><button className="btn btn-xs" disabled={saving || savingDraft} onClick={() => setModal('restart')}>Simulate restart</button></div>{!canSubmit && <div className="commit-warning"><strong>{remoteHead !== reviewedHead ? 'New commits arrived. Review submission is paused.' : 'Updated diff loaded. Check the changes before submitting.'}</strong><p>Your pending comments keep their original commit and line locations.</p><button className="btn btn-xs btn-primary" disabled={saving || savingDraft} onClick={() => { if (composer && text.trim()) { setToast('Add or cancel your unadded line text before loading a different diff.'); return; } if (remoteHead !== reviewedHead) { setReviewedHead(remoteHead); setMustAcknowledge(true); } else setMustAcknowledge(false); }}>{remoteHead !== reviewedHead ? 'Refresh diff' : 'I have checked these changes'}</button></div>}<div className="review-controls"><span style={{ fontSize: 11, fontWeight: 600 }}>Files changed <span className="muted">5</span></span><span className="badge badge-outline">{unresolved} open thread</span><div className="mode"><button className={'btn btn-xs ' + (!split ? 'btn-primary' : 'btn-ghost')} onClick={() => setSplit(false)}>Unified</button><button className={'btn btn-xs ' + (split ? 'btn-primary' : 'btn-ghost')} onClick={() => { setSplit(true); if (!expanded) setExpanded(true); }}>Split</button></div></div><div className="review-controls"><input aria-label="Filter changed files" className="input input-bordered" style={{ height: 27, minHeight: 27, fontSize: 10, width: 150 }} placeholder="Filter changed files…" value={fileFilter} onChange={e => setFileFilter(e.target.value)}/><select aria-label="Jump to changed file" value={fileId} onChange={e => { setFileId(e.target.value); if (variant === 'B') setTimeout(() => document.getElementById('file-' + e.target.value)?.scrollIntoView({ block: 'nearest' }), 0); }}>{files.map(f => <option key={f.id} value={f.id}>{f.path}</option>)}</select><label className="flex gap-1 items-center" style={{ fontSize: 10 }}><input type="checkbox" className="checkbox checkbox-xs" checked={ownPR} onChange={e => { setOwnPR(e.target.checked); setVerdict('COMMENT'); }}/>My own PR</label></div>{!expanded && <div className="narrow-hint">Compact panel uses unified diff. Split opens the expanded view.</div>}{variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()}<footer className="review-bottom"><span>{viewed.length}/5 viewed · {drafts.length} pending{lastSubmission && <span className="text-success"> · Review submitted</span>}</span><button className="btn btn-xs btn-ghost" disabled={!drafts.length && !summary} onClick={() => setModal('discard')}>Discard review</button><button className="btn btn-xs btn-primary" disabled={saving || savingDraft || !canSubmit} onClick={() => { if (composer && text.trim()) { setToast('Add or cancel your current line comment before finishing the review.'); return; } setModal('submit'); }}>Finish review{drafts.length ? ` (${drafts.length})` : ''}</button></footer></section></div></main></div>{modal && reviewModal()}{toast && <div role="status" className="review-toast"><button className="btn btn-xs btn-ghost" aria-label="Dismiss message" onClick={() => setToast('')}>✕</button>{toast}</div>}</div><div className="state-strip"><span>variant={variant}</span><span>mode={expanded ? split ? 'expanded/split' : 'expanded/unified' : 'panel/unified'}</span><span>file={fileId}</span><span>pending={drafts.length}</span><span>unsaved={Boolean(text.trim()).toString()}</span><span>ownPR={ownPR.toString()}</span><span>head={reviewedHead}/{remoteHead}</span><span>submit={canSubmit ? 'ready' : 'paused'}</span></div>{__ORBIT_PROTOTYPE__ && <div className="switcher"><button aria-label="Previous review layout" onClick={() => cycle(Object.keys(variants)[(Object.keys(variants).indexOf(variant) + 2) % 3])}>←</button><select aria-label="Review layout variant" value={variant} onChange={e => cycle(e.target.value)}>{Object.entries(variants).map(([k, label]) => <option key={k} value={k}>{k} · {label}</option>)}</select><button aria-label="Next review layout" onClick={() => cycle(Object.keys(variants)[(Object.keys(variants).indexOf(variant) + 1) % 3])}>→</button></div>}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
