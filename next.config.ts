import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node's native addon dlopen()s libonnxruntime.so.1 at runtime,
  // which the file tracer can't see (it only follows require/import/fs calls).
  // Without this, the .so is dropped from the deployed function and
  // @huggingface/transformers (used for local embeddings) fails at runtime.
  //
  // Scoped to linux only (win32/darwin binaries never run on Vercel — the
  // bin/ folder is 210MB total, ~52MB of which is linux) via a per-route key
  // rather than a narrower route glob: this Next build's outputFileTracingIncludes
  // route-key matching is substring-based, not exact, so e.g. "/topics/[id]"
  // also matches "/topics/[id]/manage" — "/*" is the only key that reliably
  // means "every route" here.
  outputFileTracingIncludes: {
    "/*": ["node_modules/onnxruntime-node/bin/napi-v6/linux/**/*"],
  },
};

export default nextConfig;
