import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { localState } from '../net.js';
import { dayTime, sampleSky, createSkySample } from '../dayNight.js';

/**
 * The single sun for the whole game. It follows the player (so shadows exist
 * everywhere in the infinite world) and rides the day/night cycle: colour,
 * intensity, and elevation all come from the shared sky sampler. Replaces the
 * old per-mode static directional lights. Ambient + hemisphere ride along so
 * the scene darkens to a cool blue night and warms at dawn/dusk.
 */
export default function DayNightLights() {
  const sun = useRef();
  const amb = useRef();
  const hemi = useRef();
  const sample = useMemo(createSkySample, []);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    sampleSky(dayTime(state.clock.elapsedTime), sample);
    const [px, , pz] = localState.p;

    if (sun.current) {
      // Park the light up along the sun direction, aimed at the player.
      sun.current.position.set(
        px + sample.sun.x * 180,
        Math.max(6, sample.sun.y * 180),
        pz + sample.sun.z * 180
      );
      target.position.set(px, 0, pz);
      target.updateMatrixWorld();
      sun.current.target = target;
      sun.current.color.copy(sample.sunColor);
      sun.current.intensity = sample.sunIntensity;
      sun.current.visible = sample.sunIntensity > 0.02;
    }
    if (amb.current) {
      amb.current.color.copy(sample.ambColor);
      amb.current.intensity = sample.ambIntensity;
    }
    if (hemi.current) {
      hemi.current.color.copy(sample.hemiSky);
      hemi.current.groundColor.copy(sample.hemiGround);
      hemi.current.intensity = sample.hemiIntensity;
    }
  });

  return (
    <>
      <ambientLight ref={amb} />
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-140}
        shadow-camera-right={140}
        shadow-camera-top={140}
        shadow-camera-bottom={-140}
        shadow-camera-far={520}
        shadow-bias={-0.0004}
      />
      <primitive object={target} />
    </>
  );
}
