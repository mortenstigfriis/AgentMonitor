import { useCallback, useEffect, useRef, useState } from 'react';
import {
  missionControlApi,
  type MissionAgent,
  type MissionEvent,
  type MissionSnapshot,
  type MissionStatus,
} from '../api/missionControl';

const ROLE_ORDER = ['planner', 'orchestrator', 'developer', 'tester', 'reviewer'];

function StatusLight({ status }: { status: MissionStatus }) {
  return <span className={`mc-status-light mc-status-${status}`} aria-label={status} />;
}

function shortId(value: string | null | undefined, length = 9) {
  return value ? value.slice(0, length) : '—';
}

function AgentNode({ agent }: { agent: MissionAgent }) {
  return (
    <article className={`mc-agent mc-agent-${agent.status}`}>
      <header>
        <StatusLight status={agent.status} />
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.role.toUpperCase()}</span>
        </div>
      </header>
      <p>{agent.task_title || 'Afventer næste opgave'}</p>
      <footer>
        <code>{shortId(agent.task_id, 18)}</code>
        <span>{agent.status}</span>
      </footer>
      {!agent.process_liveness_verified && (
        <small title="Status kommer fra persisteret workflow-state">STATE · IKKE PID-VERIFICERET</small>
      )}
    </article>
  );
}

function EventLine({ event }: { event: MissionEvent }) {
  const time = new Date(event.created_at).toLocaleTimeString('da-DK', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return (
    <li>
      <time>{time}</time>
      <span className="mc-event-kind">{event.kind}</span>
      <span>{event.task_id ? shortId(event.task_id, 30) : 'system'}</span>
      {Object.keys(event.details).length > 0 && <code>{JSON.stringify(event.details)}</code>}
    </li>
  );
}

export function MissionControl() {
  const [snapshot, setSnapshot] = useState<MissionSnapshot | null>(null);
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const cursor = useRef(0);

  const refreshSnapshot = useCallback(async () => {
    try {
      const next = await missionControlApi.snapshot();
      setSnapshot(next);
      setLastSync(new Date());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mission Control er utilgængelig');
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      const next = await missionControlApi.events(cursor.current);
      cursor.current = next.next_after;
      if (next.events.length) {
        setEvents((current) => [...current, ...next.events].slice(-100));
      }
    } catch {
      // Snapshot polling owns the visible connection error.
    }
  }, []);

  useEffect(() => {
    refreshSnapshot();
    refreshEvents();
    const snapshotTimer = window.setInterval(refreshSnapshot, 5_000);
    const eventTimer = window.setInterval(refreshEvents, 2_000);
    return () => {
      window.clearInterval(snapshotTimer);
      window.clearInterval(eventTimer);
    };
  }, [refreshEvents, refreshSnapshot]);

  const agents = [...(snapshot?.agents || [])].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );
  const approved = snapshot?.plan?.progress.by_status.approved || 0;
  const total = snapshot?.plan?.progress.total || 0;
  const progress = total ? Math.round((approved / total) * 100) : 0;
  const readyApprovals = snapshot?.approval_queue.filter((item) => item.ready) || [];

  return (
    <div className="mc-shell">
      <header className="mc-hero">
        <div>
          <span className="mc-kicker">TALIFLY · AUTONOMOUS ENGINEERING</span>
          <h1>MISSION CONTROL</h1>
          <p>{snapshot?.plan?.path || 'Forbinder til Orchestrator…'}</p>
        </div>
        <div className={`mc-connection ${error ? 'is-error' : ''}`}>
          <StatusLight status={error ? 'failed' : 'working'} />
          <span>{error || `LIVE · ${lastSync?.toLocaleTimeString('da-DK') || 'SYNC'}`}</span>
        </div>
      </header>

      <section className="mc-stats" aria-label="Gameplan status">
        <article><span>FREMSKRIDT</span><strong>{progress}%</strong></article>
        <article><span>OPGAVER</span><strong>{approved}/{total}</strong></article>
        <article><span>KLAR TIL GODKENDELSE</span><strong>{readyApprovals.length}</strong></article>
        <article><span>PLAN SHA</span><strong className="mc-code">{shortId(snapshot?.plan?.planning_sha)}</strong></article>
      </section>

      <section className="mc-panel mc-topology">
        <div className="mc-section-title">
          <div><span>01</span><h2>Agent topology</h2></div>
          <small>Autoritativ workflow-state</small>
        </div>
        <div className="mc-agent-flow">
          {agents.map((agent, index) => (
            <div className="mc-agent-step" key={agent.role}>
              <AgentNode agent={agent} />
              {index < agents.length - 1 && <span className="mc-flow-line" aria-hidden="true">›</span>}
            </div>
          ))}
        </div>
      </section>

      <div className="mc-columns">
        <section className="mc-panel">
          <div className="mc-section-title">
            <div><span>02</span><h2>Task pipeline</h2></div>
            <small>{snapshot?.plan?.status || 'offline'}</small>
          </div>
          <div className="mc-progress"><i style={{ width: `${progress}%` }} /></div>
          <ol className="mc-task-list">
            {(snapshot?.tasks || []).map((task) => (
              <li key={task.id} className={`mc-task mc-task-${task.display_status}`}>
                <span className="mc-task-number">{String(task.ordinal).padStart(2, '0')}</span>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.phase} · {task.risk} risk</span>
                </div>
                <span className="mc-task-status"><StatusLight status={task.display_status} />{task.status}</span>
              </li>
            ))}
          </ol>
        </section>

        <aside className="mc-side-stack">
          <section className="mc-panel">
            <div className="mc-section-title">
              <div><span>03</span><h2>Approval queue</h2></div>
              <small>Read-only V1</small>
            </div>
            {readyApprovals.length === 0 ? (
              <p className="mc-empty">Ingen beslutninger venter lige nu.</p>
            ) : readyApprovals.map((item) => (
              <article className="mc-approval" key={item.task_id}>
                <span>{item.risk.toUpperCase()}</span>
                <strong>{item.title}</strong>
                <code>{shortId(item.task_id, 30)}</code>
              </article>
            ))}
          </section>

          <section className="mc-panel mc-events">
            <div className="mc-section-title">
              <div><span>04</span><h2>Live events</h2></div>
              <small>{events.length} buffered</small>
            </div>
            <ul>{events.slice().reverse().map((event) => <EventLine event={event} key={event.id} />)}</ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
