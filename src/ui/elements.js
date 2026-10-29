// Single source of truth for DOM lookups. Anything the game relies on is
// declared here so a missing/renamed id fails loudly at boot instead of
// surfacing as a null dereference deep inside a frame.
const SELECTORS = {
  canvas: "#game",
  menuScreen: "#menu-screen",
  prologueScreen: "#prologue-screen",
  prologueNameElement: "#prologue-name",
  prologueBirthElement: "#prologue-birth",
  prologueNameLineElement: "#prologue-name-line",
  prologueClanElement: "#prologue-clan",
  prologueGivenElement: "#prologue-given",
  prologueAmbitionElement: "#prologue-ambition",
  // The sixth line, the one that names the stage the run will end on. It only
  // appears once the campaign has rolled a length (campaign.finalStage).
  prologueFinalElement: "#prologue-final",
  prologueStartButton: "#prologue-start",
  // The prologue's second door, left of 出征: the tiger drill
  // (src/game/tutorial.js) - a tutorial battle, not a stage of the run.
  prologueTutorialButton: "#prologue-tutorial",
  battleScreen: "#battle-screen",
  shopScreen: "#shop-screen",
  // 出征 is painted on the menu canvas, so this is the focus proxy the page keeps
  // on the painted rect: Tab reaches it, Enter presses it, and the click listener
  // in controls.js is the same one the DOM button had.
  menuStartButton: "#menu-start",
  // The home page is one canvas too (src/ui/menu.js): the card, the resting
  // countdown and the button are all painted, so the page only has to hand over
  // the element to draw in and the live region that announces the countdown.
  menuCanvas: "#menu-canvas",
  menuLiveElement: "#menu-live",
  // The shop is one canvas: the dossier, the ledger and the next-battle button
  // are all painted on it (src/ui/shop.js), so the page only has to hand over the
  // element to draw in and the live region that announces a purchase.
  shopCanvas: "#shop-canvas",
  shopLiveElement: "#shop-live",
  localeSelect: "#locale-select",
  scoreElement: "#score",
  waveElement: "#wave",
  goldElement: "#gold",
  modeElement: "#party-mode",
  hullLabelElement: "#hull-label",
  hullValueElement: "#hull-value",
  hullHealthElement: "#hull-health",
  overlay: "#game-overlay",
  overlayEyebrow: "#overlay-eyebrow",
  overlayTitle: "#overlay-title",
  overlayCopy: "#overlay-copy",
  overlayButton: "#overlay-button",
  // The victory card: its own overlay over the field, shown by the last stage
  // instead of the shop.
  victoryScreen: "#victory-screen",
  victoryEyebrow: "#victory-eyebrow",
  victoryTitle: "#victory-title",
  victorySubtitle: "#victory-subtitle",
  victoryStats: "#victory-stats",
  victoryNote: "#victory-note",
  victoryReturnButton: "#victory-return",
  startButton: "#start-button",
  startLabel: "#start-label",
  objectiveCountElement: "#objective-count",
  objectiveProgressElement: "#objective-progress",
  objectiveLabelElement: "#objective-label",
  extractionGuideElement: "#extraction-guide",
  extractionArrowElement: "#extraction-arrow",
  extractionDistanceElement: "#extraction-distance",
  // The guide's caption. It says what the arrow is pointing at, which is the
  // extraction point on a campaign stage and the tutorial's target in the drill.
  guideLabelElement: "#extraction-guide-label",
  touchPadElement: "#touch-pad",
  touchHintElement: "#touch-hint",
  touchControlsElement: ".touch-controls",
  touchJoystickElement: "#touch-joystick",
  touchJoystickKnob: "#touch-joystick-knob",
  touchFireElement: ".touch-fire",
  bossWarningElement: "#boss-warning",
  bossWarningTitleElement: "#boss-warning-title",
  bossWarningSubtitleElement: "#boss-warning-subtitle",
  soundButton: "#sound-button",
  soundIcon: "#sound-icon",
  fatalErrorElement: "#fatal-error",
  fatalErrorCopyElement: "#fatal-error-copy",
  fatalErrorReloadButton: "#fatal-error-reload",
};

export function getGameElements() {
  const elements = {};
  const missing = [];
  for (const [name, selector] of Object.entries(SELECTORS)) {
    const element = document.querySelector(selector);
    if (!element) missing.push(`${selector} (${name})`);
    elements[name] = element;
  }
  if (missing.length > 0) {
    throw new Error(`Missing required page elements: ${missing.join(", ")}`);
  }
  return elements;
}
