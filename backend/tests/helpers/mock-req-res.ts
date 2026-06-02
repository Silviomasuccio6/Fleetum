import type { NextFunction, Request, Response } from "express";

export type MockNext = NextFunction & {
  calls: unknown[];
  lastError?: unknown;
};

export const createMockReq = (overrides: Partial<Request> = {}) => {
  const req = {
    method: "GET",
    headers: {},
    cookies: {},
    body: {},
    params: {},
    query: {},
    ...overrides
  } as Request;
  return req;
};

export const createMockRes = () => {
  const res = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    redirect(url: string) {
      this.statusCode = 302;
      this.body = url;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return this.headers.get(name.toLowerCase());
    },
    cookie() {
      return this;
    },
    clearCookie() {
      return this;
    }
  } as unknown as Response & {
    statusCode: number;
    body: unknown;
    headers: Map<string, string>;
  };

  return res;
};

export const createMockNext = (): MockNext => {
  const next = ((error?: unknown) => {
    next.calls.push(error);
    if (error) next.lastError = error;
  }) as MockNext;
  next.calls = [];
  return next;
};
