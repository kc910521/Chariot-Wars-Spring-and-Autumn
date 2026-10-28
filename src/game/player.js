import { clamp } from "../utils/math.js";

export const CHARIOT_CONTROL_CONFIG = Object.freeze({
  maxSpeed: 170, // Increase for a faster top speed.
  acceleration: 230, // Increase for quicker speed build-up.
  deceleration: 180, // Increase to stop faster when the joystick is centered.
  maxTurnRate: 120, // Degrees per second; increase for faster heading changes.
  turnSpeedFactor: 0.62, // Lower to lose more speed during sharp turns.
  turnAngleThreshold: 0.08, // Radians; lower to keep turn slowdown active longer.
  // Reverse lane: a *small* stick push behind the nose backs the chariot up in
  // the stick's own direction while `player.angle` (firing, crew, ramming) stays
  // put. Keyboard input always contributes magnitude 1, so this lane is
  // reachable only through the touch joystick.
  // Must stay above reverseMaxSpeed, otherwise the chariot leaves the lane the
  // moment it accelerates and flickers between reversing and turning.
  reverseLowSpeedThreshold: 32, // px/s; "moving slowly or standing still".
  reverseMaxInputMagnitude: 0.85, // Joystick magnitude, i.e. 0.45 * 0.72 = 32% of the pad radius.
  reverseAngleThreshold: 120 * (Math.PI / 180), // Lower to reverse from more diagonal angles.
  reverseAngleTolerance: 0.5 * (Math.PI / 180), // Small tolerance for joystick and angle rounding near the threshold.
  reverseMaxSpeed: 24, // Below the 85 px/s ram threshold, so backing up never deals ram damage.
  // Tail-steering inside the lane: the stick aims the tail, the nose yaws after
  // it at this fraction of maxTurnRate (so mobility keeps scaling it) while the
  // chariot travels along its rear axle. 0.35 -> 42 deg/s, i.e. the lane's
  // widest offset (180 - reverseAngleThreshold = 45deg) swings in about 1.1s.
  reverseSteerFactor: 0.35,
});

function approach(value, target, amount) {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
}

function shortestAngleDifference(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// `handleObstacleImpact` owns what a rammed element does to the campaign (hull
// damage, or a felled tree); this controller only reports the impact and which
// element was in the way.
// A locked frame (the tutorial's card, which is a real pause) reads neutral
// controls rather than skipping the controller: the chariot coasts to a stop
// instead of the simulation freezing mid-stride with dust in the air and the bow
// half drawn. Module-level constants so a frozen frame allocates nothing.
const NO_KEYS = new Set();
const NO_STICK = Object.freeze({ x: 0, y: 0 });

export function createPlayerController({
  player, world, keys, touchInput, moveEntitySafely, handleObstacleImpact, obstacleAt, state,
}) {
  function readControls(delta, locked = false) {
    const held = locked ? NO_KEYS : keys;
    const stick = locked ? NO_STICK : touchInput;
    if (player.mode === "foot") {
      const horizontal = Math.max(-1, Math.min(1,
        Number(held.has("ArrowRight") || held.has("d") || held.has("D"))
        - Number(held.has("ArrowLeft") || held.has("a") || held.has("A"))
        + stick.x));
      const vertical = Math.max(-1, Math.min(1,
        Number(held.has("ArrowDown") || held.has("s") || held.has("S"))
        - Number(held.has("ArrowUp") || held.has("w") || held.has("W"))
        + stick.y));
      const length = Math.hypot(horizontal, vertical);
      const speed = 108;
      if (length > 0) {
        player.angle = Math.atan2(vertical, horizontal);
        player.speed = speed;
      } else {
        player.speed = 0;
      }
      moveEntitySafely(
        player,
        (horizontal / (length || 1) * speed + player.knockbackX) * delta,
        (vertical / (length || 1) * speed + player.knockbackY) * delta,
        player.radius,
      );
      player.knockbackX *= Math.max(0, 1 - 5 * delta);
      player.knockbackY *= Math.max(0, 1 - 5 * delta);
      return;
    }

    const inputX = clamp(
      Number(held.has("ArrowRight") || held.has("d") || held.has("D"))
      - Number(held.has("ArrowLeft") || held.has("a") || held.has("A"))
      + stick.x,
      -1,
      1,
    );
    const inputY = clamp(
      Number(held.has("ArrowDown") || held.has("s") || held.has("S"))
      - Number(held.has("ArrowUp") || held.has("w") || held.has("W"))
      + stick.y,
      -1,
      1,
    );
    const inputLength = Math.hypot(inputX, inputY);
    const inputMagnitude = Math.min(1, inputLength);
    const hasInput = inputLength > 0;
    const targetAngle = hasInput ? Math.atan2(inputY, inputX) : player.angle;
    const angleDifference = shortestAngleDifference(player.angle, targetAngle);
    // A small stick push behind the nose backs the chariot up instead of
    // spinning it around. The stick aims the tail, so `player.angle` yaws after
    // it slowly and the travel vector below rides the rear axle; firing, crew,
    // and ramming all keep following the nose.
    const isReverseWithoutTurning = hasInput
      && Math.abs(player.speed) < CHARIOT_CONTROL_CONFIG.reverseLowSpeedThreshold
      && inputMagnitude <= CHARIOT_CONTROL_CONFIG.reverseMaxInputMagnitude
      && Math.abs(angleDifference) + CHARIOT_CONTROL_CONFIG.reverseAngleTolerance
        >= CHARIOT_CONTROL_CONFIG.reverseAngleThreshold;

    if (isReverseWithoutTurning) {
      // Rear-axle steering: the nose rotates toward the heading that puts the
      // tail on the stick, capped so backing up curves instead of snapping.
      // Aligning grows `angleDifference`, so steering can never push the
      // chariot back out of the lane it just entered.
      const tailBearing = targetAngle + Math.PI;
      const bearingGap = shortestAngleDifference(player.angle, tailBearing);
      const maximumYaw = player.maxTurnRate * (Math.PI / 180)
        * CHARIOT_CONTROL_CONFIG.reverseSteerFactor * delta;
      const yaw = clamp(bearingGap, -maximumYaw, maximumYaw);
      // A stick exactly behind the nose leaves a sub-ulp gap; skipping the write
      // keeps `player.angle` bit-identical for a plain straight reverse.
      if (Math.abs(yaw) > 1e-9) {
        player.angle = Math.atan2(Math.sin(player.angle + yaw), Math.cos(player.angle + yaw));
      }
    }

    let isTurning = false;

    if (hasInput && !isReverseWithoutTurning) {
      const maximumTurn = player.maxTurnRate * (Math.PI / 180) * delta;
      const turnAmount = clamp(angleDifference, -maximumTurn, maximumTurn);
      isTurning = Math.abs(angleDifference) > CHARIOT_CONTROL_CONFIG.turnAngleThreshold;
      player.angle = Math.abs(angleDifference) <= maximumTurn
        ? targetAngle
        : player.angle + turnAmount;
      player.angle = Math.atan2(Math.sin(player.angle), Math.cos(player.angle));
    }

    const speedFactor = isTurning ? CHARIOT_CONTROL_CONFIG.turnSpeedFactor : 1;
    const targetSpeed = isReverseWithoutTurning
      ? Math.min(inputMagnitude * player.maxSpeed, CHARIOT_CONTROL_CONFIG.reverseMaxSpeed)
      : inputMagnitude * player.maxSpeed * speedFactor;
    const speedChange = inputMagnitude === 0 || targetSpeed < player.speed
      ? player.deceleration
      : player.acceleration;
    player.speed = approach(player.speed, targetSpeed, speedChange * delta);

    // Reverse travel follows the rear axle, so the chariot curves while the
    // nose swings instead of snapping onto the stick.
    const movementAngle = isReverseWithoutTurning ? player.angle + Math.PI : player.angle;
    const velocityX = Math.cos(movementAngle) * player.speed + player.knockbackX;
    const velocityY = Math.sin(movementAngle) * player.speed + player.knockbackY;
    const travelSpeed = Math.hypot(velocityX, velocityY);
    const previousX = player.x;
    const previousY = player.y;
    moveEntitySafely(
      player,
      velocityX * delta,
      velocityY * delta,
      player.radius,
    );
    player.knockbackX *= Math.max(0, 1 - 5 * delta);
    player.knockbackY *= Math.max(0, 1 - 5 * delta);
    player.impactCooldown = Math.max(0, player.impactCooldown - delta);
    if (player.x === previousX && player.y === previousY && travelSpeed > 1) {
      if (travelSpeed > 85 && player.impactCooldown === 0) {
        player.impactCooldown = 0.9;
        // Both axes were rejected - that is why the chariot did not move - and each
        // axis is tried on its own inside moveEntitySafely, so the element that
        // stopped it is under one of the two single-axis targets. Asking here is
        // what lets the impact shake (or fell) the very tree that was hit.
        const obstacle = obstacleAt(previousX + velocityX * delta, previousY, player.radius)
          ?? obstacleAt(previousX, previousY + velocityY * delta, player.radius);
        handleObstacleImpact({
          obstacle,
          x: player.x - (velocityX / travelSpeed) * 30,
          y: player.y - (velocityY / travelSpeed) * 30,
        });
        if (state.mode === "over") return;
      }
      player.speed = 0;
    }
  }

  return { readControls };
}
