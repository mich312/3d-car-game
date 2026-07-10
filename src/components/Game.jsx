import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Sky, Stars, Environment, Lightformer } from '@react-three/drei';
import { useStore } from '../store.js';
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
      <color attach="background" args={['#0a0f24']} />
      {inHub ? (
        <fog attach="fog" args={['#26355f', 160, 560]} />
      ) : (
        <fog attach="fog" args={['#131a38', 140, 480]} />
      )}
      <Sky
        distance={450000}
        sunPosition={inHub ? [120, 45, -80] : [80, 12, -120]}
        turbidity={inHub ? 6 : 8}
        rayleigh={inHub ? 1.6 : 2.5}
        mieCoefficient={0.015}
      />
      <Stars radius={320} depth={60} count={2500} factor={5} fade speed={0.5} />

      <ambientLight intensity={0.55} color="#8fa8ff" />
      <hemisphereLight args={['#7f9bea', '#2a2148', 0.7]} />

      {/* Static procedural environment map: rendered ONCE (frames={1}) into a
          256px cubemap — free at runtime, no downloads. Gives car paint,
          glass, and water something to reflect. */}
      <Environment frames={1} resolution={256} background={false}>
        <color attach="background" args={['#0d1430']} />
        <Lightformer form="rect" intensity={3} color="#8fb8ff" scale={[40, 6, 1]} position={[0, 4, -20]} />
        <Lightformer form="rect" intensity={1.6} color="#ff9ac4" scale={[40, 5, 1]} position={[0, 3, 20]} rotation-y={Math.PI} />
        <Lightformer form="rect" intensity={8} color="#ffe9c0" scale={[8, 8, 1]} position={[18, 14, -12]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={2} color="#bcd6ff" scale={12} position={[0, 18, 0]} target={[0, 0, 0]} />
      </Environment>

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
