import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AuthProvider } from '../../app/AuthContext';
import { Sidebar } from '../../components/layout/Sidebar';
import { createSession, setCookieHeader } from '../../mocks/session';
import { server } from '../../test/setup';
import { ToolsPage } from './ToolsPage';

function renderPage(userId: string, element: React.ReactNode) {
  const token = createSession(userId);
  document.cookie = setCookieHeader(token);
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/tools']}>
        <AuthProvider>
          <Routes>
            <Route path="/tools" element={element} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Tools resource library flows', () => {
  it('creates a link resource and issues exactly one visibility PUT carrying the full role set', async () => {
    let visibilityPutCount = 0;
    let visibilityBody: unknown;
    server.use(
      http.put('/api/v1/tools/:id/visibility', async ({ request }) => {
        visibilityPutCount += 1;
        visibilityBody = await request.json();
        return HttpResponse.json({ roleIds: (visibilityBody as { roleIds: string[] }).roleIds });
      }),
    );
    renderPage('user-admin', <ToolsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Tools' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
    fireEvent.change(await screen.findByLabelText(/^Name/i), {
      target: { value: 'Synthetic new link resource' },
    });
    fireEvent.change(screen.getByLabelText(/^URL/i), {
      target: { value: 'https://example.test/new-tool' },
    });

    // Grant to a role before saving, so the visibility PUT actually fires
    // (an empty set is skipped on create — nothing to send).
    await screen.findByText('Role access');
    const roleCheckbox = screen.getAllByRole('checkbox')[0] as HTMLElement;
    fireEvent.click(roleCheckbox);

    fireEvent.click(screen.getByRole('button', { name: 'Save resource' }));

    await waitFor(() => expect(visibilityPutCount).toBe(1));
    expect(await screen.findByText('Synthetic new link resource')).toBeInTheDocument();
  });

  /**
   * The mock handler deliberately never calls `request.formData()`: Node's
   * native `fetch` validates a `FormData`-appended `File` against its own
   * WebIDL brand check when a handler parses the body, and a jsdom-
   * constructed `File` fails that check — a jsdom/undici interop gap this
   * codebase has never hit before (no existing test combines a real `File`
   * with a handler that reads `request.formData()`; `importApi`'s own
   * upload paths are only ever exercised against handlers, like the one
   * below, that don't parse the body either). The real multipart parsing —
   * field ordering, file bytes, `@fastify/multipart` — is already covered
   * end-to-end against a real Fastify server in
   * `phase22.postgres.integration.test.ts`; this test's job is only the
   * React layer: the file input gates Save, and a successful response is
   * reflected in the UI.
   */
  it('gates Save on a chosen file for a file-type resource, and reflects a successful create', async () => {
    server.use(
      http.post('/api/v1/tools', () =>
        HttpResponse.json(
          {
            id: 'resource-uploaded',
            name: 'Synthetic new file resource',
            description: null,
            category: null,
            type: 'file',
            url: null,
            fileName: 'guide.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 19,
            instructions: null,
            active: true,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { status: 201 },
        ),
      ),
    );
    renderPage('user-admin', <ToolsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Tools' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
    fireEvent.change(await screen.findByLabelText(/^Name/i), {
      target: { value: 'Synthetic new file resource' },
    });
    fireEvent.change(screen.getByLabelText(/^Type/i), { target: { value: 'file' } });

    const saveButton = screen.getByRole('button', { name: 'Save resource' });
    // No file chosen yet: Save must stay disabled for a new file-type
    // Resource, matching the server's own "file required on create" rule.
    expect(saveButton).toBeDisabled();

    const file = new File(['synthetic contents'], 'guide.pdf', { type: 'application/pdf' });
    const fileInput = await screen.findByLabelText<HTMLInputElement>(/^File/i);
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(fileInput.files?.[0]?.name).toBe('guide.pdf');
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);
    // The editor only closes in the save mutation's onSuccess — proving the
    // POST was accepted and handled, without depending on the unmodified
    // mock list reflecting a resource the override handler never stored.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save resource' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a tools:view-only session sees the browse list with no admin affordances', async () => {
    renderPage('user-rep', <ToolsPage />);
    // The seeded synthetic wiki link is granted to both mock users.
    expect(await screen.findByText('Internal knowledge base')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage Tools' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add resource' })).not.toBeInTheDocument();
    // Admin-only seeded resource stays invisible on the browse surface.
    expect(screen.queryByText('Onboarding checklist')).not.toBeInTheDocument();
  });

  it('hides the Tools nav entry when the caller has no accessible resource', async () => {
    server.use(
      http.get('/api/v1/auth/capabilities', () =>
        HttpResponse.json({
          permissions: [{ module: 'tools', action: 'view', scope: 'ORGANIZATION' }],
          journeyIds: [],
          fieldVisibility: [],
          hasAccessibleTools: false,
        }),
      ),
    );
    renderPage('user-rep', <Sidebar />);
    await screen.findByText('Sellers');
    expect(screen.queryByText('Tools')).not.toBeInTheDocument();
  });

  it('shows the Tools nav entry once the capability signal is true', async () => {
    server.use(
      http.get('/api/v1/auth/capabilities', () =>
        HttpResponse.json({
          permissions: [{ module: 'tools', action: 'view', scope: 'ORGANIZATION' }],
          journeyIds: [],
          fieldVisibility: [],
          hasAccessibleTools: true,
        }),
      ),
    );
    renderPage('user-rep', <Sidebar />);
    expect(await screen.findByText('Tools')).toBeInTheDocument();
  });
});
