export const CHARIOT_CONTROL_CONFIG = Object.freeze({
  maxSpeed: 170, // Increase for a faster top speed.
  acceleration: 230, // Increase for quicker speed build-up.
  deceleration: 180, // Increase to stop faster when the joystick is centered.
  maxTurnRate: 120, // Degrees per second; increase for faster heading changes.
  turnSpeedFactor: 0.62, // Lower to lose more speed during sharp turns.
  turnAngleThreshold: 0.08, // Radians; lower to keep turn slowdown active longer.
  reverseLowSpeedThreshold: 32, // Increase to allow reverse-step input at higher speeds.
  reverseMaxInputMagnitude: 0.35, // Increase to make the no-turn reverse zone easier to reach.
  reverseAngleThreshold: 160 * (Math.PI / 180), // Lower to allow reverse movement from more diagonal angles.
  reverseAngleTolerance: 0.5 * (Math.PI / 180), // Small tolerance for joystick and angle rounding near the threshold.
  reverseMaxSpeed: 24, // Increase for faster backward repositioning without turning.
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function approach(value, target, amount) {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
}

function shortestAngleDifference(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function createPlayerController({ player, world, keys, touchInput, moveEntitySafely, damagePlayer, state }) {
  function readControls(delta) {
    if (player.mode === "foot") {
      const horizontal = Math.max(-1, Math.min(1,
        Number(keys.has("ArrowRight") || keys.has("d") || keys.has("D"))
        - Number(keys.has("ArrowLeft") || keys.has("a") || keys.has("A"))
        + touchInput.x));
      const vertical = Math.max(-1, Math.min(1,
        Number(keys.has("ArrowDown") || keys.has("s") || keys.has("S"))
        - Number(keys.has("ArrowUp") || keys.has("w") || keys.has("W"))
        + touchInput.y));
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
      Number(keys.has("ArrowRight") || keys.has("d") || keys.has("D"))
      - Number(keys.has("ArrowLeft") || keys.has("a") || keys.has("A"))
      + touchInput.x,
      -1,
      1,
    );
    const inputY = clamp(
      Number(keys.has("ArrowDown") || keys.has("s") || keys.has("S"))
      - Number(keys.has("ArrowUp") || keys.has("w") || keys.has("W"))
      + touchInput.y,
      -1,
      1,
    );
    const inputLength = Math.hypot(inputX, inputY);
    const inputMagnitude = Math.min(1, inputLength);
    const hasInput = inputLength > 0;
    const targetAngle = hasInput ? Math.atan2(inputY, inputX) : player.angle;
    const angleDifference = shortestAngleDifference(player.angle, targetAngle);
    const isReverseWithoutTurning = hasInput
      && Math.abs(player.speed) < CHARIOT_CONTROL_CONFIG.reverseLowSpeedThreshold
      && inputMagnitude <= CHARIOT_CONTROL_CONFIG.reverseMaxInputMagnitude
      && Math.abs(angleDifference) + CHARIOT_CONTROL_CONFIG.reverseAngleTolerance
        >= CHARIOT_CONTROL_CONFIG.reverseAngleThreshold;
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

    const movementAngle = isReverseWithoutTurning ? targetAngle : player.angle;
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
        damagePlayer(8, player.x - (velocityX / travelSpeed) * 30, player.y - (velocityY / travelSpeed) * 30);
        if (state.mode === "over") return;
      }
      player.speed = 0;
    }
  }

  return { readControls };
}
