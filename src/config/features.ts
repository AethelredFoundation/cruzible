type FeatureEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_ENABLE_DEVTOOLS?: string;
};

export function isDevtoolsEnabled(env: FeatureEnv = process.env): boolean {
  return (
    env.NODE_ENV !== "production" || env.NEXT_PUBLIC_ENABLE_DEVTOOLS === "true"
  );
}
