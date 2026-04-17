export const ProgressStates = {
  QUEUED: 'queued',
  DELIVERED: 'delivered',
  STARTED: 'started',
  SUBMITTED: 'submitted',
  COMPLETED: 'completed',
  OVERDUE: 'overdue',
} as const;

export type ProgressState = (typeof ProgressStates)[keyof typeof ProgressStates];

const allowed: Record<ProgressState, ProgressState[]> = {
  queued: ['delivered'],
  delivered: ['started', 'overdue'],
  started: ['submitted', 'overdue'],
  submitted: ['completed'],
  completed: [],
  overdue: ['started', 'submitted', 'completed'],
};

const legacyMap: Record<string, ProgressState> = {
  not_started: 'queued',
  in_progress: 'started',
  queued: 'queued',
  delivered: 'delivered',
  started: 'started',
  submitted: 'submitted',
  completed: 'completed',
  overdue: 'overdue',
};

export class LearnerProgressStateMachine {
  readonly states = ProgressStates;

  normalizeState(state: unknown): ProgressState {
    const raw = String(state || '').trim().toLowerCase();
    if (!raw) return ProgressStates.QUEUED;
    return legacyMap[raw] || ProgressStates.QUEUED;
  }

  canTransition(fromState: unknown, toState: unknown): boolean {
    const from = this.normalizeState(fromState);
    const to = this.normalizeState(toState);
    return (allowed[from] || []).includes(to);
  }

  transition(
    record: Record<string, unknown>,
    toState: ProgressState,
    meta: Record<string, unknown> = {}
  ):
    | { ok: true; code: 'TRANSITION_OK'; record: Record<string, unknown>; meta: Record<string, unknown> }
    | { ok: false; code: 'INVALID_TRANSITION'; message: string; record: Record<string, unknown>; meta: Record<string, unknown> } {
    const source = record || {};
    const fromState = this.normalizeState(source.state);
    const normalizedTo = this.normalizeState(toState);
    if (!this.canTransition(fromState, normalizedTo)) {
      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `${fromState} -> ${normalizedTo} not allowed.`,
        record: source,
        meta,
      };
    }

    const now = new Date().toISOString();
    const next: Record<string, unknown> = { ...source, state: normalizedTo, updatedAt: now };
    this.stampTransitionTimestamps(next, normalizedTo, now);
    return { ok: true, code: 'TRANSITION_OK', record: next, meta };
  }

  private stampTransitionTimestamps(next: Record<string, unknown>, state: ProgressState, at: string) {
    if (state === 'delivered' && !next.deliveredAt) next.deliveredAt = at;
    if (state === 'started' && !next.startedAt) next.startedAt = at;
    if (state === 'submitted' && !next.submittedAt) next.submittedAt = at;
    if (state === 'completed' && !next.completedAt) next.completedAt = at;
  }
}
