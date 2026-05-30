import { NextResponse } from "next/server";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export async function GET() {
  try {
    const response = await fetch(`${SERVER_URL}/state`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Radar server returned ${response.status}` },
        { status: response.status }
      );
    }

    const state = await response.json();
    return NextResponse.json(state, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to reach radar server" },
      { status: 502 }
    );
  }
}
