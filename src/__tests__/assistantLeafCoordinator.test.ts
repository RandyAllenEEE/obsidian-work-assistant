import {
  AssistantLeafCoordinator,
  type AssistantLeafHost,
} from "../ui/assistantLeafCoordinator";

interface TestLeaf {
  id: string;
  current: boolean;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(initialLeaves: TestLeaf[] = []) {
  let enabled = true;
  let layoutReady = false;
  const layoutCallbacks: Array<() => void> = [];
  const leaves = [...initialLeaves];
  const createdLeaf: TestLeaf = { id: "created", current: false };
  const calls = {
    setAssistantView: jest.fn(async (leaf: TestLeaf) => {
      leaf.current = true;
    }),
    onLeafReady: jest.fn(),
    revealLeaf: jest.fn(async () => undefined),
    detachLeaf: jest.fn(),
    onError: jest.fn(),
  };
  const host: AssistantLeafHost<TestLeaf> = {
    isEnabled: () => enabled,
    onLayoutReady: (callback) => {
      if (layoutReady) callback();
      else layoutCallbacks.push(callback);
    },
    findLeaves: () => [...leaves],
    createLeaf: () => {
      leaves.push(createdLeaf);
      return createdLeaf;
    },
    isCurrentView: (leaf) => leaf.current,
    ...calls,
  };

  return {
    coordinator: new AssistantLeafCoordinator(host),
    calls,
    createdLeaf,
    setEnabled: (value: boolean) => { enabled = value; },
    completeLayout: () => {
      layoutReady = true;
      layoutCallbacks.splice(0).forEach((callback) => callback());
    },
  };
}

describe("AssistantLeafCoordinator", () => {
  test("does not inspect or mutate leaves before layout restoration completes", async () => {
    const existing = { id: "existing", current: true };
    const harness = createHarness([existing]);

    harness.coordinator.request(false);
    await flushPromises();
    expect(harness.calls.onLeafReady).not.toHaveBeenCalled();
    expect(harness.calls.setAssistantView).not.toHaveBeenCalled();

    harness.completeLayout();
    await flushPromises();
    expect(harness.calls.onLeafReady).toHaveBeenCalledWith(existing);
    expect(harness.calls.setAssistantView).not.toHaveBeenCalled();
    expect(harness.calls.revealLeaf).not.toHaveBeenCalled();
  });

  test("creates a missing startup leaf without revealing it", async () => {
    const harness = createHarness();
    harness.coordinator.request(false);
    harness.completeLayout();
    await flushPromises();

    expect(harness.calls.setAssistantView).toHaveBeenCalledWith(harness.createdLeaf);
    expect(harness.calls.onLeafReady).toHaveBeenCalledWith(harness.createdLeaf);
    expect(harness.calls.revealLeaf).not.toHaveBeenCalled();
  });

  test("reveals an existing leaf only for an explicit request", async () => {
    const existing = { id: "existing", current: true };
    const harness = createHarness([existing]);
    harness.completeLayout();

    harness.coordinator.request(true);
    await flushPromises();

    expect(harness.calls.setAssistantView).not.toHaveBeenCalled();
    expect(harness.calls.revealLeaf).toHaveBeenCalledWith(existing);
  });

  test("migrates a legacy leaf after layout and coalesces duplicate requests", async () => {
    const legacy = { id: "legacy", current: false };
    const harness = createHarness([legacy]);

    harness.coordinator.request(false);
    harness.coordinator.request(false);
    harness.completeLayout();
    await flushPromises();

    expect(harness.calls.setAssistantView).toHaveBeenCalledTimes(1);
    expect(harness.calls.setAssistantView).toHaveBeenCalledWith(legacy);
  });

  test("cancels a queued restore when the Assistant is disabled", async () => {
    const harness = createHarness();
    harness.coordinator.request(false);
    harness.setEnabled(false);
    harness.coordinator.cancel();
    harness.completeLayout();
    await flushPromises();

    expect(harness.calls.setAssistantView).not.toHaveBeenCalled();
    expect(harness.calls.onLeafReady).not.toHaveBeenCalled();
  });

  test("defers disabled-view cleanup until layout restoration completes", async () => {
    const existing = { id: "existing", current: true };
    const harness = createHarness([existing]);

    harness.coordinator.removeAfterLayoutReady();
    await flushPromises();
    expect(harness.calls.detachLeaf).not.toHaveBeenCalled();

    harness.completeLayout();
    await flushPromises();
    expect(harness.calls.detachLeaf).toHaveBeenCalledWith(existing);
  });

  test("a new open request cancels a queued disabled-view cleanup", async () => {
    const existing = { id: "existing", current: true };
    const harness = createHarness([existing]);

    harness.coordinator.removeAfterLayoutReady();
    harness.coordinator.request(false);
    harness.completeLayout();
    await flushPromises();

    expect(harness.calls.detachLeaf).not.toHaveBeenCalled();
    expect(harness.calls.onLeafReady).toHaveBeenCalledWith(existing);
  });
});
