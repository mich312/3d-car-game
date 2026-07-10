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
  terrainHeight,
  RAMPS,
  RING_ROAD,
  CITY,
  BUILDINGS,
  GROTTO,
  TRIAL,
  TUNNEL_ARCHES,
  ROOF_GEMS,
} from '../../shared/terrain.js';
import { TRAFFIC_CARS, trafficPos } from '../traffic.js';
import { CONES } from '../cones.js';

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

// A PBR water material whose surface normal is rippled procedurally in the
// fragment shader (a sum of moving sine waves in world space). Because it stays
// a standard material, it keeps reflecting the real day/night sky cubemap and
// catching the sun's specular — the ripples just make those reflections dance,
// and the sun paints a moving glitter path across the water. No extra geometry,
// so the huge plane stays cheap.
function useWaterMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#12539f',
      transparent: true,
      opacity: 0.86,
      roughness: 0.08,
      metalness: 0.0,
      envMapIntensity: 1.6,
    });
    mat.userData.uTime = { value: 0 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = mat.userData.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nvarying vec2 vWorldXZ;'
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
          {
            vec2 w = vWorldXZ;
            float t = uTime;
            float sx = cos(w.x * 0.14 + t * 1.3) * 0.14
                     + cos(w.x * 0.37 - t * 1.7 + w.y * 0.1) * 0.06
                     + cos(w.x * 0.9 + t * 2.6 + w.y * 0.3) * 0.02;
            float sz = cos(w.y * 0.12 - t * 1.1) * 0.14
                     + cos(w.y * 0.41 + t * 1.9 + w.x * 0.1) * 0.06
                     + cos(w.y * 0.95 - t * 2.4 + w.x * 0.3) * 0.02;
            vec3 nw = normalize(vec3(-sx, 1.0, -sz));
            normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
          }`
        );
    };
    return mat;
  }, []);
}

function Water() {
  const ref = useRef();
  const material = useWaterMaterial();
  useFrame((state) => {
    material.userData.uTime.value = state.clock.elapsedTime;
    if (!ref.current) return;
    ref.current.position.set(localState.p[0], WATER_LEVEL + Math.sin(state.clock.elapsedTime * 0.6) * 0.12, localState.p[2]);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} material={material}>
      <planeGeometry args={[CHUNK_SIZE * (VIEW_CHUNKS * 2 + 2), CHUNK_SIZE * (VIEW_CHUNKS * 2 + 2)]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Stunt ramps — visual twins of the analytic wedges in shared/terrain.js
// ---------------------------------------------------------------------------

function Ramp({ ramp }) {
  const geometry = useMemo(() => {
    // right-triangle profile extruded across the width, oriented so local +z
    // runs up the ramp (matches the physics wedge exactly)
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(ramp.l, 0);
    shape.lineTo(ramp.l, ramp.h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: ramp.w, bevelEnabled: false });
    g.rotateY(-Math.PI / 2); // shape-x (along) -> +z, extrude depth -> -x
    g.translate(ramp.w / 2, 0, 0);
    return g;
  }, [ramp]);

  const slopeLen = Math.hypot(ramp.l, ramp.h);
  const pitch = -Math.atan2(ramp.h, ramp.l);

  return (
    <group position={[ramp.x, ramp.baseY, ramp.z]} rotation-y={ramp.yaw}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#252d5c" roughness={0.6} metalness={0.15} />
      </mesh>
      {/* neon rails along both sloped edges */}
      {[ramp.w / 2, -ramp.w / 2].map((x, i) => (
        <mesh key={i} position={[x, ramp.h / 2 + 0.1, ramp.l / 2]} rotation-x={pitch}>
          <boxGeometry args={[0.28, 0.24, slopeLen]} />
          <meshStandardMaterial color="#ffd23f" emissive="#ffd23f" emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      ))}
      {/* lip marker at the launch edge */}
      <mesh position={[0, ramp.h + 0.08, ramp.l - 0.2]}>
        <boxGeometry args={[ramp.w, 0.16, 0.4]} />
        <meshStandardMaterial color="#3fd7ff" emissive="#3fd7ff" emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Roads — flat ribbons draped over the terrain (visual guides, no physics)
// ---------------------------------------------------------------------------

function ribbonGeometry(points, width, lift) {
  const n = points.length;
  const positions = new Float32Array(n * 2 * 3);
  const normals = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, n - 1)];
    const pr = points[Math.max(i - 1, 0)];
    let dx = q.x - pr.x;
    let dz = q.z - pr.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * (width / 2);
    const pz = (dx / len) * (width / 2);
    const o = i * 6;
    positions[o] = p.x + px;
    positions[o + 1] = terrainHeight(p.x + px, p.z + pz) + lift;
    positions[o + 2] = p.z + pz;
    positions[o + 3] = p.x - px;
    positions[o + 4] = terrainHeight(p.x - px, p.z - pz) + lift;
    positions[o + 5] = p.z - pz;
    for (let k = 0; k < 2; k++) normals[o + k * 3 + 1] = 1;
  }
  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

function Road({ points, width = 8 }) {
  const { asphalt, line } = useMemo(
    () => ({
      asphalt: ribbonGeometry(points, width, 0.09),
      line: ribbonGeometry(points, 0.45, 0.14),
    }),
    [points, width]
  );
  return (
    <group>
      <mesh geometry={asphalt} receiveShadow>
        <meshStandardMaterial color="#1a2140" roughness={0.85} metalness={0.05} />
      </mesh>
      <mesh geometry={line}>
        <meshBasicMaterial color="#3fd7ff" toneMapped={false} transparent opacity={0.75} />
      </mesh>
    </group>
  );
}

function Roads() {
  const { ring, highway, caveRoad } = useMemo(() => {
    const ring = [];
    const SEGS = 160;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      ring.push({ x: Math.sin(a) * RING_ROAD.r, z: Math.cos(a) * RING_ROAD.r });
    }
    const highway = [];
    for (let x = 42; x <= CITY.x + 70; x += 4) highway.push({ x, z: 0 });
    const caveRoad = [];
    for (let x = -42; x >= GROTTO.x; x -= 4) caveRoad.push({ x, z: 0 });
    return { ring, highway, caveRoad };
  }, []);
  return (
    <group>
      <Road points={ring} width={RING_ROAD.w} />
      <Road points={highway} width={10} />
      <Road points={caveRoad} width={7} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Crystal Grotto — arched cave pass west of the plaza into a crystal hollow
// ---------------------------------------------------------------------------

function Grotto() {
  const heart = useRef();
  useFrame((state) => {
    if (heart.current) {
      heart.current.rotation.y = state.clock.elapsedTime * 0.5;
      heart.current.position.y = 6.5 + Math.sin(state.clock.elapsedTime * 1.3) * 0.5;
    }
  });
  return (
    <group>
      {/* stone arches turn the deep canyon section into a tunnel */}
      {TUNNEL_ARCHES.map((a, i) => (
        <group key={i} position={[a.x, a.y, 0]} rotation-y={Math.PI / 2}>
          <mesh castShadow>
            <torusGeometry args={[11, 1.6, 8, 20, Math.PI]} />
            <meshStandardMaterial color="#3a4257" roughness={0.9} />
          </mesh>
          {/* crystal vein glowing along the inside of each arch */}
          <mesh>
            <torusGeometry args={[9.4, 0.28, 6, 20, Math.PI]} />
            <meshStandardMaterial color="#7df9ff" emissive="#3fd7ff" emissiveIntensity={1.8} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {/* heart of the grotto: a huge floating crystal */}
      <group position={[GROTTO.x, GROTTO.h, GROTTO.z]}>
        <group ref={heart} position={[0, 6.5, 0]}>
          <mesh castShadow>
            <octahedronGeometry args={[3.2, 0]} />
            <meshStandardMaterial color="#b7fbff" emissive="#3fd7ff" emissiveIntensity={2.4} toneMapped={false} />
          </mesh>
        </group>
        <pointLight position={[0, 9, 0]} intensity={260} distance={110} color="#66e4ff" />
        <Html position={[0, 14, 0]} center occlude={false} zIndexRange={[10, 0]}>
          <div className="portal-sign" style={{ borderColor: '#7df9ff' }}>
            <div className="portal-title" style={{ color: '#7df9ff' }}>
              💎 CRYSTAL GROTTO
            </div>
            <div className="portal-sub">every crystal recharges nitro +2🪙</div>
          </div>
        </Html>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Highway sprint gates — start arch east of the plaza, finish at the spire
// ---------------------------------------------------------------------------

function SprintGate({ x, z, color, title, sub }) {
  return (
    <group position={[x, terrainHeight(x, z), z]} rotation-y={Math.PI / 2}>
      <mesh castShadow>
        <torusGeometry args={[10, 0.7, 8, 22, Math.PI]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <Html position={[0, 12.6, 0]} center occlude={false} zIndexRange={[10, 0]}>
        <div className="portal-sign" style={{ borderColor: color }}>
          <div className="portal-title" style={{ color }}>
            {title}
          </div>
          <div className="portal-sub">{sub}</div>
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// City traffic — analytic loops, positions are a pure function of clock time
// ---------------------------------------------------------------------------

function TrafficCar({ index, color }) {
  const group = useRef();
  const scratch = useRef({ x: 0, z: 0, yaw: 0 });
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const p = trafficPos(index, Date.now() / 1000, scratch.current);
    g.position.set(p.x, CITY.h, p.z);
    g.rotation.y = p.yaw;
  });
  return (
    <group ref={group}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.8, 0.7, 3.6]} />
        <meshStandardMaterial color={color} metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.15, -0.3]}>
        <boxGeometry args={[1.5, 0.5, 1.7]} />
        <meshStandardMaterial color="#10152b" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.55, 1.83]}>
        <boxGeometry args={[1.3, 0.18, 0.06]} />
        <meshStandardMaterial color="#fff7c9" emissive="#fff7c9" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.55, -1.83]}>
        <boxGeometry args={[1.3, 0.18, 0.06]} />
        <meshStandardMaterial color="#ff2038" emissive="#ff2038" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Traffic() {
  return (
    <group>
      {TRAFFIC_CARS.map((c, i) => (
        <TrafficCar key={i} index={i} color={c.color} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Knockable cones — idle ones stand at their base; hit ones tumble and reset
// ---------------------------------------------------------------------------

function Cones() {
  const mesh = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, rawDt) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.1);
    const now = Date.now();
    for (let i = 0; i < CONES.length; i++) {
      const c = CONES[i];
      if (c.knocked) {
        c.vy -= 24 * dt;
        c.px += c.vx * dt;
        c.py += c.vy * dt;
        c.pz += c.vz * dt;
        c.rot += c.spin * dt;
        if (c.py < c.y) {
          c.py = c.y;
          c.vy *= -0.35;
          c.vx *= 0.6;
          c.vz *= 0.6;
          c.spin *= 0.6;
        }
        if (now > c.resetAt) c.knocked = false;
        dummy.position.set(c.px, c.py + 0.55, c.pz);
        dummy.rotation.set(c.rot, c.rot * 0.7, c.rot * 1.3);
      } else {
        dummy.position.set(c.x, c.y + 0.55, c.z);
        dummy.rotation.set(0, 0, 0);
      }
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CONES.length]} castShadow frustumCulled={false}>
      <coneGeometry args={[0.45, 1.1, 10]} />
      <meshStandardMaterial color="#ff7a1a" emissive="#ff7a1a" emissiveIntensity={0.35} roughness={0.6} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Neon Heights — instanced towers with glowing roofs and window strips
// ---------------------------------------------------------------------------

const NEON = ['#3fd7ff', '#ff5db1', '#ffd23f', '#0affa0'];
const BODY_TONES = ['#141a33', '#181f3f', '#10152b', '#1c2348'];

function CityBlocks() {
  const bodies = useRef();
  const roofs = useRef();
  const strips = useRef();

  useLayoutEffect(() => {
    const color = new THREE.Color();
    BUILDINGS.forEach((b, i) => {
      const baseY = CITY.h - 0.3;
      _q.identity();
      // body
      _m.compose(_v.set(b.x, baseY + b.h / 2, b.z), _q, _s.set(b.w, b.h, b.d));
      bodies.current.setMatrixAt(i, _m);
      bodies.current.setColorAt(i, color.set(BODY_TONES[b.tone]));
      // glowing roof rim
      _m.compose(_v.set(b.x, baseY + b.h + 0.08, b.z), _q, _s.set(b.w + 0.4, 0.18, b.d + 0.4));
      roofs.current.setMatrixAt(i, _m);
      roofs.current.setColorAt(i, color.set(NEON[b.tone]));
      // vertical window strip poking through two opposite faces
      const sw = b.axis ? b.w * 0.2 : b.w + 0.14;
      const sd = b.axis ? b.d + 0.14 : b.d * 0.2;
      _m.compose(_v.set(b.x, baseY + b.h * 0.48, b.z), _q, _s.set(sw, b.h * 0.72, sd));
      strips.current.setMatrixAt(i, _m);
      strips.current.setColorAt(i, color.set(NEON[(b.tone + 1) % 4]));
    });
    for (const ref of [bodies, roofs, strips]) {
      ref.current.count = BUILDINGS.length;
      ref.current.instanceMatrix.needsUpdate = true;
      if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    }
  }, []);

  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, BUILDINGS.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.55} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[undefined, undefined, BUILDINGS.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={strips} args={[undefined, undefined, BUILDINGS.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={0.85} />
      </instancedMesh>
    </group>
  );
}

function StreetLamps() {
  const poles = useRef();
  const heads = useRef();
  const lamps = useMemo(() => {
    const list = [];
    for (let x = -88; x <= 88; x += 22) {
      if (Math.abs(x) < 14) continue; // keep the junction clear
      list.push({ x: CITY.x + x, z: 11 }, { x: CITY.x + x, z: -11 });
    }
    for (let z = -88; z <= 88; z += 22) {
      if (Math.abs(z) < 14) continue;
      list.push({ x: CITY.x + 9, z }, { x: CITY.x - 9, z });
    }
    return list;
  }, []);
  useLayoutEffect(() => {
    _q.identity();
    lamps.forEach((l, i) => {
      _m.compose(_v.set(l.x, CITY.h + 2.1, l.z), _q, _s.set(1, 1, 1));
      poles.current.setMatrixAt(i, _m);
      _m.compose(_v.set(l.x, CITY.h + 4.35, l.z), _q, _s.set(1, 1, 1));
      heads.current.setMatrixAt(i, _m);
    });
    poles.current.count = heads.current.count = lamps.length;
    poles.current.instanceMatrix.needsUpdate = true;
    heads.current.instanceMatrix.needsUpdate = true;
  }, [lamps]);
  return (
    <group>
      <instancedMesh ref={poles} args={[undefined, undefined, lamps.length]}>
        <cylinderGeometry args={[0.09, 0.13, 4.2, 6]} />
        <meshStandardMaterial color="#2a3152" roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, lamps.length]}>
        <sphereGeometry args={[0.28, 8, 8]} />
        <meshStandardMaterial color="#ffe9b8" emissive="#ffd98a" emissiveIntensity={2.2} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function RoofGems() {
  const refs = useRef([]);
  useFrame((state) => {
    refs.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.y = state.clock.elapsedTime * 1.4 + i;
      g.position.y = ROOF_GEMS[i].y + Math.sin(state.clock.elapsedTime * 2 + i * 2) * 0.35;
    });
  });
  return (
    <group>
      {ROOF_GEMS.map((g, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)} position={[g.x, g.y, g.z]}>
          <octahedronGeometry args={[1.1, 0]} />
          <meshStandardMaterial color="#fff3c4" emissive="#ffd23f" emissiveIntensity={2.6} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function City() {
  const beacon = useRef();
  useFrame((state) => {
    if (beacon.current) beacon.current.rotation.y = state.clock.elapsedTime * 0.7;
  });
  return (
    <group>
      <CityBlocks />
      <StreetLamps />
      <RoofGems />
      <Traffic />
      {/* central spire landmark, visible from the mountain pass */}
      <group position={[CITY.x, CITY.h, CITY.z]}>
        <mesh position={[0, 16, 0]} castShadow>
          <cylinderGeometry args={[0.8, 2.4, 32, 6]} />
          <meshStandardMaterial color="#232c58" emissive="#7a5cff" emissiveIntensity={0.5} roughness={0.4} />
        </mesh>
        <group ref={beacon} position={[0, 34, 0]}>
          <mesh>
            <octahedronGeometry args={[2.2, 0]} />
            <meshStandardMaterial color="#ffffff" emissive="#ff5db1" emissiveIntensity={2.8} toneMapped={false} />
          </mesh>
        </group>
        <pointLight position={[0, 26, 0]} intensity={220} distance={130} color="#ff9ad2" />
        <Html position={[0, 42, 0]} center occlude={false} zIndexRange={[10, 0]}>
          <div className="portal-sign" style={{ borderColor: '#ff5db1' }}>
            <div className="portal-title" style={{ color: '#ff5db1' }}>
              🌆 NEON HEIGHTS
            </div>
            <div className="portal-sub">follow the highway east</div>
          </div>
        </Html>
      </group>
    </group>
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

export default function HubWorld() {
  return (
    <group>
      <TerrainChunks />
      <Water />
      <Plaza />
      <Roads />
      {RAMPS.map((r, i) => (
        <Ramp key={i} ramp={r} />
      ))}
      <City />
      <Grotto />
      <Cones />
      <SprintGate
        x={TRIAL.start.x}
        z={TRIAL.start.z}
        color="#3fd7ff"
        title="⏱ HIGHWAY SPRINT"
        sub="race the clock to the city spire"
      />
      <SprintGate
        x={CITY.x - CITY.r - 2}
        z={0}
        color="#ff5db1"
        title="🌆 ALMOST THERE"
        sub="finish at the spire plaza"
      />
    </group>
  );
}
