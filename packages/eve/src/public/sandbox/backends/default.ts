import {
  isDockerDaemonAvailableSync,
  isMicrosandboxPlatformSupported,
  prepareMicrosandboxSandboxBackend,
} from "#execution/sandbox/bindings/local.js";
import { lazyBackend } from "#execution/sandbox/lazy-backend.js";
import type {
  SandboxBackend,
  SandboxBackendCreateInput,
  SandboxBackendHandle,
  SandboxBackendPrewarmInput,
} from "#public/definitions/sandbox-backend.js";
import { docker } from "#public/sandbox/backends/docker.js";
import type { DockerSandboxCreateOptions } from "#public/sandbox/docker-sandbox.js";
import { justbash } from "#public/sandbox/backends/just-bash.js";
import type { JustBashSandboxCreateOptions } from "#public/sandbox/just-bash-sandbox.js";
import { microsandbox } from "#public/sandbox/backends/microsandbox.js";
import type { MicrosandboxCreateOptions } from "#public/sandbox/microsandbox-sandbox.js";
import { vercel } from "#public/sandbox/backends/vercel.js";
import type { VercelSandboxCreateOptions } from "#public/sandbox/vercel-sandbox.js";
import { toErrorMessage } from "#shared/errors.js";

/**
 * Input to {@link defaultSandbox}: a separate options bag per inner
 * backend. The framework picks one backend at runtime based on
 * availability and passes it the matching bag; the others are ignored.
 */
export interface DefaultSandboxOptions {
  readonly docker?: DockerSandboxCreateOptions;
  readonly justBash?: JustBashSandboxCreateOptions;
  readonly microsandbox?: MicrosandboxCreateOptions;
  readonly vercel?: VercelSandboxCreateOptions;
}

/**
 * Availability probes behind {@link defaultSandbox}'s selection chain.
 * Injectable so selection logic is testable without touching the host.
 */
export interface DefaultSandboxProbes {
  readonly isDeployedOnVercel: () => boolean;
  readonly isDockerAvailable: () => boolean;
  readonly isMicrosandboxSupported: () => boolean;
  readonly prepareMicrosandbox: (input: {
    readonly appRoot: string;
    readonly log?: (message: string) => void;
    readonly options?: MicrosandboxCreateOptions;
  }) => Promise<void>;
}

// Wrapped in arrows (not captured by reference) deliberately: this
// module participates in an import cycle through the runtime resolver,
// so the probe imports may still be uninitialized live bindings when
// this object literal evaluates. Accessing them at call time is safe.
const PRODUCTION_PROBES: DefaultSandboxProbes = {
  isDeployedOnVercel: () => Boolean(process.env.VERCEL),
  isDockerAvailable: () => isDockerDaemonAvailableSync(),
  isMicrosandboxSupported: () => isMicrosandboxPlatformSupported(),
  prepareMicrosandbox: (input) => prepareMicrosandboxSandboxBackend(input),
};

/**
 * Constructs an availability-aware sandbox backend. On first use it
 * picks the best backend the host supports, in priority order:
 *
 * 1. **Vercel Sandbox** when deploying on Vercel (`process.env.VERCEL`
 *    is set) — local container/VM runtimes cannot run there.
 * 2. **Docker** when a Docker daemon is reachable.
 * 3. **microsandbox** when the host supports it (macOS on Apple
 *    Silicon, or glibc Linux with KVM) and its package plus VM runtime
 *    are ready; `eve dev` auto-installs them into the project before
 *    using the backend.
 * 4. **just-bash** as the dependency-free fallback; `eve dev`
 *    auto-installs the package into the project. When microsandbox
 *    setup fails, defaultSandbox falls through to this backend.
 *
 * The selection is cached for the process lifetime. To pin a backend
 * unconditionally, configure its factory directly (`docker()`,
 * `microsandbox()`, `justbash()`,
 * `vercel()`).
 */
export function defaultSandbox(opts?: DefaultSandboxOptions): SandboxBackend {
  return lazyBackend(() => selectDefaultSandbox(opts, PRODUCTION_PROBES));
}

/**
 * The selection chain behind {@link defaultSandbox}. Internal —
 * exported for tests, which inject probes.
 */
export function selectDefaultSandbox(
  opts: DefaultSandboxOptions | undefined,
  probes: DefaultSandboxProbes,
): SandboxBackend {
  if (probes.isDeployedOnVercel()) {
    return vercel(opts?.vercel);
  }
  if (probes.isDockerAvailable()) {
    return docker(opts?.docker);
  }
  if (probes.isMicrosandboxSupported()) {
    return createMicrosandboxWithJustBashFallback({
      fallback: justbash(opts?.justBash),
      options: opts?.microsandbox,
      prepareMicrosandbox: probes.prepareMicrosandbox,
      primary: microsandbox(opts?.microsandbox),
    });
  }
  return justbash(opts?.justBash);
}

type DefaultLocalBackendChoice = "microsandbox" | "just-bash";

/**
 * A microsandbox-supported host can still fail later because the npm package
 * or VM runtime is missing or cannot install. defaultSandbox treats that as an
 * availability miss and falls back to just-bash before running authored
 * bootstrap/session code.
 */
export function createMicrosandboxWithJustBashFallback(input: {
  readonly fallback: SandboxBackend;
  readonly options?: MicrosandboxCreateOptions;
  readonly prepareMicrosandbox: DefaultSandboxProbes["prepareMicrosandbox"];
  readonly primary: SandboxBackend;
}): SandboxBackend {
  let choice: DefaultLocalBackendChoice | undefined;

  async function select(inputContext: {
    readonly appRoot: string;
    readonly log?: (message: string) => void;
  }): Promise<SandboxBackend> {
    if (choice === "microsandbox") {
      return input.primary;
    }
    if (choice === "just-bash") {
      return input.fallback;
    }

    try {
      await input.prepareMicrosandbox({
        appRoot: inputContext.appRoot,
        log: inputContext.log,
        options: input.options,
      });
      choice = "microsandbox";
      return input.primary;
    } catch (error) {
      choice = "just-bash";
      inputContext.log?.(
        `microsandbox setup failed; falling back to just-bash: ${toErrorMessage(error)}`,
      );
      return input.fallback;
    }
  }

  return {
    // Keep the existing stable name so defaultBackend keeps the same public
    // identity and key namespace on microsandbox-capable hosts. Fallback
    // handles rewrite captured state below so reconnect checks keep working.
    name: input.primary.name,
    async prewarm(prewarmInput) {
      const backend = await select({
        appRoot: prewarmInput.runtimeContext.appRoot,
        log: prewarmInput.log,
      });
      try {
        return await backend.prewarm(prewarmInput as SandboxBackendPrewarmInput);
      } catch (error) {
        if (backend !== input.primary) {
          throw error;
        }
        choice = "just-bash";
        prewarmInput.log?.(
          `microsandbox prewarm failed; falling back to just-bash: ${toErrorMessage(error)}`,
        );
        return await input.fallback.prewarm(prewarmInput as SandboxBackendPrewarmInput);
      }
    },
    async create(createInput) {
      const backend = await select({
        appRoot: createInput.runtimeContext.appRoot,
      });
      const handle = await backend.create(createInput as SandboxBackendCreateInput);
      return backend === input.primary ? handle : wrapFallbackHandle(handle, input.primary.name);
    },
  };
}

function wrapFallbackHandle(
  handle: SandboxBackendHandle,
  backendName: string,
): SandboxBackendHandle {
  return {
    ...handle,
    async captureState() {
      const state = await handle.captureState();
      return {
        ...state,
        backendName,
      };
    },
  };
}
