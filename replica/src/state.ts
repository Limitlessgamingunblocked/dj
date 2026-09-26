import type { Goal, User } from './api';

const GOAL_KEY = 'replica.goal';

/** App-wide state. The goal is kept locally until there is an account to store it on. */
export const state = {
  user: null as User | null,
  pendingGoal: readGoal(),
};

function readGoal(): Goal | null {
  try {
    const v = localStorage.getItem(GOAL_KEY);
    return v === 'sell' || v === 'fun' ? v : null;
  } catch {
    return null;
  }
}

export function rememberGoal(goal: Goal) {
  state.pendingGoal = goal;
  try {
    localStorage.setItem(GOAL_KEY, goal);
  } catch {
    /* private mode: the choice still lives in memory */
  }
}

export function currentGoal(): Goal {
  return state.user?.goal ?? state.pendingGoal ?? 'fun';
}
