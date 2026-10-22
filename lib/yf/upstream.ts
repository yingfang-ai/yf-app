const DEFAULT_UPSTREAM = "http://127.0.0.1:9701";

/** yingfang 契约面的上游地址（`YF_API_UPSTREAM` 可覆盖——e2e 的测试内桩缝）。 */
export function upstreamBase(): string {
  return (process.env.YF_API_UPSTREAM ?? DEFAULT_UPSTREAM).replace(/\/+$/, "");
}
