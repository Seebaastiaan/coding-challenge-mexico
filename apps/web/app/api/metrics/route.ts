import { getServerlessRadarState, renderPrometheusMetrics } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const state = await getServerlessRadarState();

  return new Response(renderPrometheusMetrics(state), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; version=0.0.4"
    }
  });
}
