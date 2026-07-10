import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fxQueue } from '../fx.js';

// Pooled impact particles (sparks, debris, landing dust) + expanding
// shockwave rings. One instanced mesh, zero allocation per frame.

const MAX_PARTICLES = 320;
const MAX_RINGS = 6;

export default function CrashFX() {
  const mesh = useRef();
  const ringMeshes = useRef([]);
  const cursor = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  const parts = useMemo(
    () =>
      Array.from({ length: MAX_PARTICLES }, () => ({
        life: 0,
        ttl: 1,
        px: 0, py: 0, pz: 0,
        vx: 0, vy: 0, vz: 0,
        size: 0.15,
        gravity: 26,
        drag: 0,
        grow: 0,
      })),
    []
  );
  const rings = useMemo(
    () => Array.from({ length: MAX_RINGS }, () => ({ life: 0, ttl: 0.5, size: 1 })),
    []
  );
  const ringCursor = useRef(0);

  useFrame((_, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.1);

    // --- drain the event queue ---
    let colorTouched = false;
    while (fxQueue.length) {
      const e = fxQueue.pop();
      if (e.kind === 'ring') {
        const r = rings[ringCursor.current];
        ringCursor.current = (ringCursor.current + 1) % MAX_RINGS;
        r.life = r.ttl = e.ttl || 0.45;
        r.size = e.size || 1.4;
        const rm = ringMeshes.current[rings.indexOf(r)];
        if (rm) {
          rm.position.set(e.x, e.y + 0.25, e.z);
          rm.material.color.set(e.color || '#ffffff');
        }
        continue;
      }
      const count = Math.min(e.count || 12, 42);
      for (let i = 0; i < count; i++) {
        const idx = cursor.current;
        cursor.current = (cursor.current + 1) % MAX_PARTICLES;
        const pt = parts[idx];
        const a = Math.random() * Math.PI * 2;
        const spread = Math.random();
        const sp = (e.speed || 10) * (0.4 + Math.random() * 0.8);
        pt.vx = (e.nx || 0) * sp * 0.7 + Math.cos(a) * spread * sp * 0.6;
        pt.vz = (e.nz || 0) * sp * 0.7 + Math.sin(a) * spread * sp * 0.6;
        pt.vy = (e.up ?? 0.8) * sp * (0.3 + Math.random() * 0.7);
        pt.px = e.x;
        pt.py = e.y;
        pt.pz = e.z;
        pt.ttl = pt.life = (e.ttl || 0.55) * (0.6 + Math.random() * 0.8);
        pt.size = (e.size || 0.16) * (0.7 + Math.random() * 0.7);
        pt.gravity = e.gravity ?? 26;
        pt.drag = e.drag ?? 0;
        pt.grow = e.grow ?? 0;
        m.setColorAt(idx, tmpColor.set(e.color || '#ffcf6e'));
        colorTouched = true;
      }
    }
    if (colorTouched && m.instanceColor) m.instanceColor.needsUpdate = true;

    // --- integrate particles ---
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = parts[i];
      if (pt.life > 0) {
        pt.life -= dt;
        pt.vy -= pt.gravity * dt;
        if (pt.drag) {
          const f = 1 / (1 + pt.drag * dt);
          pt.vx *= f;
          pt.vy *= f;
          pt.vz *= f;
        }
        pt.px += pt.vx * dt;
        pt.py += pt.vy * dt;
        pt.pz += pt.vz * dt;
      }
      const t = Math.max(0, pt.life / pt.ttl);
      const s = pt.life > 0 ? pt.size * (pt.grow ? (1 + (1 - t) * pt.grow) * t : t) : 0.0001;
      dummy.position.set(pt.px, pt.py, pt.pz);
      dummy.scale.setScalar(Math.max(0.0001, s));
      dummy.rotation.set(i * 1.3 + pt.life * 7, i * 2.1, pt.life * 5);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;

    // --- rings ---
    for (let i = 0; i < MAX_RINGS; i++) {
      const r = rings[i];
      const rm = ringMeshes.current[i];
      if (!rm) continue;
      if (r.life > 0) {
        r.life -= dt;
        const t = Math.max(0, r.life / r.ttl);
        rm.visible = true;
        rm.scale.setScalar(r.size * (1 + (1 - t) * 3.2));
        rm.material.opacity = 0.7 * t;
      } else {
        rm.visible = false;
      }
    }
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <tetrahedronGeometry args={[1, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {Array.from({ length: MAX_RINGS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => (ringMeshes.current[i] = el)}
          rotation-x={-Math.PI / 2}
          visible={false}
          frustumCulled={false}
        >
          <ringGeometry args={[0.72, 1, 36]} />
          <meshBasicMaterial toneMapped={false} transparent depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
