import { sendPortal } from './net.js';
import { GAMES } from '../shared/config.js';

// ---------------------------------------------------------------------------
// Unified driving input
//
// One shared object fed by BOTH the keyboard and the on-screen touch controls,
// so the physics loop (PlayerCar) reads a single source. Axes are analog
// (-1..1): the keyboard drives them to the extremes, the mobile joystick fills
// in everything between for smooth steering and throttle.
// ---------------------------------------------------------------------------

export const input = {
  steer: 0, // +1 left, -1 right
  throttle: 0, // +1 forward, -1 reverse/brake
  boost: false,
  drift: false,
};

const kb = { up: false, down: false, left: false, right: false };

function syncAxes() {
  input.steer = (kb.left ? 1 : 0) - (kb.right ? 1 : 0);
  input.throttle = (kb.up ? 1 : 0) - (kb.down ? 1 : 0);
}

const MOVE = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

// quick travel: 1-4 jump into a minigame, 0 returns to the hub
const TRAVEL = { Digit1: GAMES[0], Digit2: GAMES[1], Digit3: GAMES[2], Digit4: GAMES[3], Digit0: 'hub' };

let installed = false;

/** Wire up keyboard driving once. Safe to call repeatedly. */
export function installKeyboard() {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  const down = (e) => {
    const m = MOVE[e.code];
    if (m) {
      kb[m] = true;
      syncAxes();
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.boost = true;
    if (e.code === 'Space') { input.drift = true; e.preventDefault(); }
    if (TRAVEL[e.code]) sendPortal(TRAVEL[e.code]);
  };
  const up = (e) => {
    const m = MOVE[e.code];
    if (m) { kb[m] = false; syncAxes(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.boost = false;
    if (e.code === 'Space') input.drift = false;
  };

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    installed = false;
  };
}
