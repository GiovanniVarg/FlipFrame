import {useId, useRef, useState} from 'react';
import './LandingDemo.css';

const ORIGINAL = '/demo/coastal-drift-original.mp4';
const EDITED = '/demo/coastal-drift-muted-2-4s.mp4';

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

type LandingDemoProps = {
  originalUrl?: string;
  editedUrl?: string;
  duration?: number;
  title?: string;
  description?: string;
  badge?: string;
  note?: string;
  kicker?: string;
  editedLabel?: string;
};

export function LandingDemo({ originalUrl = ORIGINAL, editedUrl = EDITED, duration = 8, title = 'Hear one precise change.', description = 'The same synthetic practice clip, shown before and after a 2–4 second audio mute. Same picture, audio edit only.', badge = 'No AI generation', note = 'Local edit · original preserved · no generation charge', kicker = 'Local editing example', editedLabel = 'audio muted 02.0–04.0' }: LandingDemoProps) {
  const original = useRef<HTMLVideoElement>(null);
  const edited = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [listenTo, setListenTo] = useState<'original' | 'edited'>('edited');
  const [error, setError] = useState('');
  const id = useId();

  function syncPosition() {
    const source=original.current,result=edited.current;
    setPosition(source?.currentTime ?? 0);
    if(source&&result&&!source.paused&&result.readyState>=2&&Math.abs(result.currentTime-source.currentTime)>.15)result.currentTime=source.currentTime;
  }

  async function togglePlayback() {
    const source = original.current;
    const result = edited.current;
    if (!source || !result) return;
    if (source.paused) {
      if(source.ended||result.ended||source.currentTime>=duration-.1)source.currentTime=0;
      result.currentTime = source.currentTime;
      source.volume = listenTo === 'original' ? 1 : 0;
      result.volume = listenTo === 'edited' ? 1 : 0;
      setError('');
      try {
        await Promise.all([source.play(), result.play()]);
        setPlaying(true);
      } catch {
        source.pause();
        result.pause();
        setPlaying(false);
        setError('Playback could not start. Try playback again.');
      }
    } else {
      source.pause();
      result.pause();
      setPlaying(false);
    }
  }

  function seek(value: number) {
    setPosition(value);
    if (original.current) original.current.currentTime = value;
    if (edited.current) edited.current.currentTime = value;
  }

  function selectAudio(value: 'original' | 'edited') {
    setListenTo(value);
    if (original.current) original.current.volume = value === 'original' ? 1 : 0;
    if (edited.current) edited.current.volume = value === 'edited' ? 1 : 0;
  }

  return (
    <section className="landing-demo" aria-labelledby={`${id}-title`}>
      <div className="landing-demo__intro">
        <div>
          <p className="landing-demo__kicker">{kicker}</p>
          <h2 id={`${id}-title`}>{title}</h2>
          <p className="landing-demo__lede">{description}</p>
        </div>
        <span className="landing-demo__truth">{badge}</span>
      </div>

      <div className="landing-demo__cards">
        <article className="landing-demo__card">
          <div className="landing-demo__label"><span>01</span><strong>Original</strong><small>source clip</small></div>
          <video ref={original} controls={false} preload="metadata" onTimeUpdate={syncPosition} onEnded={() => { edited.current?.pause(); setPlaying(false); setPosition(duration); }} aria-label={`Original preview: ${title}`} muted={listenTo!=='original'} playsInline>
            <source src={originalUrl} type="video/mp4" />
          </video>
        </article>
        <article className="landing-demo__card landing-demo__card--edited">
          <div className="landing-demo__label"><span>02</span><strong>Edited</strong><small>{editedLabel}</small></div>
          <video ref={edited} controls={false} preload="metadata" onEnded={() => { original.current?.pause(); setPlaying(false); setPosition(duration); }} aria-label={`Edited preview: ${title}`} muted={listenTo!=='edited'} playsInline>
            <source src={editedUrl} type="video/mp4" />
          </video>
        </article>
      </div>

      <div className="landing-demo__transport">
        <button type="button" onClick={() => void togglePlayback()} aria-label={playing ? 'Pause both previews' : 'Play both previews'}>
          {playing ? 'Pause preview' : 'Play preview'}
        </button>
        <div className="landing-demo__listen" role="group" aria-label="Choose which audio to hear">
          <span>Listen to</span>
          <button type="button" className={listenTo === 'original' ? 'is-active' : ''} aria-pressed={listenTo === 'original'} onClick={() => selectAudio('original')}>Original</button>
          <button type="button" className={listenTo === 'edited' ? 'is-active' : ''} aria-pressed={listenTo === 'edited'} onClick={() => selectAudio('edited')}>Edited</button>
        </div>
        <label htmlFor={`${id}-seek`}>Shared position <span>{formatTime(position)} / {formatTime(duration)}</span></label>
        <input id={`${id}-seek`} type="range" min="0" max={duration} step="0.1" value={position} onChange={(event) => seek(Number(event.target.value))} aria-label="Seek both previews" />
      </div>
      {error && <p className="landing-demo__error" role="alert">{error}</p>}
      <p className="landing-demo__note"><span aria-hidden="true">●</span> {note}</p>
    </section>
  );
}
