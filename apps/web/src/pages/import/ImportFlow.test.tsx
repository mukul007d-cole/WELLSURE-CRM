import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../../app/AuthContext';
import { PermissionRoute } from '../../app/PermissionRoute';
import { Sidebar } from '../../components/layout/Sidebar';
import { createSession, setCookieHeader } from '../../mocks/session';
import { ImportPage } from './ImportPage';
import { groupErrors, initialColumnTargets, mappingProblems } from './import-state';
import type { ImportAnalysis, ImportRowOutcome } from '../../types/domain';

function renderAs(userId: string, element: React.ReactNode, route = '/import') {
  document.cookie = setCookieHeader(createSession(userId));
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <Routes>
            <Route path="/import" element={element} />
            <Route path="/sellers" element={<p>Sellers list</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const csv = 'name,phone,junk\nAda Lovelace,111,x\nGrace Hopper,222,y\n,333,z\n';

/**
 * Fill in the whole-file destination.
 *
 * Each option is awaited before its select is changed: a controlled `<select>`
 * silently ignores a value whose `<option>` has not rendered yet, which is a
 * flake that looks exactly like a broken form.
 */
async function chooseDestination() {
  await screen.findByRole('option', { name: 'Journey Alpha' });
  fireEvent.change(screen.getByLabelText(/^journey/i), { target: { value: 'journey-alpha' } });
  fireEvent.change(screen.getByLabelText(/owner type/i), { target: { value: 'lead_owner' } });
  await screen.findByRole('option', { name: 'Priya Shah' });
  fireEvent.change(screen.getByLabelText(/^owner$/i), { target: { value: 'user-admin' } });
}

async function uploadFile() {
  const input = screen.getByLabelText(/drop a csv/i, { selector: 'input' });
  fireEvent.change(input, {
    target: { files: [new File([csv], 'leads.csv', { type: 'text/csv' })] },
  });
  await screen.findByText(/columns/i);
}

describe('bulk import flow', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.cookie = 'falcon_session=; Path=/; Max-Age=0';
  });

  it('walks upload → map → preview → commit, and never commits without a confirm', async () => {
    renderAs('user-admin', <ImportPage />);
    await uploadFile();

    // Step two. Every column starts skipped — this is the requirement that no
    // column is silently guessed into a target.
    const selects = screen.getAllByLabelText(/import as/i);
    expect(selects).toHaveLength(3);
    for (const select of selects) expect((select as HTMLSelectElement).value).toBe('skip');
    expect(screen.getByText('0 of 3 mapped')).toBeInTheDocument();

    // Preview is blocked until the mapping is answerable.
    expect(screen.getByRole('button', { name: /preview import/i })).toBeDisabled();

    fireEvent.change(selects[0]!, { target: { value: 'core:name' } });
    fireEvent.change(selects[1]!, { target: { value: 'core:phone' } });
    expect(screen.getByText('2 of 3 mapped')).toBeInTheDocument();

    await chooseDestination();

    const previewButton = screen.getByRole('button', { name: /preview import/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
    fireEvent.click(previewButton);

    // Step three leads with the counts, and says plainly that nothing happened.
    await screen.findByText(/nothing has been created yet/i);
    expect(screen.getByRole('button', { name: /will be created/i })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /cannot be imported/i })).toHaveTextContent('1');
    // Once in the grouped summary, once in the row list — both are wanted.
    expect(screen.getAllByText(/lead name is required/i).length).toBeGreaterThanOrEqual(2);

    // Step four only after an explicit confirm.
    fireEvent.click(screen.getByRole('button', { name: /create 2 leads/i }));
    await screen.findByText(/created 2 leads from leads\.csv/i);
  });

  it('filters the row list by clicking a count, and clears it by clicking again', async () => {
    renderAs('user-admin', <ImportPage />);
    await uploadFile();
    fireEvent.change(screen.getAllByLabelText(/import as/i)[0]!, {
      target: { value: 'core:name' },
    });
    await chooseDestination();
    const previewButton = screen.getByRole('button', { name: /preview import/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
    fireEvent.click(previewButton);

    const table = await screen.findByRole('table', { name: /what each row of the file would do/i });
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3

    fireEvent.click(screen.getByRole('button', { name: /cannot be imported/i }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: /what each row/i })).getAllByRole('row'),
      ).toHaveLength(2),
    );

    fireEvent.click(screen.getByRole('button', { name: /cannot be imported/i }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: /what each row/i })).getAllByRole('row'),
      ).toHaveLength(4),
    );
  });

  it('hides the nav entry and blocks the route without leads:import', async () => {
    renderAs('user-rep', <Sidebar />, '/import');
    await waitFor(() => expect(screen.queryByText(/import leads/i)).not.toBeInTheDocument());

    renderAs('user-rep', <PermissionRoute module="leads" action="import" />, '/import');
    // Redirected away rather than rendered — and the server refuses regardless.
    await screen.findByText(/sellers list/i);
  });

  it('shows the nav entry with the grant', async () => {
    renderAs('user-admin', <Sidebar />, '/import');
    expect(await screen.findByText(/import leads/i)).toBeInTheDocument();
  });
});

describe('import state helpers', () => {
  const analysis: ImportAnalysis = {
    fileName: 'f.csv',
    contentHash: 'sha256:x',
    rowCount: 2,
    raggedRowNumbers: [],
    columns: [
      { index: 0, name: 'email', samples: ['a@b.test'], fillRate: 1 },
      { index: 1, name: 'name', samples: ['Ada'], fillRate: 1 },
    ],
  };

  it('starts every column skipped, including one whose header matches a target', () => {
    // `email` is *probably* the email column. Guessing it is exactly what this
    // feature must not do.
    expect(initialColumnTargets(analysis)).toEqual({
      email: { kind: 'skip' },
      name: { kind: 'skip' },
    });
  });

  it('reports what is still missing in plain language', () => {
    expect(
      mappingProblems({
        journeyId: '',
        statusId: '',
        assignmentType: '',
        assignmentUserId: '',
        columns: { email: { kind: 'core', column: 'email' } },
        matchKeys: [],
      }),
    ).toEqual([
      'Choose the journey these leads belong to.',
      'Map one column to the lead name — every lead needs one.',
      'Choose who will own these leads, or map a column of owner email addresses.',
    ]);
  });

  it('names both columns when two are mapped to the same target', () => {
    const problems = mappingProblems({
      journeyId: 'j',
      statusId: '',
      assignmentType: 'owner',
      assignmentUserId: 'u',
      columns: {
        a: { kind: 'core', column: 'name' },
        b: { kind: 'core', column: 'name' },
      },
      matchKeys: [],
    });
    expect(problems).toContain('“b” and “a” are both mapped to the same thing.');
  });

  it('groups rejections by reason, largest first', () => {
    const rows: ImportRowOutcome[] = [
      { rowNumber: 2, outcome: 'rejected', reason: 'missing name' },
      { rowNumber: 3, outcome: 'created', leadId: 'l' },
      { rowNumber: 4, outcome: 'rejected', reason: 'bad phone' },
      { rowNumber: 5, outcome: 'rejected', reason: 'missing name' },
    ];
    expect(groupErrors(rows).map((group) => [group.reason, group.rows.length])).toEqual([
      ['missing name', 2],
      ['bad phone', 1],
    ]);
  });
});
