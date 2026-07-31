import { describe, expect, it } from 'vitest';
import { ApiError, friendlyErrorMessage } from './api-error';

describe('friendlyErrorMessage', () => {
  it('maps known API error codes to a human-readable message', () => {
    const error = new ApiError(401, { error: 'invalid_credentials' });
    expect(friendlyErrorMessage(error)).toBe('That email or password doesn’t match our records.');
  });

  it('falls back to the raw error code when it has no friendly mapping', () => {
    const error = new ApiError(500, { error: 'something_odd' });
    expect(friendlyErrorMessage(error)).toBe('something_odd');
  });

  it('handles plain Error instances', () => {
    expect(friendlyErrorMessage(new Error('network down'))).toBe('network down');
  });

  it('handles non-Error values without throwing', () => {
    expect(friendlyErrorMessage('nope')).toBe('Something unexpected happened.');
  });
});
