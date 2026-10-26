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
  prologueStartButton: "#prologue-start",
  battleScreen: "#battle-screen",
  shopScreen: "#shop-screen",
  menuStartButton: "#menu-start",
  nextBattleButton: "#next-battle",
  shopItemsElement: "#shop-items",
  shopStatsElement: "#shop-stats",
  shopRigCanvas: "#shop-rig",
  shopCampCanvas: "#shop-camp",
  shopRigCaptionElement: "#shop-rig-caption",
  shopCampCaptionElement: "#shop-camp-caption",
  shopInfoElement: "#shop-info",
  localeSelect: "#locale-select",
  shopGoldElement: "#shop-gold",
  shopScoreElement: "#shop-score",
  shopKillsElement: "#shop-kills",
  shopStageElement: "#shop-stage",
  shopLocationElement: "#shop-location",
  shopMessageElement: "#shop-message",
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
  startButton: "#start-button",
  startLabel: "#start-label",
  objectiveCountElement: "#objective-count",
  objectiveProgressElement: "#objective-progress",
  objectiveLabelElement: "#objective-label",
  extractionGuideElement: "#extraction-guide",
  extractionArrowElement: "#extraction-arrow",
  extractionDistanceElement: "#extraction-distance",
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
