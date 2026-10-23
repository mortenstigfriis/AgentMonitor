const BASE = '/api/mission-control';

export type MissionStatus = 'working' | 'idle' | 'waiting' | 'blocked' | 'failed' | 'completed';

export interface MissionAgent {
  name: string;
  role: string;
  status: MissionStatus;
  task_id: string | null;
  task_title: string | null;
  last_activity: string | null;
  source: 'persisted_run' | 'task_state';
  process_liveness_verified: boolean;
}

export interface MissionTask {
  id: string;
  ordinal: number;
  phase: string;
  title: string;
  status: string;
  display_status: MissionStatus;
  risk: 'low' | 'medium' | 'high';
  requires_human: boolean;
  approval_valid: boolean;
  dependencies_ready: boolean;
  depends_on: string[];
  attempts: number;
  commit: string | null;
  has_block_reason: boolean;
  updated_at: string;
}

export interface MissionSnapshot {
  api_version: string;
  generated_at: string;
  plan: null | {
    id: string;
    path: string;
    status: string;
    summary: string;
    planning_sha: string;
    updated_at: string;
    progress: { total: number; by_status: Record<string, number> };
  };
  tasks: MissionTask[];
  agents: MissionAgent[];
  approval_queue: Array<{
    task_id: string;
    title: string;
    risk: string;
    status: string;
    ready: boolean;
  }>;
}

export interface MissionEvent {
  id: number;
  task_id: string | null;
  kind: string;
  details: Record<string, string | number | boolean | null>;
  created_at: string;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Authentication required');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}

export const missionControlApi = {
  snapshot: () => get<MissionSnapshot>('/snapshot'),
  events: (after: number) => get<{ events: MissionEvent[]; next_after: number }>(
    `/events?after=${after}&limit=100`,
  ),
};
