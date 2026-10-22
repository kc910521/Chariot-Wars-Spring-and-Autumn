export function addBloodStain(state, random, x, y, radius, heavy = false) {
  const drops = [];
  const count = heavy ? 10 : 5;
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * radius * (heavy ? 1.8 : 1.2);
    drops.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      size: 1 + random() * (heavy ? 3.5 : 2),
    });
  }
  state.bloodStains.push({
    x,
    y,
    rotation: random() * Math.PI * 2,
    width: radius * (heavy ? 1.2 : 0.8),
    height: radius * (heavy ? 0.62 : 0.42),
    color: heavy ? "rgba(91, 25, 21, 0.66)" : "rgba(118, 31, 26, 0.53)",
    drops,
  });
  if (state.bloodStains.length > 180) state.bloodStains.shift();
}
