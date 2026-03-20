export class SyncError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}
