import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface ParamsDictionary {
    id: string;
    workerId: string;
    companyId: string;
    stepId: string;
    projectId: string;
    templateId: string;
    token: string;
    negId: string;
    userId: string;
    paymentIntentId: string;
    itemId: string;
    attId: string;
    attachId: string;
    payrollItemId: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: import('../shared/schema').User;
    }
  }
}
