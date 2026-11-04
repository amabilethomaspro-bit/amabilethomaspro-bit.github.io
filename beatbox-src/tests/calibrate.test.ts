import { describe as group, it, expect } from 'vitest';
import {
  classifyByCalibration,
  calibrationReady,
  type Calibration,
  type FeatureVec,
} from '../src/analysis';

// Exemples typiques : kick = grave (low haut, centroid bas), charley = aigu
// (high haut, centroid haut), caisse claire = au milieu.
const cal: Calibration = {
  kick: [
    { low: 0.6, centroid: 900, high: 0.02 },
    { low: 0.55, centroid: 1100, high: 0.03 },
  ],
  snare: [
    { low: 0.2, centroid: 3500, high: 0.2 },
    { low: 0.18, centroid: 4000, high: 0.25 },
  ],
  hihat: [
    { low: 0.02, centroid: 9000, high: 0.7 },
    { low: 0.03, centroid: 8500, high: 0.65 },
  ],
};

group('classification par calibrage', () => {
  it('reconnait chaque son par ressemblance avec les exemples', () => {
    const kick: FeatureVec = { low: 0.58, centroid: 1000, high: 0.02 };
    const snare: FeatureVec = { low: 0.19, centroid: 3700, high: 0.22 };
    const hat: FeatureVec = { low: 0.025, centroid: 8800, high: 0.68 };
    expect(classifyByCalibration(kick, cal)).toBe('kick');
    expect(classifyByCalibration(snare, cal)).toBe('snare');
    expect(classifyByCalibration(hat, cal)).toBe('hihat');
  });

  it('rattrape un kick de voix faible en grave que les seuils fixes rateraient', () => {
    // low = 0.28 < seuil kick 0.35 -> la regle fixe dirait "snare", mais c'est
    // bien plus proche des exemples de kick de l'utilisateur.
    const voixKick: FeatureVec = { low: 0.28, centroid: 1050, high: 0.03 };
    expect(classifyByCalibration(voixKick, cal)).toBe('kick');
  });

  it('calibrationReady exige au moins un exemple par son', () => {
    expect(calibrationReady(cal)).toBe(true);
    expect(calibrationReady({ kick: [], snare: cal.snare, hihat: cal.hihat })).toBe(false);
  });

  it('renvoie null sans aucun exemple', () => {
    expect(classifyByCalibration({ low: 0.5, centroid: 1000, high: 0 }, { kick: [], snare: [], hihat: [] })).toBeNull();
  });
});
