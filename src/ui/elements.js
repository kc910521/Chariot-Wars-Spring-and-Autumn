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
  battleScreen: "#battle-screen",
  shopScreen: "#shop-screen",
  menuStartButton: "#menu-start",
  // The resting card that stands where 出征 would be while the post-victory lock
  // is live: a headline with the countdown and a line about the run that earned
  // it, and nothing to press.
  menuLockElement: "#menu-lock",
  menuLockTitleElement: "#menu-lock-title",
  menuLockDetailElement: "#menu-lock-detail",
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
