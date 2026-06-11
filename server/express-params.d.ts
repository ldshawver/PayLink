import type { IncomingHttpHeaders } from 'http';

declare global {
  namespace Express {
    interface Request {
      user?: import('../shared/schema').User;
    }
  }
}

export type { IncomingHttpHeaders };

