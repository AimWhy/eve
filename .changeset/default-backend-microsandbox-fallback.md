---
"eve": patch
---

`defaultBackend()` now verifies microsandbox package and VM runtime setup before using microsandbox. If setup or auto-install fails, it falls back to just-bash so local sandbox startup can continue with the dependency-free backend.
