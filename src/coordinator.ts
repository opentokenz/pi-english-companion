/** Monotonic sequence number used to let only the newest task touch the widget. */
export class LatestWins {
	private current = 0;

	next(): number {
		this.current += 1;
		return this.current;
	}

	isCurrent(sequence: number): boolean {
		return sequence === this.current;
	}

	/** Make every in-flight task stale, e.g. on session switch. */
	invalidate(): void {
		this.current += 1;
	}
}

/**
 * Run async tasks one after another so `en` mode messages reach the agent in submission order.
 * A rejected task does not break the queue.
 */
export class SerialQueue {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(task, task);
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
