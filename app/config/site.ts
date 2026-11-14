/**
 * OpenPalm Chat: central switch for the single-site build.
 *
 * This fork ships as the web chat client of one OpenAI-compatible API site.
 * Everything that is hidden or disabled for that purpose is gated here, so
 * the upstream provider implementations stay untouched and upstream merges
 * stay cheap.
 *
 * Build-time switch: build with `NEXT_PUBLIC_SINGLE_SITE=0` to get the
 * upstream multi-provider behaviour back (third-party requests included).
 */
export const SINGLE_SITE = process.env.NEXT_PUBLIC_SINGLE_SITE !== "0";

export const SITE_NAME = "OpenPalm Chat";
export const SITE_DESCRIPTION = "Your AI assistant.";

const full = !SINGLE_SITE;

export const FEATURES = {
  /** provider selector and the per-provider settings of the other providers */
  multiProvider: full,
  /** cloud sync (WebDAV / UpStash); local export & import stay available */
  cloudSync: full,
  /** OpenAI/Azure realtime chat */
  realtime: full,
  /** text to speech, speech to text */
  tts: full,
  /** plugins (remote OpenAPI schemas, server side proxy) */
  plugins: full,
  /** MCP market */
  mcp: full,
  /** sharing: ShareGPT and artifacts share (need third-party services) */
  share: full,
  /** Stable Diffusion page */
  sd: full,
  /** update check against the upstream GitHub repo */
  updateCheck: full,
  /** links to the upstream project: GitHub, issues, SaaS promotion */
  upstreamLinks: full,
  /** remote web font (Google Fonts) */
  remoteFont: full,
  /** emoji images from a public CDN; native emoji are used when off */
  remoteEmoji: full,
  /** server side forwarding to anything but the configured BASE_URL */
  thirdPartyProxy: full,
} as const;
