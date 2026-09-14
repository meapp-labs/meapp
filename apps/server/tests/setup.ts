import { vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));
