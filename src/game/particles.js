// The particle list has one place per concern: this module builds the objects,
// advances them and drops the dead ones. An impact burst (enemies.js), the ground
// trail (trails.js) and the frame integrator all speak the same shape through it,
// instead of each copy repeating the fields - and a copy that forgets `maxLife`
// silently changes how long a particle stays visible, because the renderer falls
// back to `effectRules.particleFadeSeconds` when it is missing.
const PARTICLE_DEFAULTS = Object.freeze({
  // The renderer paints anything that is neither a ring nor a trail as a square
  // mote, which is what every emitter before the trail wanted.
  kind: "mote",
  vx: 0,
  vy: 0,
  size: 3,
  growth: 0,
});

export function spawnParticle(list, fields) {
  const particle = { ...PARTICLE_DEFAULTS, ...fields };
  list.push(particle);
  return particle;
}

export function updateParticles(list, delta) {
  for (const particle of list) {
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.life -= delta;
    particle.vx *= 0.97;
    particle.vy *= 0.97;
  }
}

export function pruneParticles(list) {
  return list.filter((particle) => particle.life > 0);
}

// Counting by kind is what the trail cap is made of, and it keeps the scan in
// one place instead of a `filter(...).length` per actor.
export function countParticles(list, kind) {
  let count = 0;
  for (const particle of list) if (particle.kind === kind) count += 1;
  return count;
}
