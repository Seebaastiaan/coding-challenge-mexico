import { NextResponse } from "next/server";
import { getServerlessRadarState } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const state = await getServerlessRadarState();
    return NextResponse.json(state, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "No se pudo construir el estado del radar serverless"
        },
      { status: 500 }
    );
  }
}
