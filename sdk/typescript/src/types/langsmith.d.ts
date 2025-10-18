declare module "langsmith" {
  export type CreateRunOptions = Record<string, unknown> | undefined;

  export class Client {
    constructor(config?: { apiUrl?: string; apiKey?: string });
    createRun(run: Record<string, unknown>, options?: CreateRunOptions): Promise<unknown>;
  }
}
