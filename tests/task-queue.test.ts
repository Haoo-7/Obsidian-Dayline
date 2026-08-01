import { describe, expect, it } from 'vitest';
import { SerialTaskQueue } from '../src/task-queue';

describe('serial task queue', () => {
  it('runs queued tasks in order and flushes pending work', async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];

    const first = queue.add(async () => {
      events.push('first:start');
      await Promise.resolve();
      events.push('first:end');
    });
    const second = queue.add(() => { events.push('second'); });

    await queue.flush();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('continues after a failed task', async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];

    await expect(queue.add(() => { throw new Error('failed'); })).rejects.toThrow('failed');
    await queue.add(() => { events.push('continued'); });
    expect(events).toEqual(['continued']);
  });
});
