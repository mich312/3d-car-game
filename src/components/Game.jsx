import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars, SoftShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { dayTime, sampleSky, createSkySample } from '../dayNight.js';
import SkyCubemap from './SkyCubemap.jsx';
import DayNightLights from './DayNightLights.jsx';
import SkyClouds from './SkyClouds.jsx';
import Arena from './Arena.jsx';
import HubWorld from './HubWorld.jsx';
import Coins from './Coins.jsx';
import Crown from './Crown.jsx';
import Gates from './Gates.jsx';
import PlayerCar from './PlayerCar.jsx';
import RemoteCars from './RemoteCars.jsx';
import CrashFX from './CrashFX.jsx';
import Effects from './Effects.jsx';

// Fog whose colour rides the cycle: deep navy at night, soft blue by day, warm
// at dawn/dusk. Distances stay per-mode.
function DayNightFog({ near, far }) {
  const fog = useRef();
  const sample = useMemo(createSkySample, []);
  useFrame((state) => {
    sampleSky(dayTime(state.clock.elapsedTime), sample);
    if (fog.current) fog.current.color.copy(sample.fogColor);
  });
  return <fog ref={fog} attach="fog" args={['#0c1230', near, far]} />;
}

// drei Stars, faded in and out with the night via a patched-in opacity uniform
// (its additive shader has no opacity of its own).
function NightStars() {
  const stars = useRef();
  const sample = useMemo(createSkySample, []);
  const uOpacity = useRef({ value: 0 });
  useEffect(() => {
    const pts = stars.current;
    if (!pts) return;
    const mat = pts.material;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uOpacity = uOpacity.current;
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform float fade;', 'uniform float fade;\nuniform float uOpacity;')
        .replace('gl_FragColor = vec4(vColor, opacity);', 'gl_FragColor = vec4(vColor, opacity * uOpacity);');
    };
    mat.needsUpdate = true;
  }, []);
  useFrame((state) => {
    sampleSky(dayTime(state.clock.elapsedTime), sample);
    uOpacity.current.value = sample.starOpacity;
    if (stars.current) stars.current.visible = sample.starOpacity > 0.01;
  });
  return <Stars ref={stars} radius={210} depth={50} count={4000} factor={11} fade speed={0.4} />;
}

// Per-tier graphics settings. AgX tone mapping (filmic highlight roll-off) is
// always on — it's what stops the bright daytime sky clipping to flat white;
// exposure is pulled well under 1 so midday sits in range. Pixel ratio and
// PCSS soft shadows scale with the tier (the sun's shadow-map resolution
// scales too, over in DayNightLights). The Canvas is remounted when the tier
// changes (keyed on `gfx`) so shadow config and any patched shader chunks
// rebuild cleanly rather than being toggled live.
const GFX = {
  low: { exposure: 0.78, dprMax: 1.0, soft: false },
  med: { exposure: 0.74, dprMax: 1.5, soft: false },
  high: { exposure: 0.72, dprMax: 1.5, soft: true },
};

export default function Game() {
  const inHub = useStore((s) => s.mode === 'hub');
  const gfx = useStore((s) => s.gfx);
  const cfg = GFX[gfx] || GFX.high;

  return (
    <Canvas
      key={gfx}
      shadows
      dpr={[1, cfg.dprMax]}
      camera={{ fov: 62, near: 0.5, far: 1200, position: [0, 40, -60] }}
      gl={{ toneMapping: THREE.AgXToneMapping, toneMappingExposure: cfg.exposure }}
    >
      {/* PCSS soft shadows on the top tier: penumbras widen with distance from
          the caster, the way real (ray-traced) contact shadows do. */}
      {cfg.soft && <SoftShadows size={26} samples={16} focus={0.9} />}

      <DayNightFog near={inHub ? 160 : 140} far={inHub ? 560 : 480} />

      {/* A real cubemap that tracks the day/night cycle: the physical-sky
          shader baked into a CubeCamera render target and re-baked as the sun
          moves, used as both the skybox background and the PMREM reflection
          environment. Car paint, glass, and water reflect the sky overhead. */}
      <SkyCubemap />
      <NightStars />
      <SkyClouds />

      {/* One sun for the whole game, following the player and riding the cycle
          (colour, intensity, elevation), plus ambient + hemisphere. */}
      <DayNightLights />

      {inHub ? (
        <HubWorld />
      ) : (
        <>
          <Arena />
          <Coins />
          <Crown />
          <Gates />
        </>
      )}

      <PlayerCar />
      <RemoteCars />
      <CrashFX />
      <Effects />
    </Canvas>
  );
}
