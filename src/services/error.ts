export class DevsyncError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DevsyncError";
  }
}
