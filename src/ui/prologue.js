import { translate } from "../i18n/index.js";

// The prologue is one story in five lines: when the player was born, what they
// are called, why the clan carries its name, why the given name was chosen, and
// what they mean to do about it — plus, once the campaign knows how long it will
// run, where that story is going to end. The two reason lines come straight from
// the rolled rows, so a new name in the data grows its own story without new copy.
//
// Only the sentences are translated: the name itself is data - Chinese
// characters, the same in every locale - so it is interpolated raw and never
// passed through a lookup.
export function prologueLines(identity, finalStage = 0, t = translate) {
  if (!identity) return [];
  const lines = [
    { slot: "birth", text: t("prologue.birth") },
    { slot: "name", text: t("prologue.name", { name: identity.fullName }) },
    { slot: "clan", text: t(identity.clanReasonKey) },
    { slot: "given", text: t(identity.givenReasonKey) },
    { slot: "ambition", text: t("prologue.ambition") },
  ];
  if (finalStage > 0) lines.push({ slot: "final", text: t("prologue.final", { stage: finalStage }) });
  return lines;
}

export function createPrologue({ elements, getFinalStage = () => 0 }) {
  const nameplate = elements.prologueNameElement;
  const lineElements = {
    birth: elements.prologueBirthElement,
    name: elements.prologueNameLineElement,
    clan: elements.prologueClanElement,
    given: elements.prologueGivenElement,
    ambition: elements.prologueAmbitionElement,
    final: elements.prologueFinalElement,
  };
  let identity = null;

  // Resolved per paint, not cached: a language switch re-reads the same story
  // without rolling a new name, which is why the identity lives on `campaign`.
  function paint() {
    if (!identity) return;
    nameplate.textContent = identity.fullName;
    const finalStage = getFinalStage();
    for (const { slot, text } of prologueLines(identity, finalStage)) {
      lineElements[slot].textContent = text;
    }
    // A campaign that has not rolled its ending yet leaves the sixth line hidden
    // instead of showing an empty paragraph and its margin.
    lineElements.final.hidden = finalStage <= 0;
  }

  function show(nextIdentity) {
    identity = nextIdentity;
    paint();
  }

  return { show, paint };
}
