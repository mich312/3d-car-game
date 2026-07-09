import React from 'react';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';

// Post-processing: bloom only catches materials brighter than 1.0 (our
// toneMapped={false} emissives — portals, crystals, neon trim, flames), so
// the world glows without washing out.
export default function Effects() {
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur intensity={0.9} luminanceThreshold={1.0} levels={7} />
      <Vignette eskil={false} offset={0.22} darkness={0.5} />
    </EffectComposer>
  );
}
