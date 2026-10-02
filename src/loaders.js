import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const base = import.meta.env.BASE_URL;

// The Draco decoder and Basis transcoder ship with three and are bundled by Vite,
// so no decoder paths need to be configured.
export function createLoaders(renderer) {
  const ktx2 = new KTX2Loader().detectSupport(renderer);
  const gltf = new GLTFLoader().setDRACOLoader(new DRACOLoader()).setKTX2Loader(ktx2);

  return {
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    loadModel: (name) => gltf.loadAsync(`${base}models/${name}`),
    loadTexture: (name) => ktx2.loadAsync(`${base}textures/${name}`),
  };
}
