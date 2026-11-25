/**
 * Bounded Resource Concurrency Slot Broker.
 */

import type {SlotLoadSnapshot} from '../shared/types.ts';

export class ResourceSlotBroker {
  private readonly maxWorkerSlots: number;
  private activeWorkerSlots = 0;
  private readonly workerWaitQueue: Array<() => void> = [];
  private humanPriorityBusy = false;
  private readonly humanWaitQueue: Array<() => void> = [];

  constructor(maxWorkerSlots = 3) {
    this.maxWorkerSlots = Math.max(1, Math.floor(maxWorkerSlots));
  }

  async acquireWorkerSlot(): Promise<() => void> {
    if (this.activeWorkerSlots < this.maxWorkerSlots) {
      this.activeWorkerSlots += 1;
      return this.createWorkerRelease();
    }
    await new Promise<void>(resolvePromise => {
      this.workerWaitQueue.push(resolvePromise);
    });
    return this.createWorkerRelease();
  }

  async acquireHumanPrioritySlot(): Promise<() => void> {
    if (!this.humanPriorityBusy) {
      this.humanPriorityBusy = true;
      return this.createHumanRelease();
    }
    await new Promise<void>(resolvePromise => {
      this.humanWaitQueue.push(resolvePromise);
    });
    return this.createHumanRelease();
  }

  getSnapshot(): SlotLoadSnapshot {
    return {
      maxWorkerSlots: this.maxWorkerSlots,
      activeWorkerSlots: this.activeWorkerSlots,
      queuedWorkerTasks: this.workerWaitQueue.length,
      humanPrioritySlotBusy: this.humanPriorityBusy,
    };
  }

  private createWorkerRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.workerWaitQueue.shift();
      if (next) {
        next();
      } else {
        this.activeWorkerSlots = Math.max(0, this.activeWorkerSlots - 1);
      }
    };
  }

  private createHumanRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.humanWaitQueue.shift();
      if (next) {
        next();
      } else {
        this.humanPriorityBusy = false;
      }
    };
  }
}
