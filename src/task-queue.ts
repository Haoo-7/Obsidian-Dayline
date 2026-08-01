export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  add(task: () => Promise<void> | void): Promise<void> {
    const run = this.tail.then(() => task());
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  flush(): Promise<void> {
    return this.tail;
  }
}
