import { findLineGround, planTigerGround } from "./tutorial-map.js";

// 猛虎下山 - "the tiger descends the mountain". The drill that opens a run: two
// encounters on one battlefield, with the camera doing the teaching.
//
// This module is orchestration and nothing else. It owns the step machine, the
// two pans and the two cards; it spawns through the enemy system's scenario entry
// points (spawnWildAnimal / spawnPreset) and paints nothing - the card is drawn on
// the canvas by src/render/tutorial-overlay.js, and the objective and guide arrow
// are the HUD's, reading `state.tutorial`.
//
// The scene, in the order the player meets it:
//
//   brief   a card: how the chariot drives and fires.        (field frozen)
//   hunt    the tiger is loose on the field; get to it.       (objective arrow)
//   pan     it is dead, a line of troops forms out of view.   (camera pans)
//   tactics a card: ram the line with the escort behind it.   (field frozen)
//   return  the camera comes back to the chariot.             (camera pans back)
//   engage  fight the line; the extraction opens on the last. (objective arrow)
//
// Freezing is a real pause, not a hidden HUD: the frame skips unit and projectile
// updates while a card or a pan is up (see the gate in src/game/game.js). Without
// it the off-screen archers would already be loosing arrows at a chariot the
// player is not allowed to steer.
const PAN_SECONDS = 1.7;
const RETURN_SECONDS = 1.5;

export function createTutorial({ state, player, world, campaign, enemySystem, updateHud }) {
  // Which battle the tutorial was armed for. `arm()` runs on every entry into
  // "running" - a pause, a language switch, a tab that regained focus - and the
  // opening beat must only happen once per battle.
  let armedBattleId = -1;

  function arm() {
    if (state.battleMode !== "tutorial") return;
    if (state.tutorial !== null) return;
    if (armedBattleId === state.battleId) return;
    armedBattleId = state.battleId;

    const tigerSpot = planTigerGround(world, player);
    const tiger = enemySystem.spawnWildAnimal("tiger", {
      x: tigerSpot.x,
      y: tigerSpot.y,
      angle: Math.atan2(player.y - tigerSpot.y, player.x - tigerSpot.x),
    });

    state.tutorial = {
      step: "brief",
      timer: 0,
      frozen: true,
      overlay: { titleKey: "tutorial.brief.title", bodyKeys: ["tutorial.brief.drive", "tutorial.brief.fire"] },
      objective: null,
      hud: { labelKey: "tutorial.huntLabel", count: 0, total: 1 },
      // The tiger's ground is fixed for the battle (it is on the field from the
      // start); the line's is decided when the tiger dies, against wherever
      // beginLine() finds the chariot then.
      tigerSpot,
      lineSpot: null,
      tiger,
      formation: null,
      line: [],
    };
    state.cameraFocus = null;
    updateHud();
  }

  function setStep(step, patch = {}) {
    const tutorial = state.tutorial;
    tutorial.step = step;
    tutorial.timer = 0;
    tutorial.overlay = patch.overlay ?? null;
    tutorial.objective = patch.objective ?? null;
    if (patch.hud) tutorial.hud = patch.hud;
    // A card is a pause, and so is a pan: during a pan the camera is looking at
    // troops the player cannot steer towards yet.
    tutorial.frozen = Boolean(tutorial.overlay) || step === "pan" || step === "return";
    state.cameraFocus = patch.cameraFocus ?? null;
    updateHud();
  }

  // The tiger is down: the drill line forms out of view and the camera goes to
  // look at it. "Out of view" is measured from where the chariot is standing
  // *now*, not from where it started: the animal runs, so a player who chased it
  // across the field would otherwise be panned back to the corner they spawned
  // in, with the fight happening behind them. findLineGround() (tutorial-map.js)
  // prefers the authored bearing and distance and falls back down a fixed ladder,
  // so the spot is deterministic for a given field and standing place.
  function beginLine() {
    const tutorial = state.tutorial;
    const spot = findLineGround(player, {
      world,
      obstacles: campaign.obstacles,
      radius: player.radius,
    });
    tutorial.lineSpot = spot;
    const formation = enemySystem.spawnPreset("tutorialLine", {
      x: spot.x,
      y: spot.y,
      heading: spot.heading,
    });
    tutorial.formation = formation;
    tutorial.line = state.enemies.filter((unit) => unit.formationId === formation.id);
    setStep("pan", {
      hud: { labelKey: "tutorial.lineLabel", count: 0, total: tutorial.line.length },
      cameraFocus: { x: spot.x, y: spot.y },
    });
  }

  // Where the objective arrow points during the fight: the living middle of the
  // line. Recomputed rather than fixed at the spawn spot, so the arrow keeps
  // pointing at the ranks that are left once the chariot has driven through the
  // first ones - and a line that has lost its near flank reads as "over there
  // now" instead of as a stale marker on empty ground.
  function liveLineFocus(tutorial) {
    let x = 0;
    let y = 0;
    let count = 0;
    for (const unit of tutorial.line) {
      if (unit.destroyed) continue;
      x += unit.x;
      y += unit.y;
      count += 1;
    }
    if (count === 0) return { x: tutorial.lineSpot.x, y: tutorial.lineSpot.y };
    return { x: x / count, y: y / count };
  }

  function update(delta) {
    const tutorial = state.tutorial;
    if (!tutorial) return;
    tutorial.timer += delta;

    if (tutorial.step === "hunt") {
      const tiger = tutorial.tiger;
      if (!tiger || tiger.destroyed) {
        tutorial.hud.count = tutorial.hud.total;
        beginLine();
        return;
      }
      // The arrow follows the animal, so it keeps pointing at a tiger that has
      // charged past the chariot.
      tutorial.objective = { x: tiger.x, y: tiger.y };
      return;
    }

    if (tutorial.step === "pan") {
      if (tutorial.timer < PAN_SECONDS) return;
      setStep("tactics", {
        overlay: {
          titleKey: "tutorial.tactics.title",
          // Three beats, one per thing actually standing in the line: the
          // infantry that holds, the archers behind them that shoot the horses,
          // and the chariot that challenges and then runs. The copy is a
          // description of this preset's brains, not a general tutorial.
          bodyKeys: [
            "tutorial.tactics.infantry",
            "tutorial.tactics.archers",
            "tutorial.tactics.chariot",
          ],
        },
        cameraFocus: tutorial.lineSpot,
      });
      return;
    }

    if (tutorial.step === "return") {
      if (tutorial.timer < RETURN_SECONDS) return;
      setStep("engage", { objective: liveLineFocus(tutorial) });
      return;
    }

    if (tutorial.step === "engage") {
      // Counted rather than filtered: this runs every frame of the fight.
      let fallen = 0;
      for (const unit of tutorial.line) if (unit.destroyed) fallen += 1;
      tutorial.hud.count = fallen;
      if (fallen < tutorial.line.length) {
        tutorial.objective = liveLineFocus(tutorial);
        return;
      }
      // The kill count is the extraction trigger, exactly as on a campaign stage:
      // the tiger plus the nine ranks is the objective target stages.js set.
      campaign.tutorialHandoff = true;
      state.tutorial = null;
      state.cameraFocus = null;
      updateHud();
    }
  }

  // One card's "understood". Enter, Space, the card's own button and a click on it
  // all land here; nothing else does while a card is up.
  function confirm() {
    const tutorial = state.tutorial;
    if (!tutorial || !tutorial.overlay) return;
    if (tutorial.step === "brief") {
      setStep("hunt", { objective: { x: tutorial.tiger.x, y: tutorial.tiger.y } });
      return;
    }
    if (tutorial.step === "tactics") {
      // The camera walks back to where the chariot has been waiting; the line
      // stays where it formed, so the fight opens with the player driving at it.
      setStep("return", { hud: tutorial.hud });
    }
  }

  return { arm, update, confirm };
}
