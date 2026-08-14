import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GlobalSearch } from './GlobalSearch';

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <GlobalSearch />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('global search', () => {
  it('sends the query into the seller list filter', () => {
    renderSearch();

    fireEvent.change(screen.getByLabelText('Search sellers'), {
      target: { value: 'Acme & Co' },
    });
    fireEvent.submit(screen.getByRole('search'));

    // Encoded, so an ampersand can't truncate the query param.
    expect(screen.getByTestId('location')).toHaveTextContent('/sellers?search=Acme%20%26%20Co');
  });

  it('goes to the unfiltered list when submitted empty', () => {
    renderSearch();

    fireEvent.change(screen.getByLabelText('Search sellers'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('search'));

    expect(screen.getByTestId('location')).toHaveTextContent('/sellers');
    expect(screen.getByTestId('location')).not.toHaveTextContent('search=');
  });

  it('focuses on "/" but not while typing in another field', () => {
    renderSearch();
    const input = screen.getByLabelText('Search sellers');

    fireEvent.keyDown(document.body, { key: '/' });
    expect(input).toHaveFocus();

    input.blur();
    // A slash typed inside an input is a slash, not a shortcut.
    fireEvent.keyDown(input, { key: '/' });
    expect(input).not.toHaveFocus();
  });

  it('supports the mobile search surface and closes it after navigation', () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <GlobalSearch mobile focusOnMount onNavigate={onNavigate} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const input = screen.getByLabelText('Search sellers');
    expect(input).toHaveFocus();
    expect(screen.getByRole('search')).toHaveClass('block');

    fireEvent.change(input, { target: { value: 'Northwind' } });
    fireEvent.submit(screen.getByRole('search'));

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveTextContent('/sellers?search=Northwind');
  });
});
