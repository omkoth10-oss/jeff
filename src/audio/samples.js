// Optional recordings. Every sound in the game is synthesised (src/audio/bank.js), so the
// game needs no audio files. To use a recording instead, put the file in public/audio/
// and name it here (path relative to the site root); it replaces the synthesised sound
// when it loads, and the synthesised one is used if it fails. Loops should loop
// seamlessly; one-shots may be lists (a variant is picked at random each time).
//
//   wind: 'audio/wind.ogg',
//   chime: ['audio/chime-1.ogg', 'audio/chime-2.ogg'],
//
// Beds: wind, leaves, river, waterfall, fire, insectsField, insectsBell, insectsChorus
// One-shots: owl, thrush, frog, splash, chime, creak, shoji, clappers, bell, whoosh
// Footsteps: step_stone, step_dirt, step_grass, step_wood, step_water (lists)
export const SAMPLES = {};
