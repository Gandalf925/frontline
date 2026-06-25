const PROFILES = Object.freeze({
  full: Object.freeze({ renderHz: 40, simulationHz: 30, civilizationHz: 4, uiHz: 4, maxDpr: 1.35, maxCatchUpSteps: 5 }),
  balanced: Object.freeze({ renderHz: 24, simulationHz: 20, civilizationHz: 4, uiHz: 2, maxDpr: 1, maxCatchUpSteps: 4 }),
  minimal: Object.freeze({ renderHz: 18, simulationHz: 12, civilizationHz: 2, uiHz: 2, maxDpr: 0.75, maxCatchUpSteps: 3 })
});

export function performanceProfile(quality = 'balanced') {
  return PROFILES[quality] ?? PROFILES.balanced;
}
