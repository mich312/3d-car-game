import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Sky as SkyImpl } from 'three/examples/jsm/objects/Sky.js';
import { dayTime, sampleSky, createSkySample } from '../dayNight.js';

/**
 * A REAL cubemap that tracks the day/night cycle.
 *
 * The physical-sky shader is rendered into all six faces of a CubeCamera
 * render target; that genuine cube texture is the skybox background AND (after
 * PMREM prefiltering) the reflection environment. As the sun moves we re-bake
 * — but only a few times a second and reusing the same targets, so paint,
 * glass, and water always reflect the current sky (dawn glow, noon blue, night
 * dark) without the per-frame cost of a live capture.
 */
export default function SkyCubemap({ resolution = 384, background = true }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const sample = useMemo(createSkySample, []);
  const lastBakeDir = useRef(new THREE.Vector3(0, -2, 0)); // force first bake
  const lastBakeAt = useRef(-1);

  const rig = useMemo(() => {
    const skyScene = new THREE.Scene();
    const sky = new SkyImpl();
    sky.scale.setScalar(45000);
    const u = sky.material.uniforms;
    u.turbidity.value = 2.6;
    u.rayleigh.value = 2.6;
    u.mieCoefficient.value = 0.008;
    u.mieDirectionalG.value = 0.86;
    skyScene.add(sky);

    const cubeRT = new THREE.WebGLCubeRenderTarget(resolution, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(0.1, 100000, cubeRT);
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileCubemapShader();

    return { skyScene, sky, cubeRT, cubeCam, pmrem, envRT: null };
  }, [gl, resolution]);

  const bake = (sunDir) => {
    rig.sky.material.uniforms.sunPosition.value.copy(sunDir);
    const prevExposure = gl.toneMappingExposure;
    gl.toneMappingExposure = 0.28;
    rig.cubeCam.update(gl, rig.skyScene);
    gl.toneMappingExposure = prevExposure;
    // Reuse the PMREM target across bakes; fromCubemap allocates one on first
    // call and writes into it thereafter.
    rig.envRT = rig.pmrem.fromCubemap(rig.cubeRT.texture, rig.envRT || undefined);
    scene.environment = rig.envRT.texture;
    if (background) scene.background = rig.cubeRT.texture;
  };

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    sampleSky(dayTime(t), sample);
    // Re-bake when the sun has moved enough or ~5x/sec at most, whichever is
    // rarer — a cheap way to keep reflections current without churn.
    const moved = lastBakeDir.current.dot(sample.sun) < 0.9997;
    if ((moved && t - lastBakeAt.current > 0.2) || lastBakeAt.current < 0) {
      bake(sample.sun);
      lastBakeDir.current.copy(sample.sun);
      lastBakeAt.current = t;
    }
  });

  useEffect(() => {
    const prevBg = scene.background;
    const prevEnv = scene.environment;
    const rigRef = rig;
    return () => {
      if (scene.environment === rigRef.envRT?.texture) scene.environment = prevEnv;
      if (scene.background === rigRef.cubeRT.texture) scene.background = prevBg;
      rigRef.envRT?.dispose();
      rigRef.cubeRT.dispose();
      rigRef.pmrem.dispose();
      rigRef.sky.geometry.dispose();
      rigRef.sky.material.dispose();
    };
  }, [rig, scene]);

  return null;
}
