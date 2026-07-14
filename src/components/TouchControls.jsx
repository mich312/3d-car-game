import React, { useEffect, useRef, useState } from 'react';
import { input } from '../input.js';

// Show the on-screen pad on anything that reports touch. Some devices only
// admit it after the first touch, so we also flip on the first touchstart.
function detectTouch() {
  if (typeof window === 'undefined') return false;
  return (
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  );
}

const DEADZONE = 0.16;

// Left thumb stick — analog steer (x) + throttle (y). Writes straight into the
// shared input axes so it drives exactly like the keyboard.
function Joystick() {
  const base = useRef(null);
  const knob = useRef(null);
  const pointerId = useRef(null);

  useEffect(() => {
    const el = base.current;
    if (!el) return;

    const setKnob = (dx, dy) => {
      if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const reset = () => {
      input.steer = 0;
      input.throttle = 0;
      setKnob(0, 0);
    };
    const move = (e) => {
      if (pointerId.current === null || e.pointerId !== pointerId.current) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const max = r.width / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy) || 1;
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      setKnob(dx, dy);
      const nx = dx / max;
      const ny = dy / max;
      input.steer = Math.abs(nx) > DEADZONE ? -nx : 0; // push left -> steer left
      input.throttle = Math.abs(ny) > DEADZONE ? -ny : 0; // push up -> forward
    };
    const start = (e) => {
      if (pointerId.current !== null) return;
      pointerId.current = e.pointerId;
      el.setPointerCapture(e.pointerId);
      move(e);
      e.preventDefault();
    };
    const end = (e) => {
      if (e.pointerId !== pointerId.current) return;
      pointerId.current = null;
      reset();
    };

    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    return () => {
      el.removeEventListener('pointerdown', start);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      reset();
    };
  }, []);

  return (
    <div ref={base} className="tc-stick">
      <div ref={knob} className="tc-knob" />
    </div>
  );
}

// A hold-to-activate action button bound to an input flag.
function HoldButton({ flag, className, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (e) => {
      input[flag] = true;
      el.classList.add('tc-active');
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const off = () => {
      input[flag] = false;
      el.classList.remove('tc-active');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
    return () => {
      el.removeEventListener('pointerdown', on);
      el.removeEventListener('pointerup', off);
      el.removeEventListener('pointercancel', off);
      el.removeEventListener('pointerleave', off);
      input[flag] = false;
    };
  }, [flag]);
  return (
    <div ref={ref} className={`tc-btn ${className}`}>
      {children}
    </div>
  );
}

export default function TouchControls() {
  const [show, setShow] = useState(detectTouch);
  useEffect(() => {
    if (show) return;
    const onTouch = () => setShow(true);
    window.addEventListener('touchstart', onTouch, { once: true });
    return () => window.removeEventListener('touchstart', onTouch);
  }, [show]);

  if (!show) return null;
  return (
    <div className="touch-controls">
      <Joystick />
      <div className="tc-actions">
        <HoldButton flag="drift" className="tc-drift">
          DRIFT
        </HoldButton>
        <HoldButton flag="boost" className="tc-boost">
          NITRO
        </HoldButton>
      </div>
    </div>
  );
}
