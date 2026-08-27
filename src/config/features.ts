type FeatureEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_CHAIN_ENV?: string;
  NEXT_PUBLIC_ENABLE_DEVTOOLS?: string;
};

export function isDevtoolsEnabled(env: FeatureEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV ?? "production";
  return (
    nodeEnv !== "production" &&
    env.NEXT_PUBLIC_CHAIN_ENV === "devnet" &&
    env.NEXT_PUBLIC_ENABLE_DEVTOOLS === "true"
  );
}
