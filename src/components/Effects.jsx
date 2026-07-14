import React from 'react';
import { EffectComposer, Bloom, Vignette, SMAA, N8AO } from '@react-three/postprocessing';
import { useStore } from '../store.js';

// Post-processing pipeline. Two jobs:
//
//  1. "Fake ray tracing" — N8AO is a ray-marched ambient-occlusion pass: it
//     traces short rays in screen space to darken contact seams and crevices
//     (car-to-ground, pillar bases, building corners). That grounded contact
//     shadow is the single cue that most reads as "ray traced", and it also
//     restores the contrast the flat daytime lighting was washing out.
//  2. Bloom only catches materials brighter than 1.0 (our toneMapped={false}
//     emissives — portals, crystals, neon trim, flames), so the world glows
//     without blowing out. SMAA cleans the low-poly edges the composer would
//     otherwise leave aliased (canvas MSAA doesn't apply once a post pipeline
//     is in play).
//
// Quality tiers scale the AO cost: off on low, half-resolution on med, full
// resolution on high.
export default function Effects() {
  const gfx = useStore((s) => s.gfx);

  return (
    <EffectComposer disableNormalPass multisampling={0}>
      {gfx === 'low' ? (
        <></>
      ) : (
        <N8AO
          halfRes={gfx !== 'high'}
          quality={gfx === 'high' ? 'high' : 'medium'}
          aoRadius={3.2}
          distanceFalloff={1.0}
          intensity={gfx === 'high' ? 3.4 : 2.6}
          aoSamples={gfx === 'high' ? 16 : 8}
          denoiseSamples={gfx === 'high' ? 8 : 4}
          denoiseRadius={12}
          color="#0a1030"
        />
      )}
      <Bloom mipmapBlur intensity={0.9} luminanceThreshold={1.0} levels={7} />
      <Vignette eskil={false} offset={0.22} darkness={0.5} />
      <SMAA />
    </EffectComposer>
  );
}
