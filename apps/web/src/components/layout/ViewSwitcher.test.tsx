import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ViewSwitcher } from './ViewSwitcher';

const views = [
  { label: 'Table', to: '/sellers', icon: 'table' as const },
  { label: 'Board', to: '/sellers/board', icon: 'board' as const },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ViewSwitcher views={views} />
    </MemoryRouter>,
  );
}

describe('view switcher', () => {
  it('marks the current view as active without matching its siblings', () => {
    renderAt('/sellers/board');

    // `end` matching matters here: /sellers is a prefix of /sellers/board, so
    // without it both segments would render as current at once.
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Table' })).not.toHaveAttribute('aria-current');
  });

  it('activates the table view on the module root', () => {
    renderAt('/sellers');

    expect(screen.getByRole('link', { name: 'Table' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Board' })).not.toHaveAttribute('aria-current');
  });

  it('exposes both views as one labelled group', () => {
    renderAt('/sellers');

    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
  });
});
