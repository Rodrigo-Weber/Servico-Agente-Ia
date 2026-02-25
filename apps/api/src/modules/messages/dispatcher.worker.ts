interface StartWorkerOptions {
  tag?: string;
  concurrency?: number;
}

export async function startOutboundDispatchWorker(options: StartWorkerOptions = {}): Promise<void> {
  const tag = options.tag ?? "[dispatch-worker]";
  void options.concurrency;
  console.log(`${tag} worker outbound desativado (sem Redis/BullMQ).`);
}

export async function stopOutboundDispatchWorker(): Promise<void> {
  // Sem worker dedicado.
}
