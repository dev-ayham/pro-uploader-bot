/**
 * Very small per-chat "what is the bot waiting for" state, used by
 * settings flows that need a second message from the user (e.g. typing a
 * rename prefix / suffix). In-memory on purpose: these flows are
 * expected to complete within seconds and there is no benefit to
 * persisting half-finished UX through a restart.
 */
export type PendingInput =
    | { kind: "rename_prefix" }
    | { kind: "rename_suffix" };

const pending = new Map<number, PendingInput>();

export function setPendingInput(chatId: number, input: PendingInput): void {
    pending.set(chatId, input);
}

export function getPendingInput(chatId: number): PendingInput | undefined {
    return pending.get(chatId);
}

export function clearPendingInput(chatId: number): void {
    pending.delete(chatId);
}
