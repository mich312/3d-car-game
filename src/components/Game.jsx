import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { useStore } from '../store.js';
import SkyCubemap from './SkyCubemap.jsx';
import Arena from './Arena.jsx';
import HubWorld from './HubWorld.jsx';
import Coins from './Coins.jsx';
import Crown from './Crown.jsx';
import Gates from './Gates.jsx';
import PlayerCar from './PlayerCar.jsx';
import RemoteCars from './RemoteCars.jsx';
import CrashFX from './CrashFX.jsx';
import Effects from './Effects.jsx';

export default function Game() {
  const inHub = useStore((s) => s.mode === 'hub');

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ fov: 62, near: 0.5, far: 1200, position: [0, 40, -60] }}
    >
      {inHub ? (
        <fog attach="fog" args={['#26355f', 160, 560]} />
      ) : (
        <fog attach="fog" args={['#131a38', 140, 480]} />
      )}

      {/* A real cubemap: the physical-sky shader baked into all six faces of a
          CubeCamera render target, then used as the skybox background AND the
          PMREM environment. Car paint, glass, and water reflect the actual sky
          above them — sun spot and all. Re-baked only when the sky changes. */}
      <SkyCubemap
        sunPosition={inHub ? [120, 45, -80] : [80, 12, -120]}
        turbidity={inHub ? 6 : 8}
        rayleigh={inHub ? 1.6 : 2.5}
        mieCoefficient={0.015}
      />
      <Stars radius={320} depth={60} count={2500} factor={5} fade speed={0.5} />

      <ambientLight intensity={0.55} color="#8fa8ff" />
      <hemisphereLight args={['#7f9bea', '#2a2148', 0.7]} />

      {inHub ? (
        <HubWorld />
      ) : (
        <>
          {/* arena rooms bring their own static sun */}
          <directionalLight
            castShadow
            position={[70, 90, -50]}
            intensity={1.6}
            color="#ffe2b0"
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-120}
            shadow-camera-right={120}
            shadow-camera-top={120}
            shadow-camera-bottom={-120}
            shadow-camera-far={320}
            shadow-bias={-0.0004}
          />
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
