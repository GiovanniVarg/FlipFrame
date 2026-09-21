import {TypedReply} from './TypedReply';
import {LOCAL_TOOLS} from '../local-tools.mjs';
import {selectionIntent} from '../selection-intent.mjs';
import {editImpact,generationButton,editScope,reservationLabel} from '../edit-impact.mjs';
import {BatchVariations} from './BatchVariations';
import {BrandPresets} from './BrandPresets';
import {jobGuidance} from '../job-guidance.mjs';
import {FirstEditGuide} from './FirstEditGuide';
import {EDITOR_WORKFLOWS,type WorkflowAction} from '../editor-workflows.mjs';
import {CandidateQuality,type CandidateEvidence} from './CandidateQuality';
import {useEffect, useRef, useState} from 'react';
import './ConversationPanel.css';
import {ImportGuidance} from './ImportGuidance';

type Quality = 'standard' | 'draft';
type EditIntent = string | WorkflowAction | 'mute' | 'gain' | 'replace_audio' | 'replace_picture' | 'picture' | 'object' | 'generate_audio';
const intentLabels: Record<EditIntent, string> = {
  ...Object.fromEntries(Object.entries(LOCAL_TOOLS).map(([id,t])=>[id,t.title])),
  ...Object.fromEntries(Object.entries({...EDITOR_WORKFLOWS,...LOCAL_TOOLS}).map(([key,w])=>[key,w.title])) as Record<WorkflowAction,string>,
  picture: 'Picture edit', object: 'Object edit', generate_audio: 'Generate sound', mute: 'Mute sound',
  gain: 'Adjust volume', replace_audio: 'Use an audio file', replace_picture: 'Use a video file',
};
type SendOverride = {referenceImageId?:string; text: string; intent: EditIntent; start: number; end: number; baseRevisionId: string; quality?: Quality};

export type ConversationPlan = {
 selectedObjectName?:string;tool?:string;requiresMask?:boolean;requiresReference?:boolean;changesTimeline?:boolean;
  targetCandidateId?:string; targetCandidateLabel?:string; suggestions?:EditIntent[];
  referenceImage?:{id:string,url:string,name:string};
  id: string;
  status: 'ready' | 'needs_input' | 'executing' | 'completed' | 'failed';
  action: string;
  title: string;
  explanation: string;
  start: number;
  end: number;
  baseRevisionId: string;
  quality?: Quality;
  processStart?: number; processEnd?: number; inputDuration?: number; requestText?: string;
  route: {id: string; label: string; kind: 'local' | 'higgsfield' | 'ui'; resolution?: string; estimatedUsd?: number; costLabel?: string};
  warnings: string[];
  jobId?: string;
  candidateId?: string;
  uiAction?: string;
};
type Message = {referenceImage?:{id:string,url:string,name:string}; id: string; role: 'user' | 'assistant'; text: string; createdAt: string; planId?: string; intent?: EditIntent; quality?: Quality};
type Conversation = {messages: Message[]; plans: ConversationPlan[]; router: {configured: boolean}};
type Candidate = CandidateEvidence & {maskReviewUrl?:string; id: string; url: string; label?: string; note?: string; start?: number; end?: number};
type Job = {billing?:string;type?:string;recoveryMode?:string;recoverable?:boolean; id: string; status: string; phase?: string; error?: string; result?: Candidate; baseRevisionId?: string};
type Props = {
  savedDraft:{text:string,quality:Quality,referenceImageId?:string};onDraftChange:(draft:((previous:{text:string,quality:Quality,referenceImageId?:string})=>{text:string,quality:Quality,referenceImageId?:string}))=>void;draftLoading:boolean;draftStatus:string;
  focusPlanId?: string; refreshVersion?: number;
  project: {id: string; name: string; activeRevisionId: string; duration: number} | null;
  start: number;
  end: number;
  busy: boolean;
  statusMessage: string;
  error: string;
  candidate: Candidate | null;
  jobs: Job[];
  maskReady: boolean;
  maskCount:number;objectName:string;
  objectIssue: (start:number,end:number)=>string;
  hasReplacementAudio: boolean;
  hasReplacementVideo: boolean;
  onImport: () => void;
  onGenerate: () => void;
  onExample: () => void;
  onOpenEditor: (section?: string, plan?: ConversationPlan) => void;
  onRetry: (job:Job)=>Promise<void>;
  retryingJobId:string;
  onExecute: (plan: ConversationPlan) => Promise<void>;
  onReview: (candidate: Candidate) => void;
  onApply: () => Promise<void>;
  onInspectWarning:(time:number)=>void;
  onDiscard: () => void;
  repairPending:boolean;
  onResumeRepair:()=>void;
  onOpenAlternatives:()=>void;
  onCorrect: (candidate:Candidate) => void;
  onDismissError: () => void;
};

const formatTime = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toFixed(2).padStart(5, '0')}`;

async function requestConversation(url: string, body?: unknown, signal?: AbortSignal): Promise<Conversation> {
  const response = await fetch(url, body === undefined ? {signal} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal,
  });
  const data = await response.json();
  if (response.status === 401) { window.location.reload(); throw new Error('Your session expired. Please sign in again.'); }
  if (!response.ok) throw new Error(data.error || data.message || 'The conversation could not be loaded.');
  return data;
}

export function ConversationPanel({savedDraft,onDraftChange,draftLoading,draftStatus,focusPlanId,refreshVersion,project, start, end, busy, statusMessage, error, candidate, jobs, maskReady, maskCount, objectName, objectIssue, hasReplacementAudio, hasReplacementVideo,
  onImport, onGenerate, onExample, onOpenEditor, onExecute, onRetry, retryingJobId, onReview, onApply, onInspectWarning, onDiscard, onCorrect, onOpenAlternatives, repairPending, onResumeRepair, onDismissError}: Props) {
  const [toolsOpen,setToolsOpen]=useState(false),[toolTab,setToolTab]=useState('styles');
  const toolsDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(toolsOpen)toolsDialog.current?.showModal();else toolsDialog.current?.close()},[toolsOpen]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const draft=savedDraft.text,quality=savedDraft.quality;
  const [animatedReply,setAnimatedReply]=useState('');
  const setDraft=(text:string)=>onDraftChange(previous=>({...previous,text}));
  const setQuality=(quality:Quality)=>onDraftChange(previous=>({...previous,quality}));
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState('');
  const [pendingIntent, setPendingIntent] = useState<EditIntent | undefined>();
  const [executing, setExecuting] = useState('');
  const [conversationError, setConversationError] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const referenceInput=useRef<HTMLInputElement>(null);
  const [uploadingReference,setUploadingReference]=useState(false);
  useEffect(()=>setUploadingReference(false),[project?.id]);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const projectId = useRef(project?.id);
  const requests = useRef(0);
  const sendLock = useRef(false);
  const executeLock = useRef(false);
  const retryRequest = useRef<{signature: string; key: string} | null>(null);
  projectId.current = project?.id;

  useEffect(() => {
    setConversation(null); setConversationError(''); setPendingText(''); setPendingIntent(undefined);
    setSending(false); setExecuting(''); retryRequest.current = null;
    sendLock.current = false; executeLock.current = false;
  }, [project?.id]);

  useEffect(() => {
    if (!project) { setLoading(false); return; }
    const abort = new AbortController();
    const id = project.id;
    const sequence = ++requests.current;
    setLoading(true);
    requestConversation(`/api/projects/${id}/conversation`, undefined, abort.signal)
      .then(data => { if (projectId.current === id && sequence === requests.current) { setConversation(data); setConversationError(''); } })
      .catch(reason => { if (!abort.signal.aborted && projectId.current === id) setConversationError((reason as Error).message); })
      .finally(() => { if (!abort.signal.aborted && projectId.current === id) setLoading(false); });
    return () => abort.abort();
  }, [project?.id, project?.activeRevisionId, retryVersion, candidate?.id, refreshVersion]);

  const focusedPlan=useRef('');
  useEffect(()=>{const key=focusPlanId+':'+refreshVersion;if(!focusPlanId||focusedPlan.current===key||!conversation?.plans.some(p=>p.id===focusPlanId))return;const target=document.getElementById('plan-'+focusPlanId);if(target){focusedPlan.current=key;target.scrollIntoView({block:'center'});target.focus({preventScroll:true});}},[conversation,focusPlanId,refreshVersion]);

  useEffect(() => {
    if (!project || !busy) return;
    const id = project.id;
    const timer = window.setInterval(() => {
      if (sendLock.current || executeLock.current) return;
      const sequence = ++requests.current;
      void requestConversation(`/api/projects/${id}/conversation`).then(data => {
        if (projectId.current === id && sequence === requests.current) setConversation(data);
      }).catch(() => { /* The active job reports its own request failures. */ });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [project?.id, busy]);

  useEffect(() => {
    const area = scrollArea.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [conversation?.messages.length, pendingText, candidate?.id]);

  async function attachReference(file:File){
    if(!project||uploadingReference)return;const id=project.id;
    if(file.size>10*1024*1024){setConversationError('Reference images must be 10 MB or smaller.');return;}
    setUploadingReference(true);setConversationError('');
    try{const body=new FormData();body.append('file',file);const response=await fetch(`/api/projects/${id}/reference-image`,{method:'POST',body});const data=await response.json();if(!response.ok)throw Error(data.error||'Image upload failed');if(projectId.current===id)onDraftChange(previous=>({...previous,referenceImageId:data.id}));}
    catch(error){if(projectId.current===id)setConversationError((error as Error).message);}
    finally{if(projectId.current===id)setUploadingReference(false);}
  }
  async function send(override?: SendOverride) {
    const text = (override?.text ?? draft).trim();
    if (!project || uploadingReference || draftLoading || !text || busy || sendLock.current || executeLock.current || loading) return;
    if (override && override.baseRevisionId !== project.activeRevisionId) {
      setConversationError('This request belongs to an earlier revision. Describe your edit again for the current video.');
      return;
    }
    const id = project.id;
    const input = {text, baseRevisionId: project.activeRevisionId, start: override?.start ?? start,
      end: override?.end ?? end, quality: override?.quality ?? quality, referenceImageId:override?override.referenceImageId:savedDraft.referenceImageId, intent: override?.intent ?? selectionIntent(text,maskReady),reviewCandidateId:candidate?.id,selectionContext:{hasMask:maskCount>0,reviewed:maskReady,maskCount,objectName}};
    const signature = JSON.stringify(input);
    if (retryRequest.current?.signature !== signature) retryRequest.current = {signature, key: crypto.randomUUID()};
    sendLock.current = true; setSending(true); setPendingText(text); setPendingIntent(input.intent); setConversationError('');
    const sequence = ++requests.current;
    try {
      const data = await requestConversation(`/api/projects/${id}/conversation`, {...input, idempotencyKey: retryRequest.current.key});
      if (projectId.current !== id) return;
      if (sequence === requests.current) {setConversation(data);setAnimatedReply(data.messages.filter(m=>m.role==='assistant').at(-1)?.id||'');}
      if (!override) onDraftChange(previous=>({...previous,text:'',referenceImageId:''}));
      retryRequest.current = null;
    } catch (reason) {
      if (projectId.current === id) setConversationError((reason as Error).message);
    } finally {
      if (projectId.current === id) { sendLock.current = false; setSending(false); setPendingText(''); setPendingIntent(undefined); composer.current?.focus(); }
    }
  }

  async function execute(plan: ConversationPlan) {
    if (!project || uploadingReference || executeLock.current || sendLock.current || busy) return;
    const id = project.id;
    executeLock.current = true; setExecuting(plan.id); setConversationError(''); ++requests.current;
    try {
      await onExecute(plan);
      if (projectId.current === id) setRetryVersion(value => value + 1);
    } catch (reason) {
      if (projectId.current === id) setConversationError((reason as Error).message);
    } finally {
      if (projectId.current === id) { executeLock.current = false; setExecuting(''); }
    }
  }

  function suggest(text: string) { setDraft(text); composer.current?.focus(); }

  function originalMessageForPlan(plan: ConversationPlan) {
    const messages = conversation?.messages ?? [];
    const replyIndex = messages.findIndex(message => message.planId === plan.id);
    for (let index = replyIndex - 1; index >= 0; index--) {
      if (messages[index].role === 'user') return messages[index];
    }
    return undefined;
  }

  function renderPlan(plan: ConversationPlan) {
    const impact=plan.tool&&LOCAL_TOOLS[plan.tool]?{changes:LOCAL_TOOLS[plan.tool].criterion,preserves:LOCAL_TOOLS[plan.tool].preserves,review:'Review the preview before applying. Jev chooses a tool; the renderer enforces its permitted changes.'}:plan.route.id==='precision-recolor'?{changes:'Matching paint colors inside the reviewed mask only. No cleanup expansion.',preserves:'Original spatial positions, neutral and dark details, and decoded pixels outside the allowed color mask. Audio stream is copied.',review:'Check the tracked selection and final color. Similar-colored details inside your mask can change.'}:editImpact(plan.action);
    const stale = project?.activeRevisionId !== plan.baseRevisionId;
    const clarifying = plan.action === 'clarify' && plan.status === 'needs_input';
    const originalMessage = clarifying ? originalMessageForPlan(plan) : undefined;
    const choiceDisabled = stale || busy || sending || !!executing || loading;
    function chooseIntent(intent: EditIntent) {
      if (!originalMessage || choiceDisabled) return;
      void send({text: originalMessage.text, intent, start: plan.start, end: plan.end,
        baseRevisionId: plan.baseRevisionId, referenceImageId:originalMessage.referenceImage?.id, quality: originalMessage.quality ?? plan.quality ?? quality});
    }
    const job = jobs.find(item => item.id === plan.jobId);
    const objectPlan = !!plan.requiresMask||/object|mask/.test(plan.action);
    const selectionIssue = objectPlan && !job && ['ready','needs_input'].includes(plan.status) ? (plan.selectedObjectName&&plan.selectedObjectName!==objectName?'This card targets another object. Send a new request for the active selection.':objectIssue(plan.start,plan.end)) : "";
    const inputReady = (objectPlan && !selectionIssue && (plan.route.estimatedUsd ?? 0) <= 5) || (plan.action === 'replace_audio' && hasReplacementAudio) || (plan.action === 'replace_picture' && hasReplacementVideo);
    const canRun = (!objectPlan || !selectionIssue) && (plan.status === 'ready' || (plan.status === 'needs_input' && inputReady));
    const cost = job?.billing==='Provider confirmed no charge; budget reservation released' ? 'No charge · reservation released' : plan.route.costLabel || (plan.route.estimatedUsd !== undefined ? `Est. $${plan.route.estimatedUsd.toFixed(2)}` : plan.route.kind === 'local' || plan.route.kind === 'ui' ? 'No generation cost' : 'Quote checked before generation');
    const status = job?.status || plan.status;
    return <article id={'plan-'+plan.id} tabIndex={-1} className={`conversation-plan plan-${status}`} key={plan.id} aria-label={plan.title}>
      <div className="plan-heading"><span className="eyebrow">{plan.route.kind === 'ui' ? 'Workspace action' : 'Proposed edit'}</span><span className="plan-state">{selectionIssue ? 'Selection needed' : status === 'needs_input' ? (canRun?'Ready to preview':'One more step') : status === 'ready' ? 'Ready to preview' : status==='completed'&&plan.route.kind==='ui'?'Tool opened':status.replaceAll('_', ' ')}</span></div>
      <h3>{plan.title}</h3>{plan.targetCandidateLabel&&<p>Target: {plan.targetCandidateLabel}</p>}
      {selectionIssue && <p className="plan-next-step"><strong>Next: finish selecting the object.</strong><br/>{selectionIssue}</p>}
      {!stale && objectPlan && ['needs_input','ready'].includes(plan.status) && !!selectionIssue && <button className="plan-run" disabled={busy} onClick={() => onOpenEditor('object', {...plan,requestText:originalMessageForPlan(plan)?.text})}>Finish selecting the object <span aria-hidden="true">→</span></button>}
      <div className="plan-compact-facts"><span>{plan.selectedObjectName|| (objectPlan?objectName:'Selected footage')}</span><span className="mono">{formatTime(plan.start)} – {formatTime(plan.end)}</span><strong>{cost}</strong></div>
      {plan.route.kind==='higgsfield'&&<p className="plan-compact-note">{reservationLabel(plan,job)}</p>}
      <details className="plan-details"><summary>Model, scope & details</summary><p>{plan.explanation}</p><p>{plan.route.label} {plan.route.resolution||''}</p>{plan.processStart!==undefined&&<p>Source context: {formatTime(plan.processStart)} – {formatTime(plan.processEnd??plan.end)}</p>}{impact&&<><p><strong>Changes:</strong> {impact.changes}</p><p><strong>Keeps:</strong> {impact.preserves}</p><p>{impact.review}</p></>}{plan.warnings?.map((warning,index)=><p key={index}>{warning}</p>)}</details>
      {job?.phase && <p className="plan-job-status" role="status">{job.phase}</p>}
      {job?.error && <p className="error">{job.error}</p>}
      {job?.recoverable && !stale && <><button className="primary plan-run" disabled={busy||sending||!!executing||!!retryingJobId} onClick={()=>void onRetry(job)}>{retryingJobId===job.id?'Checking…':jobGuidance(job).action}<span aria-hidden="true">→</span></button><p className="help">{jobGuidance(job).detail}</p></>}
      {job?.status==='failed'&&!job.recoverable&&<p className="help">This failure cannot be safely retried. Correct the request and review a new plan.</p>}
      {stale && canRun ? <p className="plan-note">This plan belongs to an earlier revision. Describe the edit again for the current video.</p> : canRun ? <button className="primary plan-run" disabled={busy || !!executing || sending} onClick={() => void execute(plan)}>{executing === plan.id ? 'Starting…' : plan.route.kind === 'ui' ? 'Yes, open this step' : plan.action === 'apply' ? 'Apply candidate' : plan.action === 'undo' ? 'Undo last revision' : generationButton(plan)}<span aria-hidden="true">→</span></button> : null}
      {!stale&&plan.status==='ready'&&<button className="plan-run" disabled={busy||sending} onClick={()=>{setDraft(originalMessageForPlan(plan)?.text||'');document.getElementById('conversation-input')?.focus()}}>Not what I meant · change request</button>}
      {job?.status === 'completed' && job.result?.id && job.result?.url && !stale && <button className="plan-run" disabled={busy} onClick={() => onReview(job.result!)}>Review candidate <span aria-hidden="true">→</span></button>}
      {!stale && plan.action === 'replace_audio' && !hasReplacementAudio && <button className="plan-run" disabled={busy} onClick={() => onOpenEditor('audio', {...plan,requestText:originalMessageForPlan(plan)?.text})}>Choose replacement audio <span aria-hidden="true">→</span></button>}
      {!stale && plan.action === 'replace_picture' && !hasReplacementVideo && <button className="plan-run" disabled={busy} onClick={() => onOpenEditor('picture', {...plan,requestText:originalMessageForPlan(plan)?.text})}>Choose replacement video <span aria-hidden="true">→</span></button>}
      {clarifying && originalMessage && !stale && <fieldset className="clarification-choices" disabled={choiceDisabled}>
        <legend>Choose what you want to edit</legend>
        <p>Keep your request and this range. Review a new plan before anything runs.</p>
        {plan.suggestions?.length? <div className="clarification-primary" aria-label="Suggested actions">{plan.suggestions.map(intent=><button key={intent} type="button" onClick={()=>chooseIntent(intent)}>{intentLabels[intent]}</button>)}</div>:null}
        <div className="clarification-primary">
          <button type="button" onClick={() => chooseIntent('picture')}>Picture <span aria-hidden="true">↗</span></button>
          <button type="button" onClick={() => chooseIntent('object')}>Object <span aria-hidden="true">↗</span></button>
          <button type="button" onClick={() => chooseIntent('generate_audio')}>Generate sound <span aria-hidden="true">↗</span></button>
        </div>
        <details className="clarification-more"><summary>Volume or replacement files</summary><div>
          {(['mute', 'gain', 'replace_audio', 'replace_picture'] as EditIntent[]).map(intent => <button type="button" key={intent} onClick={() => chooseIntent(intent)}>{intentLabels[intent]}<span aria-hidden="true">↗</span></button>)}
        </div></details>
        <details className="clarification-more"><summary>Selection, correction and review</summary><div>{Object.entries({...EDITOR_WORKFLOWS,...LOCAL_TOOLS}).map(([key,w])=><button type="button" key={key} onClick={()=>chooseIntent(key as WorkflowAction)}>{w.title}</button>)}</div></details>
      </fieldset>}
      {clarifying && stale && <p className="plan-note">This request belongs to an earlier revision. Describe your edit again for the current video.</p>}
      {plan.status === 'needs_input' && !objectPlan && !['replace_audio', 'replace_picture'].includes(plan.action) && (!clarifying || !originalMessage) && <p className="plan-note">Add the requested detail in the conversation below.</p>}
      {plan.status === 'failed' && !job?.error && <p className="plan-note">This request did not finish. Describe the next step below or check Activity.</p>}
    </article>;
  }

  const messages=conversation?.messages??[];
  const latestUser=messages.reduce((last,item,index)=>item.role==='user'?index:last,-1);
  const focusedReview=!!candidate||repairPending;
  const earlier=focusedReview?messages:messages.slice(0,Math.max(0,latestUser));
  const current=focusedReview?[]:messages.slice(Math.max(0,latestUser));
  const shownPlanIds = new Set(conversation?.messages.map(item => item.planId).filter(Boolean));
  const activeJob = jobs.find(job => ['queued', 'running'].includes(job.status));
  return <aside className="conversation-panel" aria-label="Project conversation">
    <div className="conversation-heading"><div><span className="eyebrow">Your workspace</span><h1>What should change?</h1></div><button className="conversation-library" onClick={() => onOpenEditor('Media')} aria-label="Open project library" title="Project library"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 7h7l2-3h9v15H3Z"/></svg></button></div>
    <div className="conversation-scroll" ref={scrollArea}>
      {!focusedReview&&!busy&&messages.length===0&&<FirstEditGuide project={!!project} selected={maskReady} candidate={!!candidate} busy={busy||draftLoading||sending} onImport={onImport} onExample={onExample} onGenerate={onGenerate} onSelect={()=>onOpenEditor('object')} onDescribe={()=>composer.current?.focus()} onReview={()=>candidate&&onReview(candidate)}/>}

      {!project ? <div className="conversation-intro"><span className="conversation-glyph" aria-hidden="true">↗</span><h2>Start with a video.<br/>Tell us what to change.</h2><p>A quieter soundtrack. A different background. One detail that needs another take.</p><p>Describe the result you want, review the proposed edit, then compare it with your original.</p><button className="primary" disabled={busy} onClick={onImport}>Import your video <span aria-hidden="true">↗</span></button><button className="wide" disabled={busy} onClick={onExample}>Try a sample · no generation cost</button><ImportGuidance/><div className="conversation-start-foot">Already started? <button onClick={() => onOpenEditor('Media')}>Open a project</button></div></div> : <>
        {loading && !conversation ? <div className="conversation-skeleton" role="status" aria-label="Loading saved conversation"><span/><span/><span/></div> : conversation?.messages.length === 0 ? <div className="conversation-intro has-project"><span className="eyebrow">Ready when you are</span><h2>What would you like<br/>to change?</h2><p>Use your own words. Include a moment or time range when you have one in mind.</p><div className="conversation-suggestions"><button onClick={() => suggest('Mute the selected range')}>Mute the selected range <span>↗</span></button><button onClick={() => suggest('Change the background from ')}>Change a background <span>↗</span></button><button onClick={() => suggest('Help me edit an object in this video')}>Edit one object <span>↗</span></button></div></div> : null}
        <div className="conversation-messages" role="log" aria-label="Saved messages" aria-live="polite" aria-relevant="additions">
          {earlier.length>0 && <details className="conversation-history"><summary>History · {earlier.filter(item=>item.role==='user').length} earlier requests</summary>{earlier.map(item=><div className={`conversation-message message-${item.role}`} key={item.id}><div className="message-author">{item.role==='user'?'You':'Studio'}</div><p>{item.text}</p></div>)}<button onClick={()=>onOpenEditor('Activity')}>Find earlier results</button></details>}
          {current.map(item => <div className={`conversation-message message-${item.role}`} key={item.id}><div className="message-author">{item.role === 'user' ? 'You' : 'Studio'}{item.role === 'user' && item.intent && intentLabels[item.intent] && <span className="message-intent">{intentLabels[item.intent]}</span>}</div>{item.role==='assistant'?<TypedReply animate={animatedReply===item.id} text={conversation?.plans.some(plan=>plan.id===item.planId&&plan.action==='object')?(maskReady?`Ready to edit ${objectName} in your selected range.`:'Select and review the object to continue.'):item.text}/>:<p>{item.text}</p>}{item.referenceImage&&<img className="reference-thumbnail" src={item.referenceImage.url} alt={`Reference: ${item.referenceImage.name}`}/>} {item.planId && conversation?.plans.find(plan => plan.id === item.planId) ? renderPlan(conversation?.plans.find(plan => plan.id === item.planId)!) : null}</div>)}
          {!focusedReview&&conversation?.plans.filter(plan => !shownPlanIds.has(plan.id)).map(renderPlan)}
          {pendingText && <div className="conversation-message message-user pending-message"><div className="message-author">You <span>· sending</span>{pendingIntent && <span className="message-intent">{intentLabels[pendingIntent]}</span>}</div><p>{pendingText}</p></div>}
          {sending && <div className="conversation-thinking" role="status"><span/><span/><span/><span className="sr-only">Preparing a response</span></div>}
        </div>
      </>}
      {busy && <div className="conversation-progress" role="status"><span className="progress-line"/><strong>{activeJob?jobGuidance(activeJob).title:'Work in progress'}</strong><p>{activeJob?.phase || 'Preparing your request…'}</p>{activeJob&&<p className="help">{jobGuidance(activeJob).detail}</p>}<button onClick={() => onOpenEditor('Activity')}>View activity <span aria-hidden="true">↗</span></button></div>}
      {!busy && statusMessage && <p className="conversation-status" role="status">{statusMessage}</p>}
      {repairPending&&!busy&&<article className="conversation-candidate"><h3>Finish correcting your candidate</h3><p>Your saved generation is ready to reuse. Adjust the outline or protected areas, review the range, then rebuild locally.</p><button onClick={onResumeRepair}>Continue local correction</button></article>}
      {candidate && <article className="conversation-candidate"><span className="eyebrow">{candidate.repairVerification?.qualityDiagnostics?.flaggedFrames?'Review warnings before applying':'Ready to compare'}</span><h3>{candidate.label || 'Your candidate is ready.'}</h3><p>Use A / B in the preview. Apply it when you are happy with the result.</p>{candidate.start !== undefined && candidate.end !== undefined && <p className="mono candidate-range">{formatTime(candidate.start)} – {formatTime(candidate.end)}</p>}<CandidateQuality candidate={candidate} onSeek={onInspectWarning}/>{candidate.maskReviewUrl&&<a href={candidate.maskReviewUrl} target="_blank" rel="noreferrer">Review automatic coverage (green)</a>}<button className="candidate-review" disabled={busy} onClick={() => onReview(candidate)}>Review in preview <span aria-hidden="true">↗</span></button>{candidate.maskReviewUrl&&!candidate.transformationVerification&&<button disabled={busy} onClick={()=>onCorrect(candidate)}>Fix outline · no generation charge</button>}<div className="candidate-decision"><button className="primary" disabled={busy} onClick={() => void onApply()}>Apply candidate</button><button disabled={busy} onClick={onDiscard}>Discard</button></div></article>}
      {(conversationError || error) && <div className="conversation-error" role="alert"><p>{conversationError || error}</p><div>{conversationError && !sending && !loading && <button onClick={() => setRetryVersion(value => value + 1)}>Reload conversation</button>}<button onClick={() => { setConversationError(''); onDismissError(); }}>Dismiss</button></div></div>}
    </div>
    <div className="conversation-compose-area">
      {project && <div className="conversation-context"><span><span className="context-dot"/> {maskReady ? `${objectName} ready · ${maskCount} borders` : maskCount?`${objectName} · ${maskCount} borders · needs review`:'Editing this range'}<strong className="mono">{formatTime(start)} – {formatTime(end)}</strong></span><button onClick={() => onOpenEditor(maskCount ? 'object' : 'Edit')}>Adjust</button></div>}
      <div className="conversation-tools-row"><button type="button" aria-haspopup="dialog" onClick={()=>setToolsOpen(true)}>Tools & styles</button><button type="button" disabled={!project||busy||draftLoading} onClick={onOpenAlternatives}>Saved results</button></div>
      <dialog ref={toolsDialog} className="conversation-tools-dialog" aria-labelledby="conversation-tools-title" onCancel={e=>{e.preventDefault();setToolsOpen(false)}}><header><div><h2 id="conversation-tools-title">Creative tools</h2><p>Choose a tool. Your conversation stays where you left it.</p></div><button type="button" onClick={()=>setToolsOpen(false)} aria-label="Close creative tools">Close</button></header><nav aria-label="Creative tool categories">{[['styles','Brand styles'],['batch','Variations'],['commands','Command guide']].map(([id,label])=><button key={id} type="button" aria-pressed={toolTab===id} onClick={()=>setToolTab(id)}>{label}</button>)}</nav>
      <div hidden={toolTab!=='styles'}>      {project&&<BrandPresets key={project.id} projectId={project.id} referenceImageId={savedDraft.referenceImageId} disabled={busy||sending||draftLoading||uploadingReference} onUse={preset=>{const text=[savedDraft.text,`Style instructions (${preset.name}): ${preset.instructions}`].filter(Boolean).join('\n\n');if(text.length>3000){setConversationError('Your message plus this preset exceeds 3000 characters. Shorten the message first.');return;}onDraftChange(previous=>({...previous,text,referenceImageId:preset.referenceImageId||previous.referenceImageId}));setToolsOpen(false);composer.current?.focus()}}/>}
{!project&&<p>Open a video project to manage brand styles.</p>}</div>
      <div hidden={toolTab!=='batch'}>      {project&&<BatchVariations key={project.id} projectId={project.id} revision={project.activeRevisionId} start={start} end={end} quality={quality} referenceImageId={savedDraft.referenceImageId} disabled={busy||sending||draftLoading||uploadingReference} onResults={()=>{setToolsOpen(false);onOpenAlternatives()}}/>}
{!project&&<p>Open a video project to prepare variations.</p>}</div>
      <div hidden={toolTab!=='commands'}>      <section className="conversation-command-menu"><h3>What can I ask?</h3><p>Choose a starting phrase, then send it to review a confirmation card.</p><div>{Object.entries({...EDITOR_WORKFLOWS,...LOCAL_TOOLS}).map(([key,w])=><button type="button" key={key} disabled={busy||sending} onClick={()=>{setDraft(w.command);setToolsOpen(false);document.getElementById('conversation-input')?.focus()}}>{w.title}</button>)}</div></section>
</div></dialog>
      <form className="conversation-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <input ref={referenceInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void attachReference(file)}}/>
        {savedDraft.referenceImageId&&<div className="reference-attachment"><img src={`/media/${savedDraft.referenceImageId}.png`} alt="Attached reference"/><span>Reference image<small>Sent with the reviewed visual edit</small></span><button type="button" aria-label="Remove reference image" disabled={sending||uploadingReference} onClick={()=>onDraftChange(previous=>({...previous,referenceImageId:''}))}>Remove</button></div>}
        <label className="sr-only" htmlFor="conversation-input">Describe your next edit</label>
        <textarea ref={composer} id="conversation-input" rows={3} maxLength={3000} value={draft} disabled={!project || draftLoading || sending} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={project ? 'Describe your next edit…' : 'Import a video to start a conversation…'}/>
        <div className="composer-actions"><button type="button" disabled={!project||draftLoading||busy||sending||uploadingReference} onClick={()=>referenceInput.current?.click()}>{uploadingReference?'Uploading…':'Attach image'}</button><button type="button" className="composer-import" onClick={onImport} disabled={busy} aria-label="Import video" title="Import video"><span aria-hidden="true">+</span></button><label className="sr-only" htmlFor="conversation-quality">Generation quality preference</label><select id="conversation-quality" value={quality} onChange={event => setQuality(event.target.value as 'standard' | 'draft')} disabled={draftLoading || sending}><option value="standard">Standard · 720p</option><option value="draft">Draft · 480p preview</option></select><button type="submit" className="primary composer-send" disabled={!project || uploadingReference || draftLoading || !draft.trim() || busy || sending || loading || !!executing} aria-label="Send message"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div>
      </form>
      <p className="composer-footnote" role="status">{project&&draftStatus?draftStatus+' · ':''}{project ? quality === 'draft' ? 'Draft costs less, with softer detail. Review before running.' : conversation?.router.configured ? 'Review the plan before an edit runs.' : 'AI chat is off. Use a direct command, or choose an edit type when asked.' : 'Your original video is always preserved.'}</p>
    </div>
  </aside>;
}
