import { describe, expect, it } from "vitest";
import type {
  SandboxBackend,
  SandboxBackendCreateInput,
  SandboxBackendHandle,
  SandboxBackendPrewarmInput,
} from "../src/public/definitions/sandbox-backend.js";
import {
  createMicrosandboxWithJustBashFallback,
  defaultSandbox,
  selectDefaultSandbox,
  type DefaultSandboxProbes,
} from "../src/public/sandbox/backends/default.js";

function probes(overrides: Partial<DefaultSandboxProbes>): DefaultSandboxProbes {
  return {
    isDeployedOnVercel: () => false,
    isDockerAvailable: () => false,
    isMicrosandboxSupported: () => false,
    prepareMicrosandbox: async () => {},
    ...overrides,
  };
}

function createRecordingBackend(name: string, calls: string[]): SandboxBackend {
  return {
    name,
    async prewarm(input: SandboxBackendPrewarmInput) {
      calls.push(`${name}:prewarm:${input.templateKey}`);
      return { reused: false };
    },
    async create(input: SandboxBackendCreateInput) {
      calls.push(`${name}:create:${input.sessionKey}`);
      return createHandle(name, input.sessionKey);
    },
  };
}

function createHandle(backendName: string, sessionKey: string): SandboxBackendHandle {
  return {
    async captureState() {
      return {
        backendName,
        metadata: { backendName },
        sessionKey,
      };
    },
    async dispose() {},
    session: {} as SandboxBackendHandle["session"],
    useSessionFn: (() => {
      throw new Error("not used");
    }) as SandboxBackendHandle["useSessionFn"],
  };
}

describe("selectDefaultSandbox", () => {
  it("prefers Vercel Sandbox when deploying on Vercel, before any local probe", () => {
    let probed = false;
    const backend = selectDefaultSandbox(
      undefined,
      probes({
        isDeployedOnVercel: () => true,
        isDockerAvailable: () => {
          probed = true;
          return true;
        },
      }),
    );
    expect(backend.name).toBe("vercel");
    expect(probed).toBe(false);
  });

  it("picks docker when a daemon is available", () => {
    const backend = selectDefaultSandbox(
      undefined,
      probes({ isDockerAvailable: () => true, isMicrosandboxSupported: () => true }),
    );
    expect(backend.name).toBe("docker");
  });

  it("falls back to microsandbox on supported hosts without docker", () => {
    const backend = selectDefaultSandbox(
      undefined,
      probes({ isMicrosandboxSupported: () => true }),
    );
    expect(backend.name).toBe("microsandbox");
  });

  it("falls back to just-bash when nothing else is available", () => {
    const backend = selectDefaultSandbox(undefined, probes({}));
    expect(backend.name).toBe("just-bash");
  });
});

describe("defaultSandbox", () => {
  it("constructs a lazy backend without probing at construction time", () => {
    // Constructing must not touch the host: probing happens on first
    // use (name access / create / prewarm) via the lazy wrapper.
    const backend = defaultSandbox({ docker: { image: "alpine:3" } });
    expect(typeof backend.create).toBe("function");
    expect(typeof backend.prewarm).toBe("function");
  });
});

describe("createMicrosandboxWithJustBashFallback", () => {
  it("preflights microsandbox before using it", async () => {
    const calls: string[] = [];
    const backend = createMicrosandboxWithJustBashFallback({
      fallback: createRecordingBackend("just-bash", calls),
      prepareMicrosandbox: async ({ appRoot }) => {
        calls.push(`prepare:${appRoot}`);
      },
      primary: createRecordingBackend("microsandbox", calls),
    });

    await backend.prewarm({
      runtimeContext: { appRoot: "/tmp/app" },
      seedFiles: [],
      templateKey: "tpl",
    });

    expect(calls).toEqual(["prepare:/tmp/app", "microsandbox:prewarm:tpl"]);
  });

  it("falls back to just-bash when microsandbox setup fails", async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const backend = createMicrosandboxWithJustBashFallback({
      fallback: createRecordingBackend("just-bash", calls),
      prepareMicrosandbox: async () => {
        calls.push("prepare");
        throw new Error("install rejected");
      },
      primary: createRecordingBackend("microsandbox", calls),
    });

    await backend.prewarm({
      log: (message) => logs.push(message),
      runtimeContext: { appRoot: "/tmp/app" },
      seedFiles: [],
      templateKey: "tpl",
    });
    const handle = await backend.create({
      runtimeContext: { appRoot: "/tmp/app" },
      sessionKey: "ses",
      templateKey: "tpl",
    });

    await expect(handle.captureState()).resolves.toMatchObject({
      backendName: "microsandbox",
      sessionKey: "ses",
    });
    expect(calls).toEqual(["prepare", "just-bash:prewarm:tpl", "just-bash:create:ses"]);
    expect(logs.join("\n")).toContain(
      "microsandbox setup failed; falling back to just-bash: install rejected",
    );
  });

  it("prewarms just-bash when microsandbox prewarm fails", async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const backend = createMicrosandboxWithJustBashFallback({
      fallback: createRecordingBackend("just-bash", calls),
      prepareMicrosandbox: async () => {
        calls.push("prepare");
      },
      primary: {
        ...createRecordingBackend("microsandbox", calls),
        async prewarm(input) {
          calls.push(`microsandbox:prewarm:${input.templateKey}`);
          throw new Error("template rejected");
        },
      },
    });

    await backend.prewarm({
      log: (message) => logs.push(message),
      runtimeContext: { appRoot: "/tmp/app" },
      seedFiles: [],
      templateKey: "tpl",
    });
    await backend.prewarm({
      runtimeContext: { appRoot: "/tmp/app" },
      seedFiles: [],
      templateKey: "tpl-2",
    });

    expect(calls).toEqual([
      "prepare",
      "microsandbox:prewarm:tpl",
      "just-bash:prewarm:tpl",
      "just-bash:prewarm:tpl-2",
    ]);
    expect(logs.join("\n")).toContain(
      "microsandbox prewarm failed; falling back to just-bash: template rejected",
    );
  });
});
