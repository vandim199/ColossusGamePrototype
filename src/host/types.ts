import type { Difficulty } from '../bots';
import type { GameState, HunterClass } from '../engine';

export type ControllerKind = 'local' | 'bot' | 'remote';
export type TimerSetting = 0 | 60 | 90;

export interface SeatInfo {
  seat: number;
  role: 'colossus' | HunterClass;
  /** Who is driving the seat right now. A dropped human's seat is driven by a bot until they reclaim it. */
  controller: ControllerKind;
  name: string;
  difficulty: Difficulty;
  /** A human left and a bot is covering for them. */
  dropped: boolean;
}

/** Everything one client is allowed to see. Built by the host for exactly one seat. */
export interface ClientView {
  you: number | 'spectator';
  state: GameState;
  seats: SeatInfo[];
  /** Turn timer for the current step, if enabled. */
  timer: { remainingMs: number; totalMs: number } | null;
  /** Short host messages ("time ran out, a bot played for the Marksman"). */
  notices: string[];
}

export const roleName = (role: SeatInfo['role']) =>
  role === 'colossus' ? 'Colossus' : { slasher: 'Quick Slasher', marksman: 'Range Marksman', vanguard: 'Heavy Vanguard', bard: 'The Bard' }[role];
