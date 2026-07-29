interface Env {
  ANTHROPIC_API_KEY?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return Response.json({ ok: true, hasKey: Boolean(env.ANTHROPIC_API_KEY) });
};
