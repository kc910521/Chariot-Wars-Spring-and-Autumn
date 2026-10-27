import { effectRules } from "../data/rules.js";
import { clamp } from "../utils/math.js";
import { countParticles, spawnParticle } from "./particles.js";

const lerp = (from, to, t) => from + (to - from) * t;

// Ground dust behind anything that is actually travelling. The renderer paints it
// under the bodies, so a hull drives through its own wake instead of wearing it.
//
// Size and span come from how fast the unit is moving *right now*, measured from
// its own displacement over the frame rather than from its `speed` field. That
// one choice covers the awkward cases for free: a hull pinned against an obstacle,
// a unit turning on the spot (strideAt gates its pace by the facing gap) and a
// crowd being shoved all settle down on their own, without the AI, the controller
// or the collision system knowing this exists.
//
// Nothing is raised by a unit standing still, and nothing by the chariot backing
// up: reverse travel in player.js is `angle + PI`, so a displacement pointing away
// from the nose is exactly what the dot product below rejects - and it rejects the
// drag of a knockback too, which would otherwise leave dust in front of the hull.
//
// The trail draws no random numbers. A lateral offset and a palette step alternate
// instead, because every `random()` here would come out of the battle's seed
// stream and move every enemy decision in the run: decoration must not steer the
// fight.
export function createTrailSystem({ state, camera, view }) {
  const rules = effectRules.trail;
  let side = -1;
  // Trail puffs live in the list for this frame. Seeded once per update and
  // incremented as puffs are spawned, so the cap costs one scan, not one per actor.
  let live = 0;

  function emit(actor, dirX, dirY, speed, strength) {
    side = -side;
    const back = (actor.radius ?? 14) * 0.7;
    const aside = side * (0.35 + 0.3 * strength);
    const life = lerp(rules.lifeMin, rules.lifeMax, strength);
    const drift = lerp(rules.driftMin, rules.driftMax, strength) * speed;
    spawnParticle(state.particles, {
      kind: "trail",
      // Behind the body and a little to one side, so consecutive puffs fan out
      // into a wake instead of stacking into a column.
      x: actor.x - dirX * back - dirY * aside,
      y: actor.y - dirY * back + dirX * aside,
      vx: -dirX * drift,
      // A puff that only drifts backwards reads as a smear; one that only climbs
      // reads as steam. It keeps a share of the unit's motion and rises, which is
      // what makes a low, thickening cloud.
      vy: -dirY * drift - lerp(rules.riseMin, rules.riseMax, strength),
      size: lerp(rules.sizeMin, rules.sizeMax, strength),
      growth: lerp(rules.growthMin, rules.growthMax, strength),
      life,
      maxLife: life, // its own fade, not the shared 0.52s fallback
      color: rules.colors[Math.min(rules.colors.length - 1, Math.floor(strength * rules.colors.length))],
    });
    live += 1;
  }

  // An off-screen unit would still pay for the displacement maths, the puff and
  // its fade, and it would spend a visible unit's share of `maxLive`.
  function onScreen(actor) {
    return actor.x >= camera.x - rules.cullMargin && actor.x <= camera.x + view.width + rules.cullMargin
      && actor.y >= camera.y - rules.cullMargin && actor.y <= camera.y + view.height + rules.cullMargin;
  }

  function track(actor, delta) {
    const previousX = actor.trailX;
    const previousY = actor.trailY;
    actor.trailX = actor.x;
    actor.trailY = actor.y;
    // First sighting of a unit (spawn, stage reset, dismount): there is no stride
    // to measure yet, and the jump from wherever it was is not one.
    if (previousX === undefined || previousY === undefined) return;
    const dx = actor.x - previousX;
    const dy = actor.y - previousY;
    const distance = Math.hypot(dx, dy);
    // A respawn or a teleport is not a stride either: one frame cannot cover this.
    if (distance > rules.maxStep) return;
    const speed = distance / delta;
    const forward = dx * Math.cos(actor.angle) + dy * Math.sin(actor.angle);
    if (speed < rules.minSpeed || forward <= 0) {
      actor.trailCarry = 0;
      return;
    }
    const strength = clamp((speed - rules.minSpeed) / (rules.fullSpeed - rules.minSpeed), 0, 1);
    actor.trailCarry = (actor.trailCarry ?? 0) + lerp(rules.rateMin, rules.rateMax, strength) * delta;
    const dirX = dx / distance;
    const dirY = dy / distance;
    while (actor.trailCarry >= 1 && live < rules.maxLive) {
      actor.trailCarry -= 1;
      emit(actor, dirX, dirY, speed, strength);
    }
    // A full list is not a debt: drop the remainder instead of banking it for the
    // frame the list empties, which would burst out a pile of puffs at once.
    if (actor.trailCarry >= 1) actor.trailCarry = 0;
  }

  function update(delta, player, enemies, allies = []) {
    if (!(delta > 0)) return;
    live = countParticles(state.particles, "trail");
    if (onScreen(player)) track(player, delta);
    for (const enemy of enemies) {
      if (!enemy.destroyed && onScreen(enemy)) track(enemy, delta);
    }
    // The hired line raises the same wake as anything else travelling on the
    // field; foot allies included, which is how the player reads a charge.
    for (const ally of allies) {
      if (!ally.destroyed && onScreen(ally)) track(ally, delta);
    }
  }

  return { update };
}
