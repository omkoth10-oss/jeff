import * as THREE from 'three';

// World units are meters. The valley floor / river surface sits at y = 0,
// and the camera looks roughly down -Z toward the village, like the main reference.

// Hooded ninja standing on the rocky ledge (bottom-left of the reference frame).
export const NINJA = {
  position: new THREE.Vector3(0, 50, 0),
  // Faces a little right of the camera's forward direction, toward the village.
  yaw: THREE.MathUtils.degToRad(-12),
};

// Third-person camera, measured from the main reference (1536x1024, 3:2):
// the ninja is ~4 m from the lens, the camera sits above his right shoulder
// and looks down into the valley at about 16 degrees.
export const CAMERA = {
  fov: 50, // vertical
  near: 0.3,
  far: 6000, // the far range sits 2-5 km out
  offset: new THREE.Vector3(1.5, 2.3, 3.3), // right, up, back, relative to the ninja
  pitch: THREE.MathUtils.degToRad(-16),
  yaw: 0,
};

// Where the moon sits in the main reference, in normalized device coordinates.
export const MOON_NDC = new THREE.Vector2(0.589, 0.902);

export const REFERENCE_ASPECT = 1536 / 1024;
