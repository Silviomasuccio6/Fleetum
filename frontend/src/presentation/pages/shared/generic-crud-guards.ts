export type LatestRequestGuard = {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
  invalidate: () => void;
};

export const createLatestRequestGuard = (): LatestRequestGuard => {
  let latestRequestId = 0;

  return {
    begin: () => {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent: (requestId) => requestId === latestRequestId,
    invalidate: () => {
      latestRequestId += 1;
    }
  };
};

export type SubmissionGuard = {
  tryAcquire: () => boolean;
  release: () => void;
};

export type CrudListQuery = {
  page: number;
  search: string;
};

export type CrudListQueryCursor = {
  update: (query: CrudListQuery) => void;
  read: () => CrudListQuery;
};

export const createCrudListQueryCursor = (initial: CrudListQuery): CrudListQueryCursor => {
  let current = initial;

  return {
    update: (query) => {
      current = query;
    },
    read: () => current
  };
};

export const createSubmissionGuard = (): SubmissionGuard => {
  let locked = false;

  return {
    tryAcquire: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    release: () => {
      locked = false;
    }
  };
};
