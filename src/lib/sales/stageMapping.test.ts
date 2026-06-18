import { describe, test, expect } from 'vitest';
import { getSubStageMeta, SUB_STAGES, isUrgentSubStage, getSubStagesForStage } from './stageMapping';

describe('stageMapping', () => {
  test('SUB_STAGES has 20 entries', () => {
    expect(SUB_STAGES.length).toBe(20);
  });
  test('getSubStageMeta returns urgent for 2b', () => {
    expect(getSubStageMeta('2b').actionType).toBe('urgent');
  });
  test('getSubStageMeta returns passive for 2c', () => {
    expect(getSubStageMeta('2c').actionType).toBe('passive');
  });
  test('3f belongs to CP/RP only', () => {
    expect(getSubStageMeta('3f').forTypes).toEqual(['CUSTOM_PANEL', 'RAKIT_PANEL']);
  });
  test('isUrgentSubStage works', () => {
    expect(isUrgentSubStage('2b')).toBe(true);
    expect(isUrgentSubStage('1a')).toBe(false);
  });
  test('getSubStagesForStage(3) returns 8 entries', () => {
    expect(getSubStagesForStage(3).length).toBe(8);
  });
});
