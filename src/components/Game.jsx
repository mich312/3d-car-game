import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Sky, Stars } from '@react-three/drei';
import { useStore } from '../store.js';
import Arena from './Arena.jsx';
import HubWorld from './HubWorld.jsx';
import Coins from './Coins.jsx';
import Crown from './Crown.jsx';
import Gates from './Gates.jsx';
import PlayerCar from './PlayerCar.jsx';
import RemoteCars from './RemoteCars.jsx';
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

      <ambientLight intensity={0.75} color="#8fa8ff" />
      <hemisphereLight args={['#7f9bea', '#2a2148', 0.9]} />

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
      <Effects />
    </Canvas>
  );
}
