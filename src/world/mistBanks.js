// Where the mist hangs: [x, z, width, height, alpha, kind, lift]
// kind 0 = drifting bank, 1 = waterfall spray. Heights come from the terrain.
export const MIST_BANKS = [
  // spray rolling up from the foot of the big waterfall, and drifting downstream
  [-24, -275, 40, 32, 0.7, 1], [-39, -270, 26, 20, 0.5, 1], [-9, -268, 28, 20, 0.5, 1],
  [-24, -284, 34, 50, 0.38, 1],
  [-22, -250, 80, 18, 0.5, 0],
  // the waterfall on the escarpment, and mist along the foot of the cliffs
  [-78, -141, 30, 30, 0.75, 1], [-71, -147, 32, 14, 0.5, 1], [-84, -146, 20, 36, 0.35, 1],
  [-62, -205, 60, 16, 0.35], [-66, -115, 50, 14, 0.3],
  // among the trees on the plateau above the waterfall cliff, spilling over its edge
  [-45, -330, 90, 24, 0.6], [45, -350, 120, 26, 0.55], [-95, -300, 70, 26, 0.5],
  [-140, -340, 90, 24, 0.5], [-20, -360, 110, 22, 0.45, 0, 6], [95, -370, 90, 24, 0.5],
  // low veils between the building clusters of the midground (clear near the viewer)
  [-35, -240, 50, 12, 0.32], [45, -262, 60, 12, 0.32], [72, -190, 50, 11, 0.3], [-46, -176, 44, 11, 0.3],
  [62, -142, 40, 10, 0.26], [10, -286, 70, 14, 0.36], [100, -215, 50, 12, 0.3],
  // low mist lying on the river through the village, thin enough to see the water
  [-16, -238, 44, 7, 0.36], [-8, -196, 46, 7, 0.32], [2, -165, 40, 6, 0.26], [22, -128, 50, 7, 0.28], [29, -92, 46, 7, 0.28],
  [30, -66, 40, 6, 0.26], [34, -40, 50, 8, 0.32], [60, 4, 60, 9, 0.34],
  // drifting off the main waterfall across the upper village
  [-45, -262, 50, 16, 0.4], [2, -262, 50, 14, 0.38],
  // low mist on the river
  [15, -205, 70, 9, 0.25], [70, -40, 60, 8, 0.2],
  // folds of the ridges either side of the valley
  [175, -225, 90, 30, 0.45], [150, -140, 80, 22, 0.35], [195, -335, 110, 32, 0.5],
  [240, -60, 120, 30, 0.5], [265, -200, 140, 36, 0.5], [300, -350, 160, 40, 0.55],
  // over the canopy of the east ridge, so it recedes into blue haze like the reference
  [230, -150, 140, 40, 0.5, 0, 14], [260, -300, 160, 40, 0.55, 0, 16], [220, -430, 170, 42, 0.55, 0, 16],
  // the low eastern lowland beyond the castle hill: broad banks lying on it
  [380, -280, 220, 30, 0.5], [420, -480, 260, 36, 0.55], [300, -600, 280, 40, 0.55], [540, -360, 260, 40, 0.55],
  [-150, -200, 90, 30, 0.4], [-165, -320, 110, 30, 0.45], [-210, -90, 90, 26, 0.35],
  // over the forest behind the village, lifted above the canopy: each band veils the
  // forest beyond it, layering the background
  [-300, -470, 200, 30, 0.45, 0, 16], [-140, -480, 200, 28, 0.45, 0, 16], [30, -470, 200, 30, 0.45, 0, 16], [190, -480, 200, 28, 0.45, 0, 16], [330, -470, 180, 30, 0.45, 0, 16],
  [-420, -630, 260, 34, 0.5, 0, 18], [-200, -620, 260, 32, 0.5, 0, 18], [30, -640, 260, 34, 0.5, 0, 18], [260, -620, 260, 32, 0.5, 0, 18], [460, -640, 240, 34, 0.5, 0, 18],
  [-560, -800, 320, 40, 0.55, 0, 20], [-280, -820, 320, 40, 0.55, 0, 20], [0, -800, 320, 42, 0.55, 0, 20], [290, -820, 320, 40, 0.55, 0, 20], [560, -800, 320, 40, 0.55, 0, 20],
  [-700, -1020, 420, 50, 0.55, 0, 22], [-300, -1000, 420, 54, 0.55, 0, 22], [100, -1020, 420, 52, 0.55, 0, 22], [500, -1000, 420, 50, 0.55, 0, 22], [850, -1020, 420, 50, 0.55, 0, 22],
];
