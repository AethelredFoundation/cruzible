/**
 * GlassCard Component Tests
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { GlassCard } from '@/components/PagePrimitives';

describe('GlassCard', () => {
  it('renders children correctly', () => {
    render(
      <GlassCard>
        <div data-testid="child">Test Content</div>
      </GlassCard>
    );
    
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <GlassCard className="custom-class">
        <div>Content</div>
      </GlassCard>
    );
    
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('applies hover effect when hover prop is true', () => {
    const { container } = render(
      <GlassCard hover>
        <div>Content</div>
      </GlassCard>
    );
    
    expect(container.firstChild).toHaveClass('hover:border-red-500/30');
  });

  it('applies active state when active prop is true', () => {
    const { container } = render(
      <GlassCard active>
        <div>Content</div>
      </GlassCard>
    );
    
    expect(container.firstChild).toHaveClass('border-red-500/50');
  });

  it('handles click events', () => {
    const handleClick = jest.fn();
    render(
      <GlassCard onClick={handleClick}>
        <div>Clickable</div>
      </GlassCard>
    );
    
    screen.getByText('Clickable').click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('has correct accessibility attributes', () => {
    render(
      <GlassCard role="region" aria-label="Test Card">
        <div>Content</div>
      </GlassCard>
    );
    
    expect(screen.getByRole('region')).toHaveAttribute('aria-label', 'Test Card');
  });
});
