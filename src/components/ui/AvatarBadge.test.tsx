import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AvatarBadge } from './AvatarBadge';

describe('AvatarBadge', () => {
  it('renders <img> when avatarUrl provided (non-empty)', () => {
    const { container } = render(<AvatarBadge name="X" avatarUrl="https://a.com/b.jpg" />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('https://a.com/b.jpg');
  });

  it('renders male SVG when gender=M and no avatarUrl', () => {
    const { getByRole } = render(<AvatarBadge name="Budi" gender="M" />);
    expect(getByRole('img', { name: 'Avatar cowok' })).toBeTruthy();
  });

  it('renders female SVG when gender=F', () => {
    const { getByRole } = render(<AvatarBadge name="Siti" gender="F" />);
    expect(getByRole('img', { name: 'Avatar cewek' })).toBeTruthy();
  });

  it('renders neutral SVG when gender=N', () => {
    const { getByRole } = render(<AvatarBadge name="X" gender="N" />);
    expect(getByRole('img', { name: 'Avatar netral' })).toBeTruthy();
  });

  it('falls back to initials when gender undefined + no avatarUrl', () => {
    const { getByText } = render(<AvatarBadge name="Rina" />);
    expect(getByText('R')).toBeTruthy();
  });

  it('prefers avatarUrl over gender', () => {
    const { container } = render(<AvatarBadge name="X" gender="M" avatarUrl="https://a.com/b.jpg" />);
    expect(container.querySelector('img')).toBeTruthy();
    expect(container.querySelector('[aria-label="Avatar cowok"]')).toBeFalsy();
  });

  it('empty-string avatarUrl treated as absent — falls to gender', () => {
    const { getByRole } = render(<AvatarBadge name="X" gender="F" avatarUrl="" />);
    expect(getByRole('img', { name: 'Avatar cewek' })).toBeTruthy();
  });

  it('uppercase initial extracted from name', () => {
    const { getByText } = render(<AvatarBadge name="tony wei" />);
    expect(getByText('T')).toBeTruthy();
  });

  it('handles empty name with fallback ?', () => {
    const { getByText } = render(<AvatarBadge name="" />);
    expect(getByText('?')).toBeTruthy();
  });

  it('img branch also wraps in div (structural consistency with SVG branches)', () => {
    const { container } = render(<AvatarBadge name="X" avatarUrl="https://a.com/b.jpg" className="test-wrapper" />);
    const wrapper = container.querySelector('div.test-wrapper');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.querySelector('img')).toBeTruthy();
  });
});
