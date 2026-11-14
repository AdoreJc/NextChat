import { NextResponse } from "next/server";
import { FEATURES } from "../config/site";

/**
 * single-site build: the server only forwards to the API site configured
 * with BASE_URL. Every route that would reach a third party calls this
 * first and returns the response when it is not null.
 */
export function singleSiteBlocked() {
  if (FEATURES.thirdPartyProxy) {
    return null;
  }
  return NextResponse.json(
    {
      error: true,
      message: "this endpoint is disabled on this site",
    },
    { status: 404 },
  );
}
