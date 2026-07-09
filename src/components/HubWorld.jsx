import React, { useRef, useState, useMemo, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { localState } from '../net.js';
import { useStore } from '../store.js';
import { HUB_PORTALS, PORTAL_RADIUS, MODES } from '../../shared/config.js';
import {
  CHUNK_SIZE,
  VIEW_CHUNKS,
  WATER_LEVEL,
  PLAZA_RADIUS,
  PLAZA_HEIGHT,
  buildChunkData,
  decorationsForChunk,
} from '../../shared/terrain.js';

// ---------------------------------------------------------------------------
// Terrain chunks — streamed in a ring around the player, geometry + props
// generated deterministically from the shared noise so all clients agree.
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

function InstancedProps({ items, children, yOffset = 0, castShadow = true }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      _q.setFromAxisAngle(_v.set(0, 1, 0), (it.x * 7 + it.z * 13) % Math.PI);
      _s.setScalar(it.s);
      _m.compose(_v.set(it.x, it.y + yOffset * it.s, it.z), _q, _s);
      mesh.setMatrixAt(i, _m);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [items, yOffset]);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow={castShadow}>
      {children}
    </instancedMesh>
  );
}

function Chunk({ cx, cz }) {
  const { geometry, props } = useMemo(() => {
    const data = buildChunkData(cx, cz);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    return { geometry: g, props: decorationsForChunk(cx, cz) };
  }, [cx, cz]);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0.02} />
      </mesh>
      {/* trees: trunk + foliage */}
      <InstancedProps items={props.trees} yOffset={1.0}>
        <cylinderGeometry args={[0.22, 0.34, 2.2, 6]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
      </InstancedProps>
      <InstancedProps items={props.trees} yOffset={3.4}>
        <coneGeometry args={[1.9, 4.6, 7]} />
        <meshStandardMaterial color="#2f7a44" roughness={0.85} />
      </InstancedProps>
      <InstancedProps items={props.rocks} yOffset={0.35}>
        <dodecahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial color="#77808f" roughness={0.95} />
      </InstancedProps>
      <InstancedProps items={props.crystals} yOffset={1.0} castShadow={false}>
        <octahedronGeometry args={[1.0, 0]} />
        <meshStandardMaterial
          color="#7df9ff"
          emissive="#3fd7ff"
          emissiveIntensity={2.2}
          toneMapped={false}
        />
      </InstancedProps>
    </group>
  );
}

function TerrainChunks() {
  const [chunkList, setChunkList] = useState([]);
  const lastKey = useRef('');
  const frame = useRef(0);

  useFrame(() => {
    if (frame.current++ % 20 !== 0) return; // re-check ~3x/sec
    const cx = Math.floor(localState.p[0] / CHUNK_SIZE);
    const cz = Math.floor(localState.p[2] / CHUNK_SIZE);
    const key = cx + ',' + cz;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const list = [];
    for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
      for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
        if (dx * dx + dz * dz > (VIEW_CHUNKS + 0.5) ** 2) continue; // round horizon
        list.push({ cx: cx + dx, cz: cz + dz });
      }
    }
    setChunkList(list);
  });

  return (
    <>
      {chunkList.map((c) => (
        <Chunk key={c.cx + ',' + c.cz} cx={c.cx} cz={c.cz} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Water — a big plane that follows the player at sea level
// ---------------------------------------------------------------------------

function Water() {
  const ref = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.position.set(localState.p[0], WATER_LEVEL + Math.sin(state.clock.elapsedTime * 0.6) * 0.12, localState.p[2]);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[CHUNK_SIZE * (VIEW_CHUNKS * 2 + 2), CHUNK_SIZE * (VIEW_CHUNKS * 2 + 2)]} />
      <meshStandardMaterial
        color="#1565d8"
        transparent
        opacity={0.72}
        roughness={0.15}
        metalness={0.55}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Spawn plaza + portals
// ---------------------------------------------------------------------------

function Portal({ portal }) {
  const disc = useRef();
  const count = useStore((s) => s.portalCounts[portal.game] || 0);
  const facing = Math.atan2(portal.x, portal.z); // ring faces the plaza center

  useFrame((state, dt) => {
    if (disc.current) disc.current.rotation.z += dt * 1.6;
  });

  return (
    <group position={[portal.x, PLAZA_HEIGHT, portal.z]} rotation-y={facing}>
      {/* ring */}
      <mesh position={[0, 4.6, 0]} castShadow>
        <torusGeometry args={[PORTAL_RADIUS, 0.55, 12, 36]} />
        <meshStandardMaterial
          color={portal.color}
          emissive={portal.color}
          emissiveIntensity={1.8}
          toneMapped={false}
        />
      </mesh>
      {/* swirling event horizon */}
      <mesh ref={disc} position={[0, 4.6, 0]}>
        <circleGeometry args={[PORTAL_RADIUS - 0.4, 28]} />
        <meshBasicMaterial color={portal.color} transparent opacity={0.28} side={2} toneMapped={false} />
      </mesh>
      {/* pedestal */}
      <mesh position={[0, 0.25, 0]} receiveShadow>
        <cylinderGeometry args={[PORTAL_RADIUS + 1.6, PORTAL_RADIUS + 2.2, 0.5, 24]} />
        <meshStandardMaterial color="#232c58" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <torusGeometry args={[PORTAL_RADIUS + 1.6, 0.12, 8, 32]} />
        <meshStandardMaterial color={portal.color} emissive={portal.color} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {/* sign */}
      <Html position={[0, 10.4, 0]} center occlude={false} zIndexRange={[10, 0]}>
        <div className="portal-sign" style={{ borderColor: portal.color }}>
          <div className="portal-title" style={{ color: portal.color }}>
            {portal.icon} {MODES[portal.game].name}
          </div>
          <div className="portal-sub">{count > 0 ? `${count} playing` : 'empty — bots ready'}</div>
        </div>
      </Html>
    </group>
  );
}

function Plaza() {
  const beacon = useRef();
  useFrame((state) => {
    if (beacon.current) {
      beacon.current.rotation.y = state.clock.elapsedTime * 0.4;
    }
  });
  return (
    <group>
      {/* plaza disc sits just above the flattened terrain */}
      <mesh rotation-x={-Math.PI / 2} position={[0, PLAZA_HEIGHT + 0.05, 0]} receiveShadow>
        <circleGeometry args={[PLAZA_RADIUS, 48]} />
        <meshStandardMaterial color="#4b5794" roughness={0.55} metalness={0.25} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, PLAZA_HEIGHT + 0.08, 0]}>
        <ringGeometry args={[PLAZA_RADIUS - 1.2, PLAZA_RADIUS, 64]} />
        <meshBasicMaterial color="#3fd7ff" toneMapped={false} transparent opacity={0.9} />
      </mesh>
      {/* inner rings give the plaza some pattern */}
      {[16, 30].map((r) => (
        <mesh key={r} rotation-x={-Math.PI / 2} position={[0, PLAZA_HEIGHT + 0.07, 0]}>
          <ringGeometry args={[r - 0.35, r, 56]} />
          <meshBasicMaterial color="#7a8cd8" transparent opacity={0.5} />
        </mesh>
      ))}
      {/* center beacon */}
      <group ref={beacon} position={[0, PLAZA_HEIGHT, 0]}>
        <mesh position={[0, 5, 0]} castShadow>
          <coneGeometry args={[1.6, 10, 5]} />
          <meshStandardMaterial color="#3b4a8f" emissive="#7a5cff" emissiveIntensity={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 11, 0]}>
          <octahedronGeometry args={[1.2, 0]} />
          <meshStandardMaterial color="#ffffff" emissive="#ff5db1" emissiveIntensity={2.6} toneMapped={false} />
        </mesh>
      </group>
      <pointLight position={[0, PLAZA_HEIGHT + 12, 0]} intensity={140} distance={90} color="#b48cff" />
      {HUB_PORTALS.map((p) => (
        <Portal key={p.game} portal={p} />
      ))}
    </group>
  );
}

// Directional light that follows the player so shadows exist everywhere in
// an infinite world.
function FollowSun() {
  const light = useRef();
  const target = useRef(new THREE.Object3D());
  useFrame(() => {
    if (!light.current) return;
    const [x, , z] = localState.p;
    light.current.position.set(x + 70, 110, z - 60);
    target.current.position.set(x, 0, z);
    target.current.updateMatrixWorld();
    light.current.target = target.current;
  });
  return (
    <>
      <directionalLight
        ref={light}
        castShadow
        intensity={1.7}
        color="#ffe2b0"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-140}
        shadow-camera-right={140}
        shadow-camera-top={140}
        shadow-camera-bottom={-140}
        shadow-camera-far={400}
        shadow-bias={-0.0004}
      />
      <primitive object={target.current} />
    </>
  );
}

export default function HubWorld() {
  return (
    <group>
      <FollowSun />
      <TerrainChunks />
      <Water />
      <Plaza />
    </group>
  );
}
