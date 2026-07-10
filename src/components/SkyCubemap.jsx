import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Sky as SkyImpl } from 'three/examples/jsm/objects/Sky.js';

/**
 * A REAL cubemap. Instead of faking reflections with flat light shapes, we
 * render the actual physical-sky shader into all six faces of a
 * WebGLCubeRenderTarget with a CubeCamera. That cube texture becomes:
 *   - scene.background  -> a true skybox the player drives under
 *   - scene.environment -> PMREM-prefiltered reflections on paint/glass/water
 *
 * Still zero-download and baked once per mode (the deps below), so it costs
 * nothing at steady state — but every reflection is now a genuine capture of
 * the sky above the car, complete with a hot sun spot and horizon gradient.
 */
export default function SkyCubemap({
  sunPosition = [80, 12, -120],
  turbidity = 8,
  rayleigh = 2.5,
  mieCoefficient = 0.015,
  mieDirectionalG = 0.8,
  exposure = 0.42,
  resolution = 512,
  background = true,
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  const [sx, sy, sz] = sunPosition;

  useEffect(() => {
    // Isolated scene holding only the sky dome, so the CubeCamera captures the
    // sky and nothing else (no cars, no ground) — a clean environment map.
    const skyScene = new THREE.Scene();

    const sky = new SkyImpl();
    sky.scale.setScalar(45000);
    const u = sky.material.uniforms;
    u.turbidity.value = turbidity;
    u.rayleigh.value = rayleigh;
    u.mieCoefficient.value = mieCoefficient;
    u.mieDirectionalG.value = mieDirectionalG;
    u.sunPosition.value.copy(new THREE.Vector3(sx, sy, sz).normalize());
    skyScene.add(sky);

    const cubeRT = new THREE.WebGLCubeRenderTarget(resolution, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(0.1, 100000, cubeRT);

    // Match the Sky demo's tone mapping so the baked sky reads naturally, then
    // restore the renderer's real exposure for the game render.
    const prevExposure = gl.toneMappingExposure;
    gl.toneMappingExposure = exposure;
    cubeCam.update(gl, skyScene);
    gl.toneMappingExposure = prevExposure;

    // Prefilter into a roughness-aware environment so rough paint blurs the
    // reflection correctly instead of mirroring the raw cube.
    const pmrem = new THREE.PMREMGenerator(gl);
    const envRT = pmrem.fromCubemap(cubeRT.texture);

    const prevBackground = scene.background;
    const prevEnvironment = scene.environment;
    scene.environment = envRT.texture;
    if (background) scene.background = cubeRT.texture;

    return () => {
      if (scene.environment === envRT.texture) scene.environment = prevEnvironment;
      if (scene.background === cubeRT.texture) scene.background = prevBackground;
      envRT.dispose();
      cubeRT.dispose();
      pmrem.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
    };
  }, [gl, scene, sx, sy, sz, turbidity, rayleigh, mieCoefficient, mieDirectionalG, exposure, resolution, background]);

  return null;
}
