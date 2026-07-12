import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node's native addon dlopen()s libonnxruntime.so.1 at runtime,
  // which the file tracer can't see (it only follows require/import/fs calls).
  // Without this, the .so is dropped from the deployed function and
  // @huggingface/transformers (used for local embeddings) fails at runtime.
  outputFileTracingIncludes: {
    "/*": ["node_modules/onnxruntime-node/bin/**/*"],
  },
};

export default nextConfig;
