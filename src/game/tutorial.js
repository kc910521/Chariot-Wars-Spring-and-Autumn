import { formationOrders } from "../data/formations.js";
import { findLineGround, findSquadGround, findWaveGround, planTigerGround } from "./tutorial-map.js";

// 猛虎下山 - "the tiger descends the mountain". The drill that opens a run: three
// encounters on one battlefield, with the camera doing the teaching.
//
// This module is orchestration and nothing else. It owns the step machine, the
// three pans and the four cards; it spawns through the systems' scenario entry
// points (spawnWildAnimal / spawnPreset for the rebels, spawnScenarioLine for the
// clan's loan) and paints nothing - a card is announced through `onOverlay` and
// drawn as DOM by src/ui/battle-card.js (the same card the pause, defeat and
// victory screens use), and the objective and guide arrow are the HUD's, reading
// `state.tutorial`.
//
// The scene, in the order the player meets it:
//
//   brief   a card: how the chariot drives and fires.        (field frozen)
//   hunt    the tiger is loose on the field; get to it.       (objective arrow)
//   pan     it is dead, a line of troops forms out of view.   (camera pans)
//   tactics a card: ram the line with the escort behind it.   (field frozen)
//   return  the camera comes back to the chariot.             (camera pans back)
//   engage  fight the line.                                   (objective arrow)
//   muster  it is broken; the clan has lent him eight men.    (card, camera pans)
//   orders  stand in their ring and give 出击, then 结阵.       (objective arrow)
//   settle  the banner beats once while the ranks close.      (objective arrow)
//   arrive  the second band forms, twice the first.           (camera pans)
//   squadEngage beat it with the squad at his back.           (objective arrow)
//
// The squad is a *loan*, not a purchase: it belongs to nobody (`formation.tier`
// is -1), `campaign.friendlyFormations` is never touched, and `finish()` takes it
// back off the field. The drill ends when both bands are destroyed - that, and not
// a body count, is what opens the extraction (see `finish` and the gate in
// src/game/game.js).
//
// Freezing is a real pause, not a hidden HUD: the frame skips unit and projectile
// updates while a card or a pan is up (see the gate in src/game/game.js). Without
// it the off-screen archers would already be loosing arrows at a chariot the
// player is not allowed to steer.
const PAN_SECONDS = 1.7;
const RETURN_SECONDS = 1.5;
// The second band's pan is shorter than the first: it forms in the same quarter
// the first one did, 900px out, and it is the third time the camera has walked
// away in one drill.
const ARRIVE_SECONDS = 1.2;
// One beat of the banner (`formationAura.interval` is 3s, so this is deliberately
// less than a full beat): the card promised the ring mends the line, and the
// settle is the beat that shows it without making the player wait for one.
const SETTLE_SECONDS = 1.2;
// While one of these is up the camera is looking at ground the player cannot
// steer towards yet, so the field waits.
const PAN_STEPS = new Set(["pan", "return", "arrive"]);

export function createTutorial({
  state, player, world, campaign, enemySystem, updateHud, onOverlay = () => {},
  // The clan's squad is the ally system's, not the enemy system's: these two are
  // wired through `alliesRef` in src/game/game.js (the tutorial is built before
  // the ally system is, exactly like `damageAlly`).
  spawnScenarioLine, despawnScenarioLine,
}) {
  // Which battle the tutorial was armed for. `arm()` runs on every entry into
  // "running" - a pause, a language switch, a tab that regained focus - and the
  // opening beat must only happen once per battle.
  let armedBattleId = -1;

  // The one thing this module says about its cards: which beat's card is up, or
  // null. Called once per beat rather than per frame, so the card is painted when
  // the beat changes and never while the field is running.
  function announceCard() {
    onOverlay(state.tutorial?.overlay ?? null);
  }

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
      // start); every line's is decided when the beat before it ends, against
      // wherever the chariot is standing then.
      tigerSpot,
      lineSpot: null,
      tiger,
      formation: null,
      line: [],
      // The clan's loan and the band it is for: the formations are the handles
      // (a line leaves `state.allyFormations` the frame its last body falls), the
      // arrays are the bodies the script counts and the arrow follows.
      squadFormation: null,
      squad: [],
      waveFormation: null,
      wave: [],
      // What the player has actually told the squad, in order: the drill waits for
      // 出击 and then for 结阵, and neither is inferred from the field. The order
      // button only ever toggles, so a 结阵 that follows an 出击 is a fact about
      // this pair of presses and not about the line's resting state.
      ordered: { march: false, hold: false },
    };
    state.cameraFocus = null;
    updateHud();
    announceCard();
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
    tutorial.frozen = Boolean(tutorial.overlay) || PAN_STEPS.has(step);
    state.cameraFocus = patch.cameraFocus ?? null;
    updateHud();
    announceCard();
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

  // Where an objective arrow points during a fight: the living middle of a line.
  // Recomputed rather than fixed at the spawn spot, so the arrow keeps pointing at
  // the ranks that are left once the chariot has driven through the first ones -
  // and a line that has lost its near flank reads as "over there now" instead of
  // as a stale marker on empty ground. With nobody left, it falls back to where the
  // formation itself stands.
  function liveFocus(bodies, formation) {
    let x = 0;
    let y = 0;
    let count = 0;
    for (const unit of bodies) {
      if (unit.destroyed) continue;
      x += unit.x;
      y += unit.y;
      count += 1;
    }
    if (count === 0) return { x: formation.x, y: formation.y };
    return { x: x / count, y: y / count };
  }

  // The first band is broken, and the drill is not over: the clan's men ride in.
  //
  // They are not a purchase and not a campaign line - `spawnScenarioLine` builds
  // them on the ground the map promises, and `campaign.friendlyFormations` is
  // never read, so the hire ladder cannot be skipped or paid for by playing the
  // drill. The camera goes to the muster because the player has never been given
  // a line before and this is where he learns he has one.
  function beginSquad() {
    const tutorial = state.tutorial;
    const spot = findSquadGround(player, {
      world,
      obstacles: campaign.obstacles,
      radius: player.radius,
    });
    const formation = spawnScenarioLine("tutorialSquad", {
      x: spot.x,
      y: spot.y,
      heading: spot.heading,
    });
    tutorial.squadFormation = formation;
    tutorial.squad = state.allies.filter((ally) => ally.formationId === formation.id);
    setStep("muster", {
      overlay: {
        titleKey: "tutorial.muster.title",
        // Two beats: the loan itself, then the two orders that are the whole of
        // what a line answers. The card is where the player meets 出击 / 结阵;
        // the button itself only appears once he is standing in the ring.
        bodyKeys: ["tutorial.muster.clan", "tutorial.muster.orders"],
      },
      hud: { labelKey: "tutorial.orderLabel", count: 0, total: 2 },
      cameraFocus: { x: spot.x, y: spot.y },
    });
  }

  // The second band, and the last encounter of the drill.
  //
  // It forms where the first band did - the same quarter of the field, 900px off -
  // but placed against the chariot's live position like every other line here, and
  // asked to keep off the ground the borrowed squad is standing on (the squad is
  // still on the field, and two footprints on the same ground interpenetrate for
  // the rest of the battle).
  function beginWave() {
    const tutorial = state.tutorial;
    const spot = findWaveGround(player, {
      world,
      obstacles: campaign.obstacles,
      radius: player.radius,
      avoid: tutorial.squadFormation ? [tutorial.squadFormation] : [],
    });
    const formation = enemySystem.spawnPreset("tutorialWave", {
      x: spot.x,
      y: spot.y,
      heading: spot.heading,
    });
    tutorial.waveFormation = formation;
    tutorial.wave = state.enemies.filter((unit) => unit.formationId === formation.id);
    setStep("arrive", {
      hud: { labelKey: "tutorial.squadLabel", count: 0, total: tutorial.wave.length },
      cameraFocus: { x: spot.x, y: spot.y },
    });
  }

  // Whether the borrowed line is still a line: somebody alive in it, and the
  // formation still on the field. The ally system drops a formation the frame its
  // last body falls (allies.js), so a missing id is the same answer as an empty
  // roster - and either way the drill has to go on rather than wait for orders
  // nobody is left to take.
  function squadStaffed(tutorial) {
    const formation = tutorial.squadFormation;
    if (!formation) return false;
    if (!state.allyFormations.includes(formation)) return false;
    return tutorial.squad.some((ally) => !ally.destroyed);
  }

  // Both bands are destroyed: the drill is over and the extraction opens.
  //
  // The squad was a loan, so it goes home first - `despawnScenarioLine` takes the
  // bodies and the formation off the field, which is why the shop, the next stage
  // and `campaign.friendlyFormations` never see eight men nobody bought. Clearing
  // `state.tutorial` is the whole of "the scenario is done": the extraction gate
  // in src/game/game.js is the old kill rule with a scenario veto on it, and from
  // here there is no scenario left to veto.
  function finish() {
    const tutorial = state.tutorial;
    if (tutorial.squadFormation) despawnScenarioLine(tutorial.squadFormation);
    campaign.tutorialHandoff = true;
    state.tutorial = null;
    state.cameraFocus = null;
    updateHud();
    announceCard();
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
      setStep("engage", { objective: liveFocus(tutorial.line, tutorial.formation) });
      return;
    }

    if (tutorial.step === "engage") {
      // Counted rather than filtered: this runs every frame of the fight.
      let fallen = 0;
      for (const unit of tutorial.line) if (unit.destroyed) fallen += 1;
      tutorial.hud.count = fallen;
      if (fallen < tutorial.line.length) {
        tutorial.objective = liveFocus(tutorial.line, tutorial.formation);
        return;
      }
      // The band is broken, but the drill is not: the clan's loan is the next
      // beat. `state.tutorial` stays set, which is what keeps the extraction shut.
      beginSquad();
      return;
    }

    if (tutorial.step === "muster") return;

    if (tutorial.step === "orders") {
      // The squad can be destroyed between the muster and the first order - a
      // vanguard chariot that broke off, a counter-charge - and the drill must not
      // stall on a line nobody is left to command: the second band is the rest of
      // the scenario, and it arrives either way.
      if (!squadStaffed(tutorial)) {
        beginWave();
        return;
      }
      if (tutorial.ordered.hold) {
        // 结阵 has landed: the ring is down in front of the player and the banner
        // gets one beat to close the ranks before the second band forms.
        tutorial.hud = { labelKey: "tutorial.orderLabel", count: 2, total: 2 };
        setStep("settle", { hud: tutorial.hud });
        return;
      }
      tutorial.hud.count = tutorial.ordered.march ? 1 : 0;
      tutorial.objective = liveFocus(tutorial.squad, tutorial.squadFormation);
      return;
    }

    if (tutorial.step === "settle") {
      // One breath of the banner while the ranks close, then the second band.
      if (!squadStaffed(tutorial)) {
        beginWave();
        return;
      }
      tutorial.objective = liveFocus(tutorial.squad, tutorial.squadFormation);
      if (tutorial.timer < SETTLE_SECONDS) return;
      beginWave();
      return;
    }

    if (tutorial.step === "arrive") {
      if (tutorial.timer < ARRIVE_SECONDS) return;
      setStep("squadEngage", { objective: liveFocus(tutorial.wave, tutorial.waveFormation) });
      return;
    }

    if (tutorial.step === "squadEngage") {
      let fallen = 0;
      for (const unit of tutorial.wave) if (unit.destroyed) fallen += 1;
      if (fallen < tutorial.wave.length) {
        tutorial.hud.count = fallen;
        tutorial.objective = liveFocus(tutorial.wave, tutorial.waveFormation);
        return;
      }
      // Both bands destroyed. This - and not the kill count - is what ends the
      // drill: the counter in `tutorial.hud` is the HUD's, never the gate.
      tutorial.hud.count = tutorial.hud.total;
      finish();
    }
  }

  // A press of 出击 or 结阵, reported by the layer that gave it (`onFormationOrder`
  // in src/game/game.js - the one place an order can be given, exactly as
  // `confirm()` is the one place a card can be).
  //
  // The presses are counted rather than inferred from the line: the button toggles,
  // so a player may give 出击 and 结阵 between two frames, and the line's resting
  // state cannot tell "both were pressed" from "nobody touched it". 结阵 before
  // 出击 is ignored - the drill teaches them in that order, and a 结阵 the player
  // found on his own is not the beat that was asked for.
  function noteOrder({ formation, action } = {}) {
    const tutorial = state.tutorial;
    if (!tutorial || tutorial.step !== "orders") return false;
    if (formation !== tutorial.squadFormation) return false;
    if (action === formationOrders.MARCH) {
      if (tutorial.ordered.march) return false;
      tutorial.ordered.march = true;
      return true;
    }
    if (!tutorial.ordered.march || tutorial.ordered.hold) return false;
    tutorial.ordered.hold = true;
    return true;
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
      return;
    }
    if (tutorial.step === "muster") {
      // The camera comes back to the chariot and the arrow points at the ring: the
      // player has to drive into his own line before it will take an order
      // (`commandedFormation` only answers from inside the footprint), so the
      // objective is the squad and not the enemy.
      setStep("orders", {
        objective: { x: tutorial.squadFormation.x, y: tutorial.squadFormation.y },
        hud: tutorial.hud,
      });
    }
  }

  return { arm, update, confirm, noteOrder };
}
