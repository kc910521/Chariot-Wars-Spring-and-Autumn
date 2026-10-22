export function updateCamera({ player, world, view, camera }, delta) {
  const targetX = Math.max(0, Math.min(world.width - view.width, player.x - view.width / 2));
  const targetY = Math.max(0, Math.min(world.height - view.height, player.y - view.height / 2));
  const easing = 1 - Math.exp(-7 * delta);
  camera.x += (targetX - camera.x) * easing;
  camera.y += (targetY - camera.y) * easing;
}
