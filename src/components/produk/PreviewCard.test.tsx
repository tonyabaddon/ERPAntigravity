import { describe, it, expect } from 'vitest';

function computeMargin(price: number, modal: number | null) {
  return modal && price ? ((price - modal) / price) * 100 : null;
}

describe('margin computation', () => {
  it('returns null when modal is null', () => {
    expect(computeMargin(125000, null)).toBeNull();
  });
  it('returns positive margin when modal < price', () => {
    expect(computeMargin(125000, 98500)).toBeCloseTo(21.2, 0);
  });
  it('returns negative when modal > price', () => {
    expect(computeMargin(100, 120)).toBeCloseTo(-20, 0);
  });
});
