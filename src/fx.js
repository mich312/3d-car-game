// Lightweight FX bus: gameplay code (physics, network handlers) pushes visual
// events here without touching React; CrashFX.jsx drains the queue in its
// render loop, and PlayerCar applies `shake` to the chase camera.

export const fxQueue = [];

// kind: 'sparks' (also used for dust puffs via gravity/drag/grow) or 'ring'
export function burstFX(x, y, z, opts = {}) {
  fxQueue.push({ x, y, z, ...opts });
  if (fxQueue.length > 64) fxQueue.shift();
}

// Trauma-style screen shake: impacts add trauma, amplitude follows trauma².
export const shake = { trauma: 0 };

export function addShake(amount) {
  shake.trauma = Math.min(1, shake.trauma + amount);
}
